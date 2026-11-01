/**
 * Step 8: the model proposes a verdict and writes the claim's section; the
 * SYSTEM then enforces PRD §9.5 on it (enforceVerdict). Evidence is shown to the
 * model under short keys ([E3]); the system expands keys into verified citations.
 */
import { challengeKeys, judgePrompt, refuteKeys, responsesPrompt, type EvidenceLine } from '@/lib/harness/prompts/research-execute';
import type { Verdict } from '@/lib/notes/schema';
import { blockingRefutes, checkCondition, enforceVerdict, GRADE_RANK, independenceKey, isCriterionCondition, isExpert, originLabel, supportBar, verdictFromConditions, type Evidence } from './evidence';
import { rekeyed, storedKeys, type FrozenClaim } from './judgment-file';
import { lengthOf, LENGTH_LIMITS } from './length-check';
import { conditionText } from './question-tree';
import { LlmJsonError, LlmTruncatedError } from './llm';
import { judgmentSchema, responseKeys, responsesSchema, type ConditionStatus, type Judgment } from './schemas';
import type { PlanClaim, ResearchRun } from './run';
import type { CheckFailure } from './selfcheck';

export interface KeyCounter {
  n: number;
}

export interface ClaimResult {
  claim: PlanClaim;
  /** `H1`, `H2-1` … (hypothesisLabel). */
  label: string;
  hypothesisPath: string | null;
  hypothesisLink: string | null;
  /** Everything found for this claim (all stances). */
  evidence: Evidence[];
  /** Key → evidence, for the evidence the model saw (and may cite). */
  keyed: Map<string, Evidence>;
  /** Keys of the challenges the reasoning must answer one by one (expert challenges, core / narrowing refutes). */
  challenges: string[];
  /** 需要修改 only: the revised statement's core assertions, each checked against the 成立 bar by code. */
  assertions: CheckedAssertion[];
  /** D-48: the plan's conditions as code checked them (①②③, the criterion lines skipped); empty when judged the old way. */
  conditions: CheckedCondition[];
  /** D-48 第 4 轮, a rewrite: why this hypothesis could not keep vN's judgment and was judged again. */
  frozenFallback?: string;
  /** 第 5 轮 --only: vN's card as it was (not listed); nothing later rewrites its words. */
  kept?: boolean;
  judgment: Judgment;
  verdict: Verdict;
  adjusted: boolean;
  adjustNote: string;
  revisedStatement: string | null;
  subNotes: { id: string; question: string; note: string }[];
}

/** A refute the judge must answer one by one: an expert's challenge, or one aimed at the core premise / narrowing the claim. */
export const isChallenge = (e: Evidence) => e.stance === 'refutes' && (isExpert(e) || e.core || e.partial);

/** Ordinary refutes shown to the judge besides the challenges (the challenges are never capped). */
export const MAX_ORDINARY_REFUTES = 6;

/**
 * Pick what the model sees: EVERY challenge (expert challenges, core and narrowing refutes; D-21: a cap of 6 by
 * grade pushed all four interview challenges of H1 out of sight), then the strongest ordinary refutes, supports
 * diversified by publisher. One line per block.
 */
/** `must`: block links that get a key whatever the selection (a frozen judgment's evidence, D-48 第 4 轮). */
export function selectEvidence(evidence: Evidence[], counter: KeyCounter, must: ReadonlySet<string> = new Set()): { lines: EvidenceLine[]; keyed: Map<string, Evidence> } {
  const rank = (e: Evidence) => GRADE_RANK[e.grade] * 2 + (e.core ? 1 : 0);
  const byRef = new Map<string, Evidence>();
  for (const e of evidence.filter((x) => x.stance === 'refutes')) {
    const prev = byRef.get(e.ref);
    // the same block judged twice (two sub-questions): keep the reading that makes it a challenge
    if (!prev || (!isChallenge(prev) && isChallenge(e)) || (isChallenge(prev) === isChallenge(e) && rank(e) > rank(prev))) byRef.set(e.ref, e);
  }
  const allRefutes = [...byRef.values()];
  const challenges = allRefutes.filter(isChallenge).sort((a, b) => rank(b) - rank(a));
  const ordinary = allRefutes.filter((e) => !isChallenge(e)).sort((a, b) => rank(b) - rank(a)).slice(0, MAX_ORDINARY_REFUTES);
  const refutes = [...challenges, ...ordinary];
  const perPublisher = new Map<string, number>();
  const supports = evidence
    // a simulated interview that agrees with the claim is not evidence: the model is not shown it as something to cite
    .filter((e) => e.stance === 'supports' && !(isExpert(e) && e.simulated))
    .sort((a, b) => GRADE_RANK[b.grade] - GRADE_RANK[a.grade])
    .filter((e) => {
      const k = independenceKey(e);
      const n = perPublisher.get(k) ?? 0;
      perPublisher.set(k, n + 1);
      return n < 2;
    })
    .slice(0, 10);
  const keyed = new Map<string, Evidence>();
  const lines: EvidenceLine[] = [];
  const chosen = [...supports, ...refutes];
  const have = new Set(chosen.map((e) => e.ref));
  for (const e of evidence) {
    if (!must.has(e.ref) || have.has(e.ref) || (e.stance === 'supports' && isExpert(e) && e.simulated)) continue;
    chosen.push(e);
    have.add(e.ref);
  }
  for (const e of chosen) {
    const key = `E${++counter.n}`;
    keyed.set(key, e);
    lines.push({
      key,
      stance: e.stance === 'refutes' ? 'refutes' : 'supports',
      grade: isExpert(e) ? '专家意见' : e.grade,
      origin: originLabel(e),
      publisher: e.publisher,
      published: e.published,
      quote: e.quote.slice(0, 300),
      reason: e.reason,
      core: e.core,
      partial: e.partial,
    });
  }
  return { lines, keyed };
}

export function noEvidenceJudgment(claim: PlanClaim, subNotes: { id: string; question: string; note: string }[]): Judgment {
  return {
    verdict: '证据不足',
    rebutted: [],
    revised_statement: null,
    support_lines: [],
    counter_lines: [],
    challenge_responses: [],
    revised_assertions: [],
    reasoning: '这次检索没有找到能用来判断这个论点的证据，所以不下结论，保持证据不足。',
    model_knowledge: [],
    so_what: [],
    // T55: what is missing only; why the search stopped is a fact of the run (its steps, cards and log), not of the topic
    gaps: subNotes.length ? subNotes.map((n) => `没有能回答「${n.question}」的证据`) : ['这次没有执行任何检索'],
    expert_questions: [`「${claim.statement}」有没有可核对的数据或一线经验？`],
    conditions: [],
    answer: '',
    answer_segments: [],
    reasons: [],
    changed: '',
    short_statement: '',
  };
}

/**
 * The judge call; an answer that never parses must not end a run of 20 minutes. The claim is written as 证据不足
 * with the reason, its challenges stay unanswered, so the self-check keeps the report a draft (nothing is invented).
 */
async function judgeOrFallback(run: ResearchRun, claim: PlanClaim, call: () => Promise<Judgment>): Promise<Judgment> {
  try {
    return await call();
  } catch (e) {
    if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
    const what = e instanceof LlmTruncatedError ? '拆分以后，判断那一次的输出仍然到了长度上限' : '判断这一步的模型输出两次都不是合格的 JSON';
    await run.log('research:judge-failed', `${claim.id} ${what}：${e.message.slice(0, 200)}`, '这个论点不下判断，报告存成草稿');
    return {
      ...noEvidenceJudgment(claim, []),
      reasoning: `${what}，这次没有下判断，保持证据不足；证据和挑战见上表，需要重新跑判断。`,
      gaps: ['判断这一步没有完成，需要重新跑'],
      expert_questions: [],
    };
  }
}

type JudgeInput = Parameters<typeof judgePrompt>[0];
type JudgeRun = Pick<ResearchRun, 'llm' | 'log' | 'signal'>;

/**
 * Output room for a judge call. deepseek-flash thinks before it answers and the thinking counts against the limit:
 * C1 with 24 refutes (small run) used 15,914 of 16,000 tokens, 13,254 of them thinking and ~2,700 the JSON; the full
 * run's C1 was cut off twice. The model allows far more (384K); twice the default is room, not the fix.
 */
export const JUDGE_MAX_OUTPUT_TOKENS = 32_000;
/** More refutes than this: the verdict first, then the responses in batches (the thinking grows with the refutes weighed at once). */
export const JUDGE_SPLIT_AT = 12;
export const RESPONSE_BATCH = 6;

/**
 * Batches of refute keys to answer, a source's refutes kept together (so the ones that say the same thing can share
 * a row), at most `size` each.
 */
export function responseBatches(keys: string[], keyed: Map<string, Evidence>, size = RESPONSE_BATCH): string[][] {
  const bySource = new Map<string, string[]>();
  for (const k of keys) {
    const src = (keyed.get(k)?.ref ?? k).split('#')[0];
    bySource.set(src, [...(bySource.get(src) ?? []), k]);
  }
  const out: string[][] = [];
  let cur: string[] = [];
  for (const group of bySource.values()) {
    for (let i = 0; i < group.length; i += size) {
      const part = group.slice(i, i + size);
      if (cur.length + part.length > size) {
        out.push(cur);
        cur = [];
      }
      cur.push(...part);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** One batch of responses; a batch cut off at the limit is halved, one that still fails stays unanswered (the self-check lists it). */
async function respond(run: JudgeRun, claimId: string, input: JudgeInput, judged: Judgment, keys: string[]): Promise<Judgment['challenge_responses']> {
  try {
    const r = await run.llm(
      `judge:${claimId}:responses`,
      responsesPrompt({ claim: input.claim, evidence: input.evidence, keys, verdict: judged.verdict, revisedStatement: judged.revised_statement, reasoning: judged.reasoning }),
      responsesSchema,
    );
    // a row only about another batch's refutes would answer them twice
    return r.challenge_responses.filter((c) => responseKeys(c).some((k) => keys.includes(k)));
  } catch (e) {
    if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
    if (e instanceof LlmTruncatedError && keys.length > 1) {
      const half = Math.ceil(keys.length / 2);
      return [...(await respond(run, claimId, input, judged, keys.slice(0, half))), ...(await respond(run, claimId, input, judged, keys.slice(half)))];
    }
    await run.log('research:judge-responses-failed', `${claimId} 回应 ${keys.map((k) => `[${k}]`).join('、')} 的输出不合格：${e.message.slice(0, 200)}`, '这几条暂时没有回应：自检会列出来，交给修复那一步');
    return [];
  }
}

/**
 * The judge's model calls. Few refutes: one call. Many refutes, or one call cut off at the limit (finish_reason =
 * length: not asked again as it was): the verdict on all the evidence first, then the responses batch by batch.
 */
export async function judgeCalls(run: JudgeRun, claimId: string, input: JudgeInput, keyed: Map<string, Evidence>): Promise<Judgment> {
  const refutes = refuteKeys(input.evidence);
  const opts = { maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS };
  let why = `有 ${refutes.length} 条反驳，一次写完的话模型的思考会用掉大部分输出上限`;
  if (refutes.length <= JUDGE_SPLIT_AT) {
    try {
      return await run.llm(`judge:${claimId}`, judgePrompt(input), judgmentSchema, opts);
    } catch (e) {
      if (!(e instanceof LlmTruncatedError) || refutes.length === 0) throw e;
      why = `判断的输出到了长度上限（${JUDGE_MAX_OUTPUT_TOKENS} tokens，含模型思考）被截断，不照原样再问`;
    }
  }
  const batches = responseBatches(refutes, keyed);
  await run.log('research:judge-split', `${claimId}：先判断，再分 ${batches.length} 批逐条回应 ${refutes.length} 条反驳`, why);
  const judged = await run.llm(`judge:${claimId}:verdict`, judgePrompt({ ...input, responses: 'separate' }), judgmentSchema, opts);
  const answered = await Promise.all(batches.map((keys) => respond(run, claimId, input, judged, keys)));
  return { ...judged, challenge_responses: answered.flat() };
}

/** `label`: the hypothesis' label (hypothesisLabel: H2-1 in a question tree, H{n} in an older plan). */
/**
 * `frozen` (a rewrite of the writing only, D-48 第 4 轮): vN's conditions are kept as they were, their evidence keyed
 * again by block link; the model is asked only to write. Not frozen (`frozen` null when vN's could not be read, or its
 * evidence is not here): judged again, and why is kept in `frozenFallback`.
 */
export async function judgeClaim(run: ResearchRun, claim: PlanClaim, label: string, counter: KeyCounter, frozen?: FrozenClaim | { unreadable: string }, alsoKey: ReadonlySet<string> = new Set()): Promise<ClaimResult> {
  const evidence = run.evidenceFor(claim.id);
  const lock = frozen && 'conditions' in frozen ? frozen : null;
  // what a kept card cites, and what a kept Summary / recommendation cites (alsoKey), keyed again whatever the selection
  const storedRefs = lock?.keep && lock.stored ? storedKeys(lock.stored.judgment).flatMap((k) => (lock.stored!.keyed[k] ? [lock.stored!.keyed[k]] : [])) : [];
  const { lines, keyed } = selectEvidence(evidence, counter, new Set([...(lock?.conditions.flatMap((c) => c.refs) ?? []), ...storedRefs, ...alsoKey]));
  const keyOf = new Map([...keyed].map(([k, e]) => [e.ref, k]));
  let fallback = frozen && 'unreadable' in frozen ? frozen.unreadable : null;
  const lost = lock ? [...new Set(lock.conditions.flatMap((c) => c.refs))].filter((r) => !keyOf.has(r)) : [];
  if (lost.length) fallback = `vN 条件引用的证据这次没有恢复：${lost.slice(0, 3).join('、')}${lost.length > 3 ? ` 等 ${lost.length} 条` : ''}`;
  const planned0 = plannedConditions(claim);
  if (lock && !fallback && (lock.conditions.length !== planned0.length || lock.conditions.some((c, i) => c.n !== planned0[i].n))) fallback = `vN 逐条判的条件（${lock.conditions.map((c) => c.n).join('、')}）和这次计划里的（${planned0.map((c) => c.n).join('、')}）对不上`;
  const locked = lock && !fallback ? lockedConditions(lock, keyOf, planned0) : null;
  if (fallback) await run.log('research:frozen-fallback', `${claim.id}（${label}）：${fallback}`, '只重写时这个假设读不回 vN 的判断：重新判断，本版变化里写出来');

  let hypothesisPath: string | null = null;
  if (claim.hypothesis) {
    const res = await run.ctx.vault.resolveLink(claim.hypothesis, run.ctx.workspacePath);
    if (res.ok) hypothesisPath = res.path;
  }

  const subNotes = claim.sub_questions
    .filter((q) => run.subStates.has(q.id))
    .map((q) => ({ id: q.id, question: q.question, note: run.subStates.get(q.id)!.stopNote }));

  const planned = plannedConditions(claim);
  // Nothing to judge on: no model call. The model used to answer "the briefing's evidence list is empty" here,
  // and that sentence reached the report. The words of a no-evidence result are written by code.
  const input: JudgeInput = {
    claim: run.claimBrief(claim),
    hypothesisLabel: claim.hypothesis,
    evidence: lines,
    subQuestions: claim.sub_questions.map((q) => ({
      id: q.id,
      question: q.question,
      methods: q.methods,
      stop: run.subStates.get(q.id)?.stopNote ?? '本次没有执行',
    })),
    context: run.contextText.slice(0, 3500),
    exploratory: run.ctx.exploratory,
    conditions: planned,
    ...(locked ? { locked: { conditions: locked.map((c) => ({ n: c.n, status: c.status, keys: c.keys, note: c.note })), verdict: verdictFromConditions(locked.map((c) => c.status)) } } : {}),
  };
  if (locked) {
    // 第 5 轮 --only: a card not listed is vN's, word for word (its judgment with this run's keys), no model call
    const kept = lock?.keep && lock.stored ? rekeyed(lock.stored.judgment, lock.stored.keyed, keyOf) : null;
    if (lock?.keep && !kept) await run.log('research:frozen-keep-failed', `${claim.id}（${label}）：判断文件里的卡片有证据这次没有恢复，改成只走写作`, '局部重做：这张卡没法原样沿用');
    // only the writing: the conditions as vN had them, the verdict from them by code
    const written = kept ?? (await judgeOrFallback(run, claim, () => judgeCalls(run, claim.id, input, keyed)));
    const result = settleFrozen(written, locked);
    await logNoSegments(run, claim, result.judgment);
    if (lock?.verdict && lock.verdict !== result.verdict) await run.log('research:frozen-verdict', `${claim.id}：vN 写的是 ${lock.verdict}，按沿用的条件推出 ${result.verdict}`, '整体判断由代码按条件推出');
    return { claim, label, hypothesisPath, hypothesisLink: claim.hypothesis, evidence, keyed, challenges: challengeKeys(lines), ...result, subNotes, ...(kept ? { kept: true } : {}) };
  }
  const judgment =
    lines.length === 0
      ? // nothing found: every condition is 证据不足, by code
        { ...noEvidenceJudgment(claim, subNotes), conditions: planned.map((c) => ({ n: c.n, status: '证据不足' as const, keys: [], note: '这次没有找到证据' })), changed: '还判断不了，这次没有找到证据' }
      : await judgeOrFallback(run, claim, () => judgeCalls(run, claim.id, input, keyed));
  const settled = settleJudgment(label, judgment, evidence, keyed, planned);
  if (settled.fallback) await run.log('research:conditions-fallback', `${claim.id}：${settled.fallback}`, '按原来的判法：模型给判断，系统复核（不阻止交付）');
  if (lines.length) await logNoSegments(run, claim, settled.result.judgment);

  return { claim, label, hypothesisPath, hypothesisLink: claim.hypothesis, evidence, keyed, challenges: challengeKeys(lines), ...settled.result, subNotes, ...(fallback ? { frozenFallback: fallback } : {}) };
}

/** D-48 第 4 轮 S1: a card answered without answer_segments is rendered from `answer` (M4); said in the log. */
async function logNoSegments(run: ResearchRun, claim: PlanClaim, j: Judgment): Promise<void> {
  if (claim.question && !j.answer_segments.length && j.answer.trim()) await run.log('research:answer-segments-missing', `${claim.id} 没有写 answer_segments：用 answer「${j.answer.slice(0, 40)}」`, '回答分段由代码拼接；没有分段就用整句回答兜底');
}

/** vN's conditions with this run's keys: each block link to its key, the note's footnotes where they stood. */
function lockedConditions(lock: FrozenClaim, keyOf: Map<string, string>, planned: { n: number; text: string }[]): CheckedCondition[] {
  return lock.conditions.map((c, i) => ({
    n: c.n,
    label: c.label,
    text: planned[i]?.text ?? c.text,
    status: c.status,
    keys: c.refs.map((r) => keyOf.get(r)!),
    note: c.note.replace(/⟦(\d+)⟧/g, (_, j: string) => `[${keyOf.get(c.refs[Number(j)])}]`),
    ...(c.adjusted ? { adjusted: c.adjusted } : {}),
  }));
}

/**
 * A frozen hypothesis settled: its conditions untouched (no check again: they are vN's, 系统复核 included), the verdict
 * derived from them, "改了什么" the model's unless it does not fit that verdict (then code's, as settleJudgment does).
 */
export function settleFrozen(written: Judgment, locked: CheckedCondition[]): Pick<ClaimResult, 'judgment' | 'verdict' | 'adjusted' | 'adjustNote' | 'revisedStatement' | 'assertions' | 'conditions'> {
  const verdict = verdictFromConditions(locked.map((c) => c.status));
  const own = written.changed.trim();
  const changed = own && !(verdict === '需要修改' && /^没改/.test(own)) && !(verdict === '成立' && !/^没改/.test(own) && /不成立|证据不足|还判断不了/.test(own)) ? own : changedOf(verdict, locked);
  const judgment: Judgment = {
    ...written,
    verdict,
    conditions: locked.map((c) => ({ n: c.n, status: c.status, keys: c.keys, note: c.note })),
    changed,
    revised_statement: verdict === '需要修改' ? changed : null,
  };
  return { judgment, verdict, adjusted: false, adjustNote: '', revisedStatement: verdict === '需要修改' ? changed : null, assertions: [], conditions: locked };
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/**
 * The plan conditions a question-tree hypothesis is judged on, one by one (D-48): as approved, in the plan's order and
 * numbering, minus a line that only states the judging standard. An older plan's claims are judged the old way.
 */
export function plannedConditions(claim: Pick<PlanClaim, 'question' | 'conditions'>): { n: number; text: string }[] {
  if (!claim.question) return [];
  return claim.conditions.map((c, i) => ({ n: i + 1, text: conditionText(c).trim() })).filter((c) => c.text && !isCriterionCondition(c.text));
}

type Settled = Pick<ClaimResult, 'judgment' | 'verdict' | 'adjusted' | 'adjustNote' | 'revisedStatement' | 'assertions' | 'conditions'>;

/**
 * The verdict code lets stand. With the plan's conditions judged one by one: each status checked (checkCondition),
 * the verdict derived from them (verdictFromConditions), then §9.5 on the whole (enforceVerdict); "改了什么" is the
 * revised statement. Without them (an older plan; the model left them out or numbered them otherwise): the model's
 * verdict under §9.5, as before, and `fallback` says why.
 */
export function settleJudgment(label: string, judgment: Judgment, evidence: Evidence[], keyed: Map<string, Evidence>, planned: { n: number; text: string }[]): { result: Settled; fallback: string | null } {
  const listed = judgment.rebutted.flatMap((k) => (keyed.get(k.trim()) ? [keyed.get(k.trim())!.ref] : []));
  const rebutted = [...new Set([...listed, ...answeredRefutes(judgment, keyed, planned)])];
  const finish = (j: Judgment, verdict: Judgment['verdict'], conditions: CheckedCondition[], note: (v: Judgment['verdict']) => string, handled: string[]): Settled => {
    const check = enforceVerdict({ verdict, rebutted: handled, revisedStatement: j.revised_statement }, evidence);
    const adjusted = check.verdict !== j.verdict;
    return {
      judgment: j,
      verdict: check.verdict,
      adjusted,
      adjustNote: adjusted ? [note(check.verdict), check.adjusted ? check.note : ''].filter(Boolean).join('；') : '',
      revisedStatement: check.verdict === '需要修改' ? j.revised_statement : null,
      assertions: check.verdict === '需要修改' ? checkAssertions(label, j, keyed) : [],
      conditions,
    };
  };
  const old = (fallback: string | null) => {
    const check = enforceVerdict({ verdict: judgment.verdict, rebutted, revisedStatement: judgment.revised_statement }, evidence);
    return {
      result: {
        judgment,
        verdict: check.verdict,
        adjusted: check.adjusted,
        adjustNote: check.note,
        revisedStatement: check.verdict === '需要修改' ? judgment.revised_statement : null,
        assertions: check.verdict === '需要修改' ? checkAssertions(label, judgment, keyed) : [],
        conditions: [],
      },
      fallback,
    };
  };
  if (!planned.length) return old(null);
  const given = judgment.conditions;
  const want = planned.map((c) => c.n);
  if (given.length !== planned.length || !want.every((n) => given.filter((c) => c.n === n).length === 1)) {
    return old(given.length ? `模型逐条判的条件是 ${given.map((c) => c.n).join('、')}，计划里要判的是 ${want.join('、')}，对不上` : '模型没有逐条判计划里的条件');
  }
  const rb = new Set(rebutted);
  const checked = planned.map((p, i): CheckedCondition => ({ ...checkCondition(given.find((g) => g.n === p.n)!, keyed, rb), label: CIRCLED[i] ?? `(${i + 1})`, text: p.text }));
  // D-48 第 2 轮: a refute that stops the 成立 lands on the condition it is aimed at first, then the verdict is derived
  // again: the card never says ①②③ 成立 over a 证据不足 (WS-A v5 H3-2)
  const blockers = verdictFromConditions(checked.map((c) => c.status)) === '成立' ? blockingRefutes(evidence, rebutted) : [];
  const { conditions, unplaced } = placeBlockers(checked, blockers, judgment, keyed);
  const handled = [...rebutted, ...blockers.filter((b) => !unplaced.includes(b)).map((b) => b.ref)];
  const derived = verdictFromConditions(conditions.map((c) => c.status));
  // D-48: "改了什么" is what a 需要修改 changes the hypothesis to; enforceVerdict, the assertions and the recommendation read it
  // there. The model wrote it for its own verdict: when code derived another one (or it is missing), code writes it.
  const own = judgment.changed.trim();
  const changed = derived === judgment.verdict && own && !(derived === '需要修改' && /^没改/.test(own)) ? own : changedOf(derived, conditions);
  const j = { ...judgment, changed, revised_statement: derived === '需要修改' ? changed : judgment.revised_statement };
  const result = finish(j, derived, conditions, (final) =>
    [
      ...conditions.filter((c) => c.adjusted).map((c) => `${c.label} ${c.adjusted}`),
      `按各条件推出${derived}${final !== derived ? `，再按判断标准复核为${final}` : ''}（模型提议 ${judgment.verdict}）`,
    ].join('；'),
    handled,
  );
  // §9.5 on the whole turned the derived verdict: "改了什么" names the refute aimed at no condition, if that was why
  if (result.verdict !== derived) result.judgment = { ...result.judgment, changed: unplaced.length ? unplacedChanged(unplaced[0], judgment, keyed) : '还判断不了：整体证据没过判断标准（见系统复核）' };
  return { result, fallback: null };
}

const CN_DIGITS = '一二三四五六七八九十';

/** The plan conditions a text names, by plan number: "(3)", "条件 3", "第三条" by that number; "③" by the card's label. */
export function conditionRefs(text: string, planned: { n: number }[]): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/([①-⑩])|[（(]\s*(\d{1,2})\s*[）)]|条件\s*[（(]?\s*(\d{1,2}|[一二三四五六七八九十])|第\s*(\d{1,2}|[一二三四五六七八九十])\s*条/g)) {
    const d = m[2] ?? m[3] ?? m[4];
    const n = m[1] ? planned[CIRCLED.indexOf(m[1])]?.n : /\d/.test(d) ? Number(d) : CN_DIGITS.indexOf(d) + 1;
    if (n && planned.some((p) => p.n === n)) out.add(n);
  }
  return [...out];
}

/**
 * D-48 第 2 轮: refutes the 反证表 answers "不影响判断" with a reason that points somewhere, to other evidence ([E3]) or to a
 * plan condition ((3), ③), count as rebutted, like those in `rebutted` (WS-A v5 H3-2: [^101] answered "正落在条件(3)允许的
 * 范围里" still downgraded the card). A bare "不影响" does not: one sentence of the model does not dismiss a refute.
 */
export function answeredRefutes(judgment: Pick<Judgment, 'challenge_responses'>, keyed: Map<string, Evidence>, planned: { n: number }[]): string[] {
  return judgment.challenge_responses.flatMap((c) => {
    if (c.effect !== '不影响判断') return [];
    const own = responseKeys(c);
    const points = (c.response.match(/E\d+/g) ?? []).some((k) => !own.includes(k) && keyed.has(k)) || conditionRefs(c.response, planned).length > 0;
    const reason = c.response.replace(/E\d+/g, '').replace(/不影响(?:判断)?|推断[:：]/g, '').replace(/[\s\p{P}\p{S}\d①-⑩]/gu, '');
    return points && [...reason].length >= 6 ? own.flatMap((k) => (keyed.has(k) ? [keyed.get(k)!.ref] : [])) : [];
  });
}

const rowOf = (e: Evidence, judgment: Judgment, keyed: Map<string, Evidence>) => {
  const key = [...keyed].find(([, x]) => x.ref === e.ref)?.[0];
  return { key, row: key ? judgment.challenge_responses.find((c) => responseKeys(c).includes(key)) : undefined };
};

/**
 * Each refute that stops a 成立 goes to the condition it is aimed at: the one citing it in its keys, else the one its row
 * in the 反证表 names. That condition becomes 证据不足 (系统复核 says why) and cites the refute. `unplaced`: aimed at none.
 */
function placeBlockers(checked: CheckedCondition[], blockers: Evidence[], judgment: Judgment, keyed: Map<string, Evidence>): { conditions: CheckedCondition[]; unplaced: Evidence[] } {
  const conditions = checked.map((c) => ({ ...c }));
  const unplaced: Evidence[] = [];
  for (const b of blockers) {
    const { key, row } = rowOf(b, judgment, keyed);
    const named = row ? conditionRefs(`${row.challenge} ${row.response}`, conditions) : [];
    const target = key ? (conditions.find((c) => c.keys.includes(key)) ?? conditions.find((c) => named.includes(c.n))) : undefined;
    if (!key || !target) {
      unplaced.push(b);
      continue;
    }
    // the refute among the keys: the card's footnote after the note (the 系统复核 text is not expanded)
    if (!target.keys.includes(key)) target.keys = [...target.keys, key];
    const why = `有一条同等级以上的反证没驳倒${row ? `（${trimEnd(row.challenge, 24)}）` : ''}，改为证据不足`;
    target.status = '证据不足';
    target.adjusted = target.adjusted ? `${target.adjusted}；${why}` : why;
  }
  return { conditions, unplaced };
}

const trimEnd = (t: string, max: number) => {
  const s = t.trim().replace(/[。；，.;,\s]+$/, '');
  return [...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
};

/** "改了什么" when a refute aimed at no condition turned the verdict: "还判断不了：<what it says> [E#]，没驳倒" (≤ 40 字). */
function unplacedChanged(b: Evidence, judgment: Judgment, keyed: Map<string, Evidence>): string {
  const { key, row } = rowOf(b, judgment, keyed);
  const frame = (what: string) => `还判断不了：${what}${key ? ` [${key}]` : ''}，没驳倒`;
  return frame(trimEnd(row?.challenge || b.quote, LENGTH_LIMITS.changed - lengthOf(frame(''))));
}

/** "改了什么" written by code from the checked conditions (≤ 40 字 for up to ten conditions). */
function changedOf(verdict: Judgment['verdict'], conditions: CheckedCondition[]): string {
  const labels = (s: CheckedCondition['status']) => conditions.filter((c) => c.status === s).map((c) => c.label).join('');
  if (verdict === '成立') return '没改';
  if (verdict === '不成立') return `${labels('不成立')} 不成立`;
  if (verdict === '证据不足') return `还判断不了，${labels('证据不足')} 缺证据`;
  return [`只有 ${labels('成立')} 成立`, ...(['不成立', '证据不足'] as const).filter((s) => labels(s)).map((s) => `${labels(s)} ${s}`)].join('，').replace(/^只有  成立，/, '');
}

/** One plan condition after code checked the model's status (D-48 格式约定). */
export interface CheckedCondition {
  /** The plan's numbering, from 1, counting the skipped criterion lines. */
  n: number;
  /** ①② …: numbered again after the criterion lines are skipped. */
  label: string;
  /** The condition as approved (conditionText). */
  text: string;
  status: ConditionStatus;
  keys: string[];
  note: string;
  /** Why code changed the model's status ("只有 1 个独立来源，最高 C 级"); absent when it did not. */
  adjusted?: string;
}

export interface CheckedAssertion {
  /** `H2-A1`: what the recommendation may name. */
  key: string;
  text: string;
  /** Evidence keys the model said it rests on (only those that exist in this claim's list). */
  keys: string[];
  status: '已验证' | '待验证';
  /** "2 个独立来源，最高 B 级" / "只有 1 个独立来源，最高 C 级". */
  basis: string;
}

/**
 * A revised statement claims something new: each of its core assertions must clear the 成立 bar on its own
 * (D-29: H2's revised "入围条件" stood on one C-grade retelling). At least 2 independent supports, at least one of
 * them A/B; a simulated interview is not a support. What fails is 待验证: never stated as fact, asked of experts.
 */
export function checkAssertions(label: string, judgment: Judgment, keyed: Map<string, Evidence>): CheckedAssertion[] {
  return judgment.revised_assertions.map((a, i) => {
    const keys = a.keys.map((k) => k.replace(/[[\]\s]/g, '')).filter((k) => keyed.has(k));
    const { passed, basis } = supportBar(keys.map((k) => keyed.get(k)!));
    return { key: `${label}-A${i + 1}`, text: a.text, keys, status: passed ? '已验证' : '待验证', basis };
  });
}

/** Re-apply §9.5 to a (repaired) judgment of an already-gathered claim. */
export function reEnforce(r: ClaimResult, judgment: Judgment): ClaimResult {
  return { ...r, ...settleJudgment(r.label, judgment, r.evidence, r.keyed, plannedConditions(r.claim)).result };
}

/**
 * A challenge listed but never answered (C's v3: the expert's "管得太死会绕过去" was in the evidence, the
 * reasoning did not mention it). Every challenge key needs an entry in challenge_responses with a response;
 * the self-check fails otherwise.
 */
export function challengeFailures(results: ClaimResult[]): CheckFailure[] {
  const out: CheckFailure[] = [];
  for (const r of results) {
    // one row may answer several challenges that say the same thing (D-39): every key it names is answered
    const answered = new Set(r.judgment.challenge_responses.filter((c) => c.response.trim()).flatMap(responseKeys));
    const keyOf = new Map([...r.keyed].map(([k, e]) => [e.ref, k]));
    // every challenge in the evidence record, not only those the judge was shown (D-21: the cut-off ones went unchecked)
    for (const ref of new Set(r.evidence.filter(isChallenge).map((e) => e.ref))) {
      const k = keyOf.get(ref);
      const e = r.evidence.find((x) => x.ref === ref)!;
      if (k && answered.has(k)) continue;
      out.push({
        code: 'unanswered_challenge',
        claimId: r.claim.id,
        message: k
          ? `${r.label} 没有回应挑战 [${k}]（${e.quote.slice(0, 60)}）：要在 challenge_responses 里写明它推翻了假设的什么、为什么不影响判断，或者假设要改成什么`
          : `${r.label} 的挑战 ${ref} 没有交给判断那一步（${e.quote.slice(0, 60)}），因此没有回应`,
        excerpt: k ? `[${k}]` : ref,
      });
    }
  }
  return out;
}

/** A 需要修改 verdict whose revision was not split into assertions cannot be checked: the judge is asked again. */
export function revisionFailures(results: ClaimResult[]): CheckFailure[] {
  return results
    // D-48: judged condition by condition, each condition already went through the bar (checkCondition)
    .filter((r) => r.verdict === '需要修改' && !(r.assertions ?? []).length && !(r.conditions ?? []).length)
    .map((r) => ({
      code: 'unchecked_revision' as const,
      claimId: r.claim.id,
      message: `${r.label} 判了“需要修改”，但修正后的假设没有拆成核心断言（revised_assertions），没法逐条过证据门槛：把修正后的论点拆成 2–4 条断言，每条列出支持它的 [E#]`,
    }));
}
