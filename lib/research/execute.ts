/**
 * Deep Research execution, scheduled BY CODE in the 9 steps of PRD §6.3.1 (CONTRACTS 3-b).
 * Search-the-vault-first, the mandatory counter-evidence round, the stop rule, the §9.5
 * verdict check and the report self-check are steps of this program, not requests to the
 * model. Every tool call goes through the harness' `executeTool`, so the phase check and
 * the log row happen as everywhere else.
 */
import { readerName } from '@/lib/notes/reader-name';
import type { LanguageModel } from 'ai';
import { recommendPrompt, summaryPrompt, repairPrompt } from '@/lib/harness/prompts/research-execute';
import { isPlanApproved } from '@/lib/harness/phases';
import { ToolNotAllowedError, type ToolContext } from '@/lib/harness/types';
import { findRelatedDecisions, type RelatedDecision } from '@/lib/decisions/retrieve';
import { resolveRunModels, type RunModels } from './run-models';
import type { WebToolsClient } from '@/lib/deepseek/web-tools';
import type { ResearchPlanNote } from '@/lib/notes/schema';
import { MAX_REPORT_REPAIR_ROUNDS, type ResearchMode } from './constants';
import { loadResearchContext, projectDecision, renderContext } from './context';
import { serializeEvidence, writeEvidenceSidecar } from './evidence-record';
import type { Inventory, InventorySource, InventorySub } from './inventory';
import { collectOrigins, decisionQuote, renderOriginLines } from './origin';
import { directiveGaps, directiveRefs, type DirectiveRef } from './directives';
import { challengeFailures, JUDGE_MAX_OUTPUT_TOKENS, judgeClaim, reEnforce, revisionFailures, type ClaimResult, type KeyCounter } from './judge';
import type { Emit } from './progress';
import { assertionGaps, isSoftGap, recommendationGaps, reportV2Problems, softGapAction, renderReport, trimEndMark, withCitationFitLine, type ReportFacts } from './report';
import { checkedConclusion, conclusionFlags, subAnswersOf, writeConclusion } from './conclusion';
import { entityFlagsOf } from './entity-check';
import { runCitationVerify } from './citation-verify';
import { numbersNeedingEvidence } from './number-check';
import { judgmentFileOf, rekeyed, saveJudgmentFile, storedKeys, type FrozenClaim } from './judgment-file';
import { citationFit, noCitationFit, citationFixesOf, citationFlagsOf, citationSites, type CitationFix } from './citation-fit';
import { lengthFlags, shortenLong } from './length-check';
import { LlmJsonError } from './llm';
import { describeFlag, describeInferenceFlag, describeKeyFlag, inferenceFlagsOf, isFlagCheck, keyFlagsOf, needsRepair, numberFailures, numberFlagsOf } from './number-repair';
import { citeBareBlockLinks } from './bare-links';
import { hypothesisLabel, isTreePlan, questionTreeOf, treeOrder, type TreePlan } from './question-tree';
import { fixCarriedNumbers, modelReword } from './carried-numbers';
import { ResearchRun, shortError, type PlanClaim, type PlanSubQuestion, type RunTiming, type SubState } from './run';
import { clearRunClient, startRunClient } from './run-client';
import { judgmentSchema, recommendationSchema, summarySchema, type QueryPlan, type Recommendation, type SummaryDraft } from './schemas';
import { checkReportText, citationFailures, decisionFailures, describeFailures, linkFailures, oldWordingHits, type CheckFailure } from './selfcheck';
import { writeProposedVerdicts, type VerdictWriteResult } from './verdict-writer';
import { isExpert, type Evidence } from './evidence';
import type { TaskContext } from '@/lib/harness/tools/task-context';

export interface ExecuteOptions {
  ctx: ToolContext;
  mode: ResearchMode;
  model?: LanguageModel;
  /** Name shown in the log / result when `model` is injected (default: read from the config). */
  modelInfo?: { providerId: string; label: string; model: string };
  /** The second judge of the three-gate citation check; default: provider `kimi` from 90_配置/模型.md, or `deepseek` when the run itself is on kimi. */
  verifyModel?: LanguageModel;
  /** The raw Search/Fetch client (tests inject a fake). Default: the configured DeepSeek client. */
  webClient?: WebToolsClient;
  emit?: Emit;
  signal?: AbortSignal;
  /** Run only these plan claims (default: all, or the first one in small mode). */
  claimIds?: string[];
  /** Override EVAL_CALL_TIMEOUT_MS (tests). */
  evalTimeoutMs?: number;
  /** Override MAX_REPORT_REPAIR_ROUNDS. */
  repairRounds?: number;
}

export interface ExecuteResult {
  reportPath: string;
  reportName: string;
  delivered: boolean;
  failedChecks: string[];
  verdicts: VerdictWriteResult[];
  claims: { id: string; verdict: string; adjusted: boolean; evidence: number }[];
  usage: { searches: number; fetches: number; retries: number };
  counts: { kbSources: number; webSources: number; droppedQuotes: number };
  durationMs: number;
  /** Where the time went: model calls vs Search vs Fetch vs ingest (incl. link check), and per step. Spans overlap, so sums can exceed durationMs. */
  timing: RunTiming;
  /** Which model ran (from 90_配置/模型.md at the start of the run) — M4 4.3. */
  model: { providerId: string; label: string; model: string };
}

const slug = () => Date.now().toString(36);
export const linkTo = (path: string) => {
  const noExt = path.replace(/\.md$/, '');
  return `[[${noExt}|${readerName(noExt.split('/').pop()!)}]]`;
};

/** Which plan claims / sub-questions this run covers (PRD §9.6 caps). */
export function selectScope(
  claims: PlanClaim[],
  limits: { maxClaims: number; maxSubQuestions: number },
  claimIds?: string[],
  /** The claims' reading order (treeOrder: a question tree's, depth first). A small run takes the first. */
  order?: string[],
): { selected: { claim: PlanClaim; subs: PlanSubQuestion[] }[]; notExecuted: string[] } {
  const rank = (c: PlanClaim) => (order?.includes(c.id) ? order.indexOf(c.id) : claims.indexOf(c));
  const ordered = order?.length ? [...claims].sort((a, b) => rank(a) - rank(b)) : claims;
  const pool = claimIds?.length ? ordered.filter((c) => claimIds.includes(c.id)) : ordered;
  const chosen = pool.slice(0, limits.maxClaims);
  const notExecuted: string[] = [...ordered.filter((c) => !chosen.includes(c)).map((c) => c.id)];
  const selected = chosen.map((claim) => {
    // sub-questions that can be answered from the vault / web first; expert-only ones last
    const ordered = [...claim.sub_questions].sort((a, b) => Number(a.methods.every((m) => m === '专家访谈')) - Number(b.methods.every((m) => m === '专家访谈')));
    const subs = ordered.slice(0, limits.maxSubQuestions);
    notExecuted.push(...claim.sub_questions.filter((q) => !subs.includes(q)).map((q) => q.id));
    return { claim, subs: claim.sub_questions.filter((q) => subs.includes(q)) };
  });
  return { selected, notExecuted };
}

export async function executeResearch(opts: ExecuteOptions): Promise<ExecuteResult> {
  return researchRun(opts);
}

/** The harness' own gate, repeated: no approved plan, no research tools, no run. */
function gate(ctx: ToolContext): { plan: ResearchPlanNote; planPath: string; researchDir: string } {
  const plan = ctx.research?.plan ?? null;
  if (ctx.phase !== 'research_execute' || !ctx.research || !plan || !ctx.research.planPath || !isPlanApproved(plan)) {
    throw new ToolNotAllowedError('research.execute', ctx.phase, 'research plan is not approved');
  }
  return { plan, planPath: ctx.research.planPath, researchDir: ctx.research.dir };
}

interface Prepared {
  plan: ResearchPlanNote;
  planPath: string;
  researchDir: string;
  run: ResearchRun;
  rc: Awaited<ReturnType<typeof loadResearchContext>>;
  related: RelatedDecision[];
  modelInfo: { providerId: string; label: string; model: string };
  judgmentInfo: RunModels['judgmentInfo'];
}

/** The gate, the run's client and model, and the project context both halves of a run start from. */
async function prepare(opts: ExecuteOptions): Promise<Prepared> {
  const { ctx, mode } = opts;
  const emit: Emit = opts.emit ?? (() => {});
  const { plan, planPath, researchDir } = gate(ctx);
  const inner = opts.webClient ?? (await ctx.webTools());
  const client = startRunClient(researchDir, inner, mode);
  try {
    const { model, judgmentModel, modelInfo, judgmentInfo } = await resolveRunModels(ctx.vault, { model: opts.model, modelInfo: opts.modelInfo });
    const rc = await loadResearchContext(ctx, { sources: false });
    // M3 (3.3): the confirmed decisions that bind this research, found along relates_to (never an AI draft).
    const related = await findRelatedDecisions(ctx);
    rc.decisions = related.map((d) => ({ path: d.path, name: d.name, status: '已确认', excerpt: d.decision.length > 700 ? `${d.decision.slice(0, 700)}…` : d.decision }));
    const run = new ResearchRun({ ctx, mode, model, judgmentModel, client, emit, signal: opts.signal, contextText: renderContext(rc), evalTimeoutMs: opts.evalTimeoutMs });
    return { plan, planPath, researchDir, run, rc, related, modelInfo, judgmentInfo };
  } catch (e) {
    clearRunClient(researchDir);
    throw e;
  }
}

/** `executeResearch` with an optional stop after the vault; the two exported entry points call this one. */
/** The first step of every run (ui-3b). */
export const TASK_CONTEXT_STEP = '读取决策契约、研究计划和 Senior 意见';

async function researchRun(opts: ExecuteOptions): Promise<ExecuteResult> {
  const t0 = Date.now();
  const { ctx, mode } = opts;
  const { plan, planPath, researchDir, run, rc, related, modelInfo, judgmentInfo } = await prepare(opts);
  try {
    // ── 0 读取任务背景（D-64 T20）：先读，再做 ─────────────────────────────────
    run.step('s0:task', 1, TASK_CONTEXT_STEP, 'running');
    const tc = await run.tool<TaskContext>('read_task_context', {}, '开工前先读任务背景：决策契约、研究计划、负责人意见、已确认的决定');
    const contractQ = typeof tc.contract?.question === 'string' ? tc.contract.question : null;
    run.step('s0:task', 1, TASK_CONTEXT_STEP, 'done', [contractQ ? `契约：${contractQ}` : '项目还没有决策契约', `意见 ${tc.opinions.length} 条`, `已确认决定 ${tc.decisions.length} 条`].join('；'));

    // ── 1 拆问题 ─────────────────────────────────────────────────────────────
    const { selected, notExecuted } = selectScope(plan.claims, run.limits, opts.claimIds, treeOrder(plan));
    run.step('s1', 1, '拆问题：按批准的调查计划', 'done', `${selected.map((s) => `${run.claimName(s.claim)}（${s.subs.length} 个要查的问题）`).join('；')}${notExecuted.length ? `；本次不执行：${notExecuted.map((id) => run.itemName(id)).join('、')}` : ''}`);
    await run.log('research:start', `开始执行 ${planPath.split('/').pop()?.replace(/\.md$/, '')}（${mode === 'small' ? '试水调查' : '完整调查'}）：${selected.map((s) => s.claim.id).join('、')}`, `只做计划里写了的 · ${ctx.exploratory ? '探索性（G1 之前）' : 'G1 之后'} · 模型：${modelInfo.label}（${modelInfo.model}）${judgmentInfo ? ` · 判断用：${judgmentInfo.label}（${judgmentInfo.model}）` : ''}`);
    run.reserve = { searches: selected.length, fetches: selected.length };

    // ── 2 项目 context：决定、高层指示、团队知识（每次检索一张卡片）────────────
    run.step('s2:ctx', 2, '查知识库：项目 context（已确认的决定、高层指示、团队知识）', 'running');
    const ctxHits: string[] = [];
    for (const dir of [`${ctx.projectPath}/会议`, '00_团队知识']) {
      try {
        const out = await run.tool<{ hits: { path: string; title: string }[] }>('vault_search', { query: '', dir, limit: 10 }, `查 ${dir} 里有没有对这次调查有约束的决定、指示或方法`);
        ctxHits.push(...out.hits.map((h) => h.title));
      } catch {
        /* missing folder is fine */
      }
    }
    for (const d of related) {
      try {
        await run.tool('vault_read', { path: d.path }, `沿 relates_to 找到已确认的决定「${d.name}」（${d.via.join('；')}），这次调查要遵循它`);
        ctxHits.push(`决定「${d.name}」`);
      } catch {
        /* unreadable decision: skip */
      }
    }
    run.step('s2:ctx', 2, '查知识库：项目 context（已确认的决定、高层指示、团队知识）', 'done', ctxHits.length ? ctxHits.join('、') : '没有找到');

    // ── per claim: 2 (vault half) and 6 (vault half) ─────────────────────────
    // The vault halves of every claim run before any web half (M2_5b-2: a run may stop between them).
    const kbPlans = new Map<string, QueryPlan>();
    const counterKbs = new Map<string, { qp: QueryPlan; notes: string[] } | null>();
    for (const { claim, subs } of selected) {
      const kbs = await Promise.all(subs.map((q) => kbPass(run, claim, q)));
      subs.forEach((q, i) => {
        const kb = kbs[i];
        if (kb) kbPlans.set(q.id, kb.qp);
      });
      counterKbs.set(claim.id, await counterKbPass(run, claim, subs[0]));
    }

    // D-64 T22 (D2): the internal pass is recorded, then whatever has a gap goes to the web by itself — no stop to ask
    const inventory = inventoryOf({ run, plan, planPath, mode, selected, notExecuted, kbPlans, counterKbs });
    const n = (status: InventorySub['status']) => inventory.subs.filter((s) => s.status === status).length;
    const webOff = ctx.selection?.web === false;
    run.step(
      's2:internal',
      2,
      '在文件管理的资料中检索',
      'done',
      `${inventory.subs.length} 个要查的问题：够下判断 ${n('enough')} 个，有缺口 ${n('gap')} 个，${webOff ? '负责人关掉了联网，只用内部资料' : '自动上网补查'}；只查知识库 ${n('kb_only')} 个`,
    );
    if (webOff) {
      for (const { subs } of selected) for (const q of subs) run.step(`s3:${q.id}`, 3, `查网上 · ${run.subName(q)}`, 'skipped', '负责人关掉了联网');
      run.stats.skipped.push('负责人关掉了联网：有缺口的子问题没有上网补查');
      return await judgeAndWrite({ run, plan, planPath, researchDir, selected, notExecuted, related, workplanPath: rc.workplan?.path, modelInfo, judgmentInfo, verifyModel: opts.verifyModel, t0, repairRounds: opts.repairRounds });
    }

    // ── per claim: 2 3 → 6 → 7 ───────────────────────────────────────────────
    for (const { claim, subs } of selected) {
      // the claim's sub-questions go to the web at once (as phaseA did), each with its own held fetch
      firstRoundReserve(run, subs);
      await Promise.all(
        subs.map(async (q) => {
          // the fetch held for this sub-question's first web round is released as it starts (or stops)
          const release = heldFetch(run);
          try {
            const qp = kbPlans.get(q.id);
            if (qp) await webPass(run, claim, q, qp, release);
          } finally {
            release();
          }
        }),
      );
      await counterWeb(run, claim, subs[0], counterKbs.get(claim.id) ?? null);
      for (const q of subs) await fillGaps(run, claim, q);
      emitExtractRows(run, subs);
    }

    return await judgeAndWrite({ run, plan, planPath, researchDir, selected, notExecuted, related, workplanPath: rc.workplan?.path, modelInfo, judgmentInfo, verifyModel: opts.verifyModel, t0, repairRounds: opts.repairRounds });
  } finally {
    clearRunClient(researchDir);
  }
}

/** `counterKb`, but an error in the vault half is recorded (as `counterRound` does) instead of ending the run. */
async function counterKbPass(run: ResearchRun, claim: PlanClaim, anchor: PlanSubQuestion): Promise<{ qp: QueryPlan; notes: string[] } | null> {
  try {
    return await counterKb(run, claim, anchor);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { sid, title } = counterStep(run, claim);
    run.stats.skipped.push(`${claim.id} 反证检索出错：${msg}`);
    run.step(sid, 6, title, 'done', `出错：${msg}`);
    return null;
  }
}

/** The 内部资料清单 of a run that stops after the vault. */
function inventoryOf(o: {
  run: ResearchRun;
  plan: ResearchPlanNote;
  planPath: string;
  mode: ResearchMode;
  selected: { claim: PlanClaim; subs: PlanSubQuestion[] }[];
  notExecuted: string[];
  kbPlans: Map<string, QueryPlan>;
  counterKbs: Map<string, { qp: QueryPlan; notes: string[] } | null>;
}): Inventory {
  const { run, plan } = o;
  const subs: InventorySub[] = [];
  for (const { claim, subs: qs } of o.selected) {
    const label = hypothesisLabel(plan, claim.id);
    for (const q of qs) {
      const st = run.subStates.get(q.id);
      const webAllowed = q.methods.includes('网络');
      const status: InventorySub['status'] = st?.stop === 'decidable' ? 'enough' : !webAllowed ? 'kb_only' : 'gap';
      const sources = new Map<string, InventorySource>();
      for (const e of run.evidence) {
        if (e.claimId !== claim.id || e.subQuestionId !== q.id || e.round === 'counter') continue;
        const s = sources.get(e.path) ?? { path: e.path, title: e.sourceName, grade: e.grade, simulated: e.simulated === true, supports: 0, refutes: 0 };
        if (e.stance === 'supports') s.supports += 1;
        else if (e.stance === 'refutes') s.refutes += 1;
        sources.set(e.path, s);
      }
      subs.push({
        claimId: claim.id,
        label,
        subId: q.id,
        question: q.question,
        webAllowed,
        sources: [...sources.values()],
        status,
        note: status === 'gap' ? run.describeGap(claim.id, q.id) : (st?.stopNote ?? ''),
        tried: st?.tried ?? [],
        webQueries: o.kbPlans.get(q.id)?.web_queries ?? [],
      });
    }
  }
  const counterNotes: Record<string, string> = {};
  const counterQueries: Record<string, string[]> = {};
  for (const { claim } of o.selected) {
    const c = o.counterKbs.get(claim.id) ?? null;
    counterNotes[claim.id] = c ? c.notes.join('；') : '出错：知识库检索出错';
    counterQueries[claim.id] = c?.qp.web_queries ?? [];
  }
  const usage = run.client.usage();
  return {
    version: 1,
    planPath: o.planPath,
    planVersion: plan.version,
    mode: o.mode,
    createdAt: run.ctx.now().toISOString(),
    claimIds: o.selected.map((s) => s.claim.id),
    notExecuted: o.notExecuted,
    subs,
    counterNotes,
    counterQueries,
    evidence: serializeEvidence(run.evidence),
    searches: usage.searches,
    fetches: usage.fetches,
  };
}

/** PRD §6.3.1 is nine steps, in code: a sub-question that never reached step 4 still gets its row, with the reason. */
function emitExtractRows(run: ResearchRun, subs: PlanSubQuestion[]) {
  for (const q of subs) {
    if (run.extractSteps.get(q.id)) continue;
    const st = run.subStates.get(q.id);
    run.step(`s4:${q.id}`, 4, `提取 · ${run.subName(q)}`, 'skipped', st && st.webRounds === 0 ? `没有联网抓新页面（${st.stopNote || '知识库已够'}）；知识库里的论断入库时已逐字核对过，不需要再提取` : '联网抓到的页面里没有可提取的相关内容');
  }
}

/** What steps 8–9 need from a run whose evidence is in: a full run's steps 1–7, or a rewrite's restored record (D-48). */
export interface JudgeAndWriteOptions {
  run: ResearchRun;
  plan: ResearchPlanNote;
  planPath: string;
  researchDir: string;
  /** The claims to judge, in reading order, and what this run does not cover (both go into 怎么查的). */
  selected: { claim: PlanClaim; subs: PlanSubQuestion[] }[];
  notExecuted: string[];
  /** The confirmed decisions found along relates_to. */
  related: RelatedDecision[];
  workplanPath?: string;
  modelInfo: { providerId: string; label: string; model: string };
  judgmentInfo: RunModels['judgmentInfo'];
  /** D-56 ⑦: the second judge of the three-gate citation check (default: `kimi`, or `deepseek` when the run is on kimi). */
  verifyModel?: LanguageModel;
  /** When the run started (durationMs). */
  t0: number;
  /** Override MAX_REPORT_REPAIR_ROUNDS. */
  repairRounds?: number;
  /** A rewrite's own: merged into the report's facts (本版变化), its frontmatter (rewrite_of) and research_run (rewrite: true). */
  facts?: Partial<ReportFacts>;
  frontmatter?: Record<string, unknown>;
  researchRun?: Partial<ResearchRunFacts>;
  /** D-48 第 4 轮, a rewrite of the writing only: per claim, vN's judgment to keep, or why it could not be read. */
  frozen?: Map<string, FrozenClaim | { unreadable: string }>;
  /**
   * 第 5 轮 --only: vN's Summary and recommendation to keep as they were (not listed), keyed as vN keyed them; and
   * the parts redone, for 本版变化 ("H2、H3、一句话回答、推荐表").
   */
  keep?: { summary?: Omit<SummaryDraft, 'recommendation'>; recommendation?: Recommendation; keyed: Record<string, string>; redone: string[]; flagged?: boolean };
  /**
   * --rerender: everything kept, nothing asked of the model (no repair round, no citation check, no number rewording:
   * the citation check runs after, recheck-citations); the note says why it was rendered again.
   */
  rerender?: { note: string };
}

/** Steps 8–9: judge each claim, write the report, self-check and repair, store it and the proposed verdicts. */
export async function judgeAndWrite(o: JudgeAndWriteOptions): Promise<ExecuteResult> {
  const { run, plan, planPath, researchDir, selected, notExecuted, related, modelInfo, t0 } = o;
  const { ctx, mode, client } = run;
  // ── 8 判断 ───────────────────────────────────────────────────────────────
  run.step('s8', 8, '判断：按判断标准为每个论点提议判断（系统复核）', 'running');
  const counter: KeyCounter = { n: 0 };
  let results: ClaimResult[] = [];
  // a kept Summary / recommendation cites evidence of some hypotheses: keyed again with them
  const keptRefs = new Set(o.keep ? storedKeys([o.keep.summary, o.keep.recommendation]).flatMap((k) => (o.keep!.keyed[k] ? [o.keep!.keyed[k]] : [])) : []);
  for (const s of selected) results.push(await judgeClaim(run, s.claim, hypothesisLabel(plan, s.claim.id), counter, o.frozen ? (o.frozen.get(s.claim.id) ?? { unreadable: 'vN 里没有这个假设的判断' }) : undefined, keptRefs));
  run.step('s8', 8, '判断：按判断标准为每个论点提议判断（系统复核）', 'done', results.map((r) => `${r.label} → ${r.verdict}${r.adjusted ? '（系统调整）' : ''}`).join('；'));
  for (const r of results) await run.log('research:verdict', `${r.claim.id} 提议判断：${r.verdict}${r.adjusted ? `（模型提议 ${r.judgment.verdict}，${r.adjustNote}）` : ''}`, `§9.5 · 证据 ${r.evidence.length} 条`);

  // ── 9 写报告 + 自检 ──────────────────────────────────────────────────────
  run.step('s9', 9, '写报告并自检引用', 'running');
  const summaryKeyed = new Map<string, Evidence>(results.flatMap((r) => [...r.keyed]));
  const keyOfRef = new Map([...summaryKeyed].map(([k, e]) => [e.ref, k]));
  // 第 5 轮 --only: vN's, with this run's keys (null: some evidence of it is not keyed here: written again)
  const keptSummary = o.keep?.summary ? rekeyed(o.keep.summary, o.keep.keyed, keyOfRef) : null;
  const keptRecommendation = o.keep?.recommendation ? rekeyed(o.keep.recommendation, o.keep.keyed, keyOfRef) : null;
  let summary: SummaryDraft;
  try {
    if (keptSummary) summary = summarySchema.parse(keptSummary);
    else summary = await run.llm('summary', summaryInputPrompt(plan.question, plan.purpose, results, ctx.exploratory, run.contextText.slice(0, 3000), plan), summarySchema);
  } catch (e) {
    if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
    // Several minutes of evidence must not be lost to one unreadable answer: the summary falls back to the
    // verdicts (written by code), the self-check flags what is missing, and the repair round asks for it again.
    await run.log('research:summary-fallback', `Summary 的模型输出两次都不是合格的 JSON：${shortError(e)}`, '用各论点的判断先写 Summary，再走一次修复');
    summary = fallbackSummary(results);
  }
  // "AI 的推荐判断" is its own call: a short answer with one shape is far less likely to break than one long one
  // where the investigation started (exec directive, decisions): the recommendation answers to it (D-28)
  const originItems = await collectOrigins(ctx.vault, planPath, plan);
  const directives = directiveRefs(originItems);
  summary = { ...summary, recommendation: keptRecommendation ?? (await recommend(run, plan, results, summary, ctx.exploratory, undefined, directives)) };
  // the directive row cites the directive, whatever a call wrote or a repair round did (code, not the prompt)
  const citeDirective = async () => {
    if (!summary.recommendation) return;
    const d = withDirectiveRef(summary.recommendation.directive_response, directives);
    if (!d.added.length) return;
    summary = { ...summary, recommendation: { ...summary.recommendation, directive_response: d.cell } };
    await run.log('research:directive-ref-added', `“怎么回应高层指示”没有引用高层指示：在结论里补上 ${d.added.map((k) => `[${k}]`).join('')}`, '这一格必须引用它回应的高层指示；依据里不能用它，所以补在结论里');
  };
  await citeDirective();
  // 第 5 轮 --only: what is kept is never rewritten later (shortened, citations repaired): its words are vN's
  const keptClaims = new Set(results.filter((r) => r.kept).map((r) => r.claim.id));
  const keptPart = (id: string) => [...keptClaims].some((c) => id.startsWith(`${c}:`) || id.startsWith(`card:${c}:`)) || (!!keptSummary && id.startsWith('summary:')) || (!!keptRecommendation && id.startsWith('rec:'));
  // D-48: the short parts of a question-tree report over their 字数 limit are rewritten once, before the checks (the
  // number check then runs on the rewritten words as on any other)
  ({ results, summary } = await shortenLong(run, results, summary, keptPart));

  const reportVersion = await nextReportVersion(ctx, researchDir);
  const reportName = `报告 v${reportVersion}`;
  const facts = (): ReportFacts => ({
    title: researchDir.split('/').pop() ?? '调查',
    version: reportVersion,
    question: plan.question,
    purpose: plan.purpose,
    planLink: linkTo(planPath),
    workplanLink: workplanLinkOf(o.workplanPath),
    mode,
    exploratory: ctx.exploratory,
    kbCount: run.kbSources.size,
    webCount: run.webSources.size,
    expertCount: run.expertSources.size,
    searches: client.usage().searches,
    fetches: client.usage().fetches,
    notExecuted,
    droppedQuotes: run.stats.droppedQuotes,
    adjustments: [
      ...results.filter((r) => r.adjusted).map((r) => `${r.label}：${r.adjustNote}`),
      ...(droppedKeys.size ? [`系统移除了 ${droppedKeys.size} 个无法展开的证据编号（模型引用了证据列表里没有的编号，详见日志），它们所在的句子不再带这条引用`] : []),
    ],
    skipped: run.stats.skipped,
    origins,
    directives,
    decisions: related.map((d) => `${decisionQuote(d.decision) ? `“${decisionQuote(d.decision)}”` : ''}（${d.decidedBy ?? '人'} 确认；${d.via.join('；')}）${linkTo(d.path)}`),
    counterLines: results.map((r) => `${r.label} 的反证：${run.counterNotes.get(r.claim.id) ?? '已执行'}`),
    plan,
    // D-56 ⑤b: the 访谈建议 card belongs to a fresh judgment; every rewrite (--only, --rerender, a frozen one) keeps vN as it was
    interviewCard: !o.rerender && !o.frozen,
    ...o.facts,
    // D-48 第 4 轮: a rewrite that kept vN's judgment says so, and which hypotheses it could not keep (none kept, as
    // for a report from before conditions were judged one by one: judged again, the verdicts compared as before)
    ...(o.frozen && o.facts?.rewrite && results.some((r) => !r.frozenFallback)
      ? {
          rewrite: {
            ...o.facts.rewrite,
            frozen: {
              fallback: results.flatMap((r) => (r.frozenFallback ? [{ claimId: r.claim.id, label: r.label, why: r.frozenFallback }] : [])),
              // 第 5 轮 --only: what was redone; a part meant to be kept that could not be is redone too
              ...(o.rerender ? { rerender: o.rerender.note } : {}),
              ...(o.keep && !o.rerender ? { only: [...o.keep.redone, ...results.filter((r) => !r.kept && !o.keep!.redone.includes(r.label)).map((r) => r.label), ...(!keptSummary && !o.keep.redone.includes('一句话回答') ? ['一句话回答'] : []), ...(!keptRecommendation && !o.keep.redone.includes('推荐表') ? ['推荐表'] : [])] } : {}),
            },
          },
        }
      : {}),
  });

  const origins = renderOriginLines(originItems);
  const maxRepair = o.rerender ? 0 : (o.repairRounds ?? MAX_REPORT_REPAIR_ROUNDS);
  const issuedKeys = new Set(results.flatMap((r) => [...r.keyed.keys()]));
  const droppedKeys = new Set<string>();
  // An evidence key the model made up is removed from its sentence (and logged); it must never block the report.
  const render = async () => {
    let r = renderReport(facts(), results, summary, summaryKeyed);
    const fresh = [...new Set(r.unknownKeys.filter((k) => !droppedKeys.has(k)))];
    if (fresh.length) {
      for (const k of fresh) droppedKeys.add(k);
      await run.log('research:citation-dropped', `移除无法展开的证据编号：${fresh.join('、')}`, '模型引用了证据列表里没有的编号；系统去掉这条引用，不让它卡住整份报告');
      r = renderReport(facts(), results, summary, summaryKeyed); // "怎么查的" now says what was removed
    }
    // a block link the model wrote without its quote: code writes the block's original into a footnote
    const quoted = await citeBareBlockLinks({ vault: ctx.vault, log: (x, c, why) => run.log(x, c, why), fromPath: planPath }, r.body);
    return quoted.cited.length ? { ...r, body: quoted.body } : r;
  };
  let rendered = await render();
  // D-48 第 5 轮（B 加强版）: the one-line answer and 对决策的回答 written again from the sub-questions' answers as this
  // report has them, no evidence (WS-A v8: the two went opposite ways); each clause names its answers, [Q3-1]
  const concluded = { so: false, decision: false };
  if (isTreePlan(plan) && (!keptSummary || !keptRecommendation)) {
    const answers = subAnswersOf(rendered.body);
    const withDecision = !keptRecommendation && !!summary.recommendation;
    const c = answers.length ? await writeConclusion(run, { question: plan.question, decision: await projectDecision(ctx.vault, ctx.projectPath), answers, withDecision }) : null;
    // plain assignments: the production minifier inlines `concluded` and breaks a destructuring assignment to it
    if (c && !keptSummary && c.so_what.trim()) {
      summary = { ...summary, so_what: c.so_what.trim() };
      concluded.so = true;
    }
    if (c && withDecision && c.decision_answer.trim()) {
      summary = { ...summary, recommendation: { ...summary.recommendation!, decision_answer: c.decision_answer.trim() } };
      concluded.decision = true;
    }
    if (concluded.so || concluded.decision) rendered = await render();
  }
  // what the conclusion call wrote stays: a repair round rewrites the Summary and the recommendation from the evidence
  // (M1 验收 4: the run's repair brought "[E2][E3]" back into the one-line answer, and 对决策的回答 lost its [Qx])
  const concludedSo = concluded.so ? summary.so_what : null;
  const concludedDecision = concluded.decision ? (summary.recommendation?.decision_answer ?? null) : null;
  const keepConcluded = () => {
    if (concludedSo !== null) summary = { ...summary, so_what: concludedSo };
    if (concludedDecision !== null && summary.recommendation) summary = { ...summary, recommendation: { ...summary.recommendation, decision_answer: concludedDecision } };
  };
  // Q-F: a number must be in the original its clause cites (a found original gets a key the repair may cite)
  const numbers = (body: string) => numberFailures({ vault: ctx.vault, log: (a, c, r) => run.log(a, c, r), results, alsoKeyed: [summaryKeyed], issuedKeys }, body);
  const checkAll = async () => [...(await selfCheck(run, rendered.body, [], issuedKeys)), ...(await numbers(rendered.body)), ...challengeFailures(results), ...revisionFailures(results), ...recommendationFailures(summary, summaryKeyed, directives, results), ...reportV2Problems(summary, results).map((message) => ({ code: 'recommendation_without_judgment' as const, message }))];
  let failures = await checkAll();
  for (let round = 1; failures.some(needsRepair) && round <= maxRepair; round++) {
    run.step('s9', 9, `写报告并自检引用（第 ${round} 次修复）`, 'running', describeFailures(failures.filter(needsRepair)).slice(0, 5).join('；'));
    // what the recommendation lacks goes back to the recommendation call; everything else to the usual repair
    const recFails = failures.filter(isRecommendationFailure);
    const rest = failures.filter((f) => !isRecommendationFailure(f) && needsRepair(f));
    if (rest.length) ({ results, summary } = await repair(run, results, summary, rest, rendered.sections));
    if (recFails.length) summary = { ...summary, recommendation: (await recommend(run, plan, results, summary, ctx.exploratory, recFails.map((f) => f.message), directives)) ?? summary.recommendation };
    keepConcluded();
    await citeDirective();
    rendered = await render();
    failures = await checkAll();
  }
  // Q-F: a number the repair rounds could not place (M4's S0 run: "[E1][E2] 的样本口径（500 人…的 2000 名员工）和[E4]")
  // is settled by code, the same two ways: cite the original that has it (on the line, or in the source), else the
  // model rewrites the clause without it. A number alone never leaves the live run a draft.
  if (!o.rerender && failures.some((f) => f.code === 'number_not_in_quote')) {
    const settled = await fixCarriedNumbers({ vault: ctx.vault, log: (a, c, why) => run.log(a, c, why), fromPath: planPath, vPrev: reportVersion, what: '正文', reword: modelReword(run) }, rendered.body);
    if (settled.fixes.length) {
      rendered = { ...rendered, body: settled.body };
      failures = await checkAll();
    }
  }
  // D-48 第 3 轮: does each footnote of the Summary and the recommendation hold its sentence (one call; the 挂错 ones
  // switched to a key that holds, else taken out and the sentence softer). Fixes that make another check fail are undone.
  const fit = o.rerender ? noCitationFit({ results, summary }) : await citationFit(run, { results, summary }, summaryKeyed, keptPart);
  let misfits = fit.misfits;
  let citationFixes: CitationFix[] = [];
  if (fit.changed) {
    const before = { results, summary, rendered, failures };
    ({ results, summary } = fit);
    rendered = await render();
    failures = await checkAll();
    if (failures.length > before.failures.length) {
      await run.log('research:citation-fit-undone', `改了脚注以后自检多出 ${failures.length - before.failures.length} 项：${describeFailures(failures).slice(0, 2).join('；')}`, '不用这次改的，挂错的照实标出来');
      ({ results, summary, rendered, failures } = before);
      misfits = citationSites(before, summaryKeyed).flatMap((x) => (fit.wrong.has(x.id) ? [{ key: x.key, sentence: x.sentence, quote: x.quote, reason: fit.wrong.get(x.id)! }] : []));
    } else citationFixes = citationFixesOf(fit.fixes, before.rendered.body, rendered.body, summaryKeyed);
  }
  const citationFlags = citationFlagsOf(misfits, rendered.body, summaryKeyed);
  // and the two checks on what that call wrote, against the answers as the final body has them (only flagged)
  // (a kept one, --only or --rerender, too: when it names answers or vN was flagged already)
  const flaggedBefore = !!o.keep?.flagged;
  const checkSo = concluded.so || (!!keptSummary && checkedConclusion(summary.so_what, flaggedBefore));
  const checkDecision = concluded.decision || (!!keptRecommendation && checkedConclusion(summary.recommendation?.decision_answer ?? '', flaggedBefore));
  const finalAnswers = checkSo || checkDecision ? subAnswersOf(rendered.body) : [];
  const summaryFlags = finalAnswers.length ? [...(checkSo ? conclusionFlags(summary.so_what, finalAnswers) : []), ...(checkDecision ? conclusionFlags(summary.recommendation?.decision_answer ?? '', finalAnswers) : [])] : [];
  for (const f of summaryFlags) await run.log('research:summary-flagged', `${f.q || '（没标子问题）'}：「${f.sentence.slice(0, 60)}」${{ tone: '语气和子问题的回答不一致', direction: '方向和子问题的回答相反', untagged: '没有标出自哪个子问题' }[f.kind]}`, '只标出来（frontmatter summary_flags），不改正文，不阻止交付');
  // D-48 第 4 轮 C (M4's lib/research/entity-check.ts): the names and numbers before each footnote, looked for in its
  // original, its title and publisher; none there is flagged, never changed
  const entityFlags = await entityFlagsOf(ctx.vault, rendered.body, planPath);
  for (const f of entityFlags) await run.log('research:entity-flagged', `${f.footnote}：「${f.sentence.slice(0, 60)}」里的 ${f.missing.join('、')} 在原文里没有`, '只标出来（frontmatter entity_flags），不改正文，不阻止交付');
  // D-56 ⑦: 三关核对 of the first layer — entity, this run's model, a second model at the same time; ✓ only when all
  // three hold. Only recorded (frontmatter citation_verify), never a reason to keep the report a draft.
  const citationVerify = o.rerender ? null : await runCitationVerify(run, ctx, rendered.body, planPath, modelInfo.providerId, o.verifyModel);
  // and what the renderer did to the answer segments (a key a condition does not have, a card without segments)
  for (const m of rendered.segmentLog ?? []) await run.log('research:segment-key-dropped', m, '回答分段由代码拼接：只留那条条件挂过的编号');
  for (const m of rendered.roleLog ?? []) await run.log('research:role-dropped', m, '正面的说法只挂支持的证据：反证只用在判不成立的那条，或写明“但/不过/然而”的对照里');
  // the appendix says what the check did: "引用核对：查了 N 个，换了 a 个，删了 b 个，标了 c 个" (none when nothing was checked)
  let citationFitCounts: { checked: number; replaced: number; removed: number; flagged: number } | null = null;
  // 第 5 轮 (c): counted from what reached the final body (a fix undone or dropped by the renderer is not counted)
  if (fit.counts.checked) {
    const replaced = citationFixes.filter((f) => f.action === '换编号').length;
    const removed = citationFixes.filter((f) => f.action === '删脚注').length;
    citationFitCounts = { checked: fit.counts.checked, replaced, removed, flagged: citationFlags.length };
    rendered = { ...rendered, body: withCitationFitLine(rendered.body, citationFitCounts) };
  }
  // D-21-4 (f): what the number checks still find after the repair rounds is flagged, not blocking (the page marks it,
  // recomputed on every display); every other check still keeps the report a draft
  const numberFlags = numberFlagsOf(failures);
  // so does inference_cited, the other heuristic (inference words before a footnote); the citation checks still block
  const inferenceFlags = inferenceFlagsOf(failures);
  // and a bare "E7" that may be a key or a product's name (报告 v3: Microsoft's E7 Frontier Suite)
  const keyFlags = keyFlagsOf(failures);
  // and a part still over its 字数 limit after the rewrite (D-48)
  const lengthFlagged = lengthFlags(results, summary);
  failures = failures.filter((f) => !isFlagCheck(f));
  for (const f of failures.filter((x) => isSoftGap(x.message))) await run.log(softGapAction(f.message), f.message, '修复轮没有改掉：只记下来，不阻止交付');
  failures = failures.filter((f) => !isSoftGap(f.message));
  for (const f of numberFlags) await run.log('research:number-flagged', describeFlag(f), '修复轮没有修掉：照实标出来（页面的“数字核对”框里列出），不阻止交付');
  for (const f of inferenceFlags) await run.log('research:inference-flagged', describeInferenceFlag(f), '修复轮没有修掉：照实标出来（页面在那一句的脚注旁标“⚠ 推论挂了脚注”），不阻止交付');
  for (const f of keyFlags) await run.log('research:key-flagged', describeKeyFlag(f), '判断不了是证据编号还是名字：照实记下来（frontmatter key_flags），不阻止交付');
  for (const f of citationFlags) await run.log('research:citation-flagged', `${f.footnote}：「${f.sentence.slice(0, 60)}」对不上原文（${f.reason.slice(0, 60)}）`, '修了一次还挂错：照实标出来（frontmatter citation_flags），不阻止交付');
  // D-48 round 5 A: a number in the recommendation that no [E#] footnote covers ("（见 Qx）" cites nothing): marked
  const numberEvidence = numbersNeedingEvidence(rendered.body);
  for (const f of numberEvidence) await run.log('research:number-needs-evidence', `推荐 · ${f.where}：「${f.sentence.slice(0, 60)}」里的 ${f.numbers.join('、')} 没有挂证据脚注`, '只标出来（frontmatter number_evidence_flags，页面标 ⚠），不改正文，不阻止交付');
  for (const f of lengthFlagged) await run.log('research:length-flagged', `${f.where}：${f.length} 字，超过 ${f.limit} 字：「${f.text.slice(0, 60)}」`, '改写以后还超长：照实标出来（frontmatter length_flags），不阻止交付');
  const delivered = failures.length === 0;
  const failedChecks = describeFailures(failures);
  const shared = sharedSupport(results);
  // the 用词对照表 (D-39): an old word in a question-tree report is logged, never a reason to keep it a draft
  if (isTreePlan(plan)) for (const h of oldWordingHits(rendered.body)) await run.log('research:old-wording', `正文里有旧词「${h.word}」${h.count} 处，例：「${h.example}」`, '用词对照表换掉了这个词：只记下来，不阻止交付');
  for (const x of shared) await run.log('research:evidence-shared', `${x.source} 同时是 ${x.hypotheses.join('、')} 的支持证据`, '一条证据最好只放在它最直接回答的那个假设下（只标记，不阻止交付）');
  if (rendered.answerFallbacks?.length) await run.log('research:answer-fallback', `Summary 没有写 ${rendered.answerFallbacks.join('、')} 的回答：由代码按假设的判断写出`, '每个一级子问题都要有回答（D-39）');

  const body = delivered ? rendered.body : `> ⚠ 自检没有通过，这份报告**没有交付**，状态停在草稿。没通过的项：\n${failedChecks.map((f) => `> - ${f}`).join('\n')}\n\n${rendered.body}`;
  const written = await run.tool<{ path: string }>(
    'write_draft',
    {
      note_type: 'report',
      name: reportName,
      status: '进行中',
      frontmatter: {
        id: `report-${slug()}-v${reportVersion}`,
        version: reportVersion,
        research_plan: linkTo(planPath),
        mode: 'team',
        derived_from: [linkTo(planPath)],
        relates_to: [linkTo(`${ctx.workspacePath}/workspace`)],
        delivery: delivered ? '已交付' : '草稿',
        failed_checks: failedChecks,
        ...(numberFlags.length ? { number_flags: numberFlags } : {}),
        ...(inferenceFlags.length ? { inference_flags: inferenceFlags } : {}),
        ...(keyFlags.length ? { key_flags: keyFlags } : {}),
        ...(lengthFlagged.length ? { length_flags: lengthFlagged } : {}),
        ...(citationFlags.length ? { citation_flags: citationFlags } : {}),
        ...(citationFixes.length ? { citation_fixes: citationFixes } : {}),
        ...(entityFlags.length ? { entity_flags: entityFlags } : {}),
        ...(numberEvidence.length ? { number_evidence_flags: numberEvidence } : {}),
        ...(summaryFlags.length ? { summary_flags: summaryFlags } : {}),
        ...(citationFitCounts ? { citation_fit: citationFitCounts } : {}),
        ...(citationVerify ? { citation_verify: citationVerify } : {}),
        ...(shared.length ? { shared_evidence: shared } : {}),
        ...(plan.question_tree || plan.claims.some((c) => c.question) ? { report_format: 'question_tree' } : {}),
        run_mode: mode,
        verdicts_proposed: Object.fromEntries(results.map((r) => [r.claim.id, r.verdict])),
        ...o.frontmatter,
      },
      body,
    },
    delivered ? '引用自检通过，交付报告（状态仍是进行中/探索性，等人审）' : '自检没有通过：存为草稿，不交付',
  );

  let verdicts: VerdictWriteResult[] = [];
  let finalDelivered = delivered;
  let finalFailed = failedChecks;
  if (delivered) {
    // The final check on the file as stored (card + log).
    const post = await run.tool<{ ok: boolean; failed: { link: string }[] }>('check_citations', { path: written.path }, '交出报告之前，对写好的文件再自检一次');
    if (!post.ok) {
      finalDelivered = false;
      finalFailed = post.failed.map((f) => `写入后的文件自检失败：${f.link}`);
    }
  }
  if (finalDelivered) {
    verdicts = await writeProposedVerdicts({
      vault: ctx.vault,
      logPath: ctx.logPath,
      reportName,
      now: ctx.now(),
      proposals: results.map((r) => ({ claimId: r.claim.id, hypothesisPath: r.hypothesisPath, verdict: r.verdict })),
    });
  }
  // The run's numbers go into the report's frontmatter, so nothing (the compare page, M4) has to parse them out of the text.
  const researchRun: ResearchRunFacts = {
    mode,
    searches: client.usage().searches,
    fetches: client.usage().fetches,
    retries: client.usage().retries,
    durationMs: Date.now() - t0,
    model: modelInfo.model,
    modelLabel: modelInfo.label,
    providerId: modelInfo.providerId,
    ...(o.judgmentInfo ? { judgmentModel: o.judgmentInfo.model, judgmentModelLabel: o.judgmentInfo.label } : {}),
    kbSources: run.kbSources.size,
    webSources: run.webSources.size,
    droppedQuotes: run.stats.droppedQuotes,
    ...o.researchRun,
  };
  // the evidence record is machine data: a file next to the report, not the frontmatter (D-21: 2,800 lines in Obsidian)
  const sidecar = await writeEvidenceSidecar(ctx.vault, written.path, serializeEvidence(run.evidence));
  // D-48 第 4 轮: the judgment this report was written on, next to it (a later rewrite of the writing keeps it)
  await saveJudgmentFile(ctx.vault, written.path, judgmentFileOf(written.path, results, summary));
  await patchReport(ctx, written.path, { delivery: finalDelivered ? '已交付' : '草稿', failed_checks: finalFailed, research_run: researchRun, ...sidecar });
  run.step('s9', 9, '写报告并自检引用', finalDelivered ? 'done' : 'failed', finalDelivered ? `${reportName} 已交付；提议判断已写入 ${verdicts.filter((v) => v.written).length} 个假设` : `未交付：${finalFailed.join('；')}`);
  await run.log('research:done', `${reportName} ${finalDelivered ? '已交付' : '草稿（未交付）'}`, `搜索 ${client.usage().searches} 次、抓取 ${client.usage().fetches} 次，用时 ${Math.round((Date.now() - t0) / 1000)} 秒 · 模型：${modelInfo.label}（${modelInfo.model}）`);

  return {
    reportPath: written.path,
    reportName,
    delivered: finalDelivered,
    failedChecks: finalFailed,
    verdicts,
    claims: results.map((r) => ({ id: r.claim.id, verdict: r.verdict, adjusted: r.adjusted, evidence: r.evidence.length })),
    usage: client.usage(),
    counts: { kbSources: run.kbSources.size, webSources: run.webSources.size, droppedQuotes: run.stats.droppedQuotes },
    durationMs: Date.now() - t0,
    model: modelInfo,
    timing: run.timing(),
  };
}

// ── steps 2/3 ────────────────────────────────────────────────────────────────

/** What the vault half of a sub-question leaves for its web half: the query plan it drew up. */
export interface KbPassResult {
  qp: QueryPlan;
}

/** Step 2 for one sub-question: search the vault, evaluate what it holds, and decide whether that is enough. */
export async function kbPass(run: ResearchRun, claim: PlanClaim, q: PlanSubQuestion, focusNote?: string): Promise<KbPassResult | null> {
  const st: SubState = { claim, q, webRounds: 0, newByRound: [], stop: null, stopNote: '', tried: [] };
  run.subStates.set(q.id, st);
  const title2 = `查知识库 · ${run.subName(q)}`;
  const title3 = `查网上 · ${run.subName(q)}`;
  run.step(`s2:${q.id}`, 2, title2, 'running');
  try {
    // A follow-up's focus ("补专家的反面意见") reaches the model through the gap slot of the query prompt: no new prompt.
    const qp = await run.planQueries(claim, q, focusNote ? 'gap' : 'support', [], focusNote);
    const sources = await run.kbLookup(q, qp.kb_queries, 'support');
    const terms = [...qp.kb_queries.flatMap((x) => x.split(/\s+/)), ...q.question.split(/[，。；、\s？?]+/).filter((t) => t.length >= 2)];
    const kb = await run.evaluateSources(claim, q, 'support', 'kb', sources, terms);
    run.step(`s2:${q.id}`, 2, title2, 'done', `${sources.length} 份资料，${kb.length} 条相关论断（${kb.filter((e) => e.stance === 'supports').length} 支持 / ${kb.filter((e) => e.stance === 'refutes').length} 反驳）`);

    const stop = run.stopFor(st);
    if (stop) {
      st.stop = stop;
      st.stopNote = run.stopNote(stop);
      run.step(`s3:${q.id}`, 3, title3, 'skipped', st.stopNote);
    }
    return { qp };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    st.stop = 'budget_exhausted';
    st.stopNote = `这一步出错，停止：${msg}`;
    run.stats.skipped.push(`${q.id} ${msg}`);
    run.step(`s2:${q.id}`, 2, title2, 'failed', msg);
    return null;
  }
}

/** Step 3 for one sub-question: its first web round, unless the vault half already stopped it. */
export async function webPass(run: ResearchRun, claim: PlanClaim, q: PlanSubQuestion, qp: QueryPlan, release?: () => void): Promise<void> {
  const st = run.subStates.get(q.id)!;
  const title3 = `查网上 · ${run.subName(q)}`;
  try {
    // the vault half already emitted this sub-question's skipped row
    if (st.stop) return;
    run.step(`s3:${q.id}`, 3, title3, 'running', '知识库补不上，联网查');
    const res = await run.webRound(claim, q, 'support', 'web1', qp.web_queries, st.tried, release);
    if (!res) {
      st.stop = 'budget_exhausted';
      st.stopNote = run.stopNote('budget_exhausted');
      run.step(`s3:${q.id}`, 3, title3, 'skipped', st.stopNote);
      return;
    }
    st.webRounds = 1;
    if (!noPageRead(res)) st.newByRound.push(res.added.length);
    run.step(`s3:${q.id}`, 3, title3, 'done', res.note);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    st.stop = 'budget_exhausted';
    st.stopNote = `这一步出错，停止：${msg}`;
    run.stats.skipped.push(`${q.id} ${msg}`);
    run.step(`s3:${q.id}`, 3, title3, 'failed', msg);
  } finally {
    release?.();
  }
}

/** This sub-question's first-page fetch (see firstRoundReserve): released exactly once, when it starts its web round or stops. */
function heldFetch(run: ResearchRun): () => void {
  let held = true;
  return () => {
    if (held) run.reserve = { ...run.reserve, fetches: Math.max(0, run.reserve.fetches - 1) };
    held = false;
  };
}

export async function phaseA(run: ResearchRun, claim: PlanClaim, q: PlanSubQuestion, focusNote?: string) {
  // this sub-question's first page is held for it (see firstRoundReserve) until it starts its own web round or stops
  const release = heldFetch(run);
  try {
    const kb = await kbPass(run, claim, q, focusNote);
    if (kb) await webPass(run, claim, q, kb.qp, release);
  } finally {
    release();
  }
}

/**
 * Before the sub-questions of a claim run in parallel, each keeps one fetch for its own first web round. Without it,
 * a sub-question whose page failed could fall through to a spare page using the fetch the other one was about to
 * use; that one then read nothing and stopped as "no new evidence" (a flaky test under load, M3's full runs).
 */
export function firstRoundReserve(run: ResearchRun, subs: PlanSubQuestion[]) {
  run.reserve = { ...run.reserve, fetches: run.reserve.fetches + subs.length };
}

/** A round that read no page (every page failed to open, or there was no fetch left) says nothing about the topic: it must not trigger the "no new evidence" stop. */
const noPageRead = (res: { added: unknown[]; pagesRead: number; pagesFailed: number }) => res.added.length === 0 && res.pagesRead === 0;

// ── step 6: the counter-evidence round — always runs, for every claim ───────

const counterStep = (run: ResearchRun, claim: PlanClaim) => ({ sid: `s6:${claim.id}`, title: `找反证 · ${run.claimName(claim)}：专门检索“有什么证据说明它不成立”` });

/** Step 6 in the vault: search it for counter-evidence; returns the query plan and the note for the web half. */
export async function counterKb(run: ResearchRun, claim: PlanClaim, anchor: PlanSubQuestion): Promise<{ qp: QueryPlan; notes: string[] } | null> {
  const { sid, title } = counterStep(run, claim);
  run.step(sid, 6, title, 'running');
  const qp = await run.planQueries(claim, anchor, 'counter', []);
  const sources = await run.kbLookup(anchor, qp.kb_queries, 'counter');
  const terms = [...qp.kb_queries.flatMap((x) => x.split(/\s+/)), ...claim.statement.split(/[，。；、\s]+/).filter((t) => t.length >= 2)];
  const kb = await run.evaluateSources(claim, anchor, 'counter', 'counter', sources, terms);
  return { qp, notes: [`知识库 ${sources.length} 份资料，${kb.filter((e) => e.stance === 'refutes').length} 条反驳`] };
}

/** Step 6 on the web: the counter round's search, then the note that goes into the report. */
export async function counterWeb(run: ResearchRun, claim: PlanClaim, anchor: PlanSubQuestion, kb: { qp: QueryPlan; notes: string[] } | null): Promise<void> {
  const { sid, title } = counterStep(run, claim);
  // release this claim's reserved budget: the round is now the one using it (exactly once: counterRound is the composition)
  run.reserve = { searches: Math.max(0, run.reserve.searches - 1), fetches: Math.max(0, run.reserve.fetches - 1) };
  const notes: string[] = kb ? [...kb.notes] : [];
  try {
    if (!kb) {
      // the vault half ended without a query plan: the same note, skipped entry and done row as an exception
      notes.push('出错：知识库检索出错');
      run.stats.skipped.push(`${claim.id} 反证检索出错：知识库检索出错`);
    } else {
      const web = await run.webRound(claim, anchor, 'counter', 'counter', kb.qp.web_queries, []);
      notes.push(web ? web.note : '联网：没有可用的搜索次数');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(`出错：${msg}`);
    run.stats.skipped.push(`${claim.id} 反证检索出错：${msg}`);
  }
  run.counterNotes.set(claim.id, `已专门检索一轮（${notes.join('；')}）`);
  run.step(sid, 6, title, 'done', notes.join('；'));
}

export async function counterRound(run: ResearchRun, claim: PlanClaim, anchor: PlanSubQuestion) {
  try {
    await counterWeb(run, claim, anchor, await counterKb(run, claim, anchor));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { sid, title } = counterStep(run, claim);
    run.counterNotes.set(claim.id, `已专门检索一轮（出错：${msg}）`);
    run.stats.skipped.push(`${claim.id} 反证检索出错：${msg}`);
    run.step(sid, 6, title, 'done', `出错：${msg}`);
  }
}

// ── step 7: targeted gap-filling, bounded by the stop rule ──────────────────

export async function fillGaps(run: ResearchRun, claim: PlanClaim, q: PlanSubQuestion) {
  const st = run.subStates.get(q.id)!;
  const skipRow = (reason: string) => run.step(`s7:${q.id}:skip`, 7, `补缺 · ${run.subName(q)}`, 'skipped', reason);
  if (st.stop) return skipRow(st.stopNote);
  let rounds = 0;
  for (;;) {
    const stop = run.stopFor(st);
    if (stop) {
      st.stop = stop;
      st.stopNote = run.stopNote(stop);
      if (stop === 'no_new_evidence') run.stopCard(q);
      if (rounds === 0) skipRow(st.stopNote);
      return;
    }
    rounds += 1;
    const sid = `s7:${q.id}:${st.webRounds + 1}`;
    const title = `补缺 · ${run.subName(q)}`;
    run.step(sid, 7, title, 'running');
    try {
      const gap = run.describeGap(claim.id, q.id);
      const qp = await run.planQueries(claim, q, 'gap', st.tried, gap);
      const res = await run.webRound(claim, q, 'gap', 'web2', qp.web_queries, st.tried);
      if (!res) {
        st.stop = 'budget_exhausted';
        st.stopNote = run.stopNote('budget_exhausted');
        run.step(sid, 7, title, 'skipped', st.stopNote);
        return;
      }
      st.webRounds += 1;
      if (!noPageRead(res)) st.newByRound.push(res.added.length);
      run.step(sid, 7, title, 'done', `缺口：${trimEndMark(gap)}。${res.note}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      st.stop = 'budget_exhausted';
      st.stopNote = `补缺出错，停止：${msg}`;
      run.stats.skipped.push(`${q.id} 补缺出错：${msg}`);
      run.step(sid, 7, title, 'failed', msg);
      return;
    }
  }
}

// ── step 9 helpers ───────────────────────────────────────────────────────────

export function workplanLinkOf(path: string | undefined): string {
  return path ? linkTo(path) : '（研究计划尚未建立）';
}

export async function nextReportVersion(ctx: ToolContext, dir: string): Promise<number> {
  let max = 0;
  try {
    for (const e of await ctx.vault.list(dir)) {
      const m = /^报告 v(\d+)\.md$/.exec(e.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {
    /* none yet */
  }
  return max + 1;
}

function summaryInputPrompt(question: string, purpose: string, results: ClaimResult[], exploratory: boolean, context?: string, plan?: TreePlan) {
  const tree = plan ? questionTreeOf(plan) : null;
  const ran = new Set(results.map((r) => r.claim.id));
  return summaryPrompt({
    question,
    purpose,
    exploratory,
    context,
    ...(tree?.format === 'question_tree'
      ? {
          tree: {
            roots: tree.roots.map((r) => {
              const leaves = r.leaf ? [r.leaf] : r.children;
              return { qid: r.qid, question: r.question, parts: r.children.map((c) => `${c.qid} ${c.question}`), labels: leaves.filter((l) => ran.has(l.claimId)).map((l) => l.label), ran: leaves.some((l) => ran.has(l.claimId)) };
            }),
            meceCheck: plan?.mece_check ?? '',
          },
        }
      : {}),
    claims: results.map((r) => ({
      label: r.label,
      statement: r.claim.statement,
      verdict: r.verdict,
      adjustedNote: r.adjusted ? r.adjustNote : '',
      reasoning: r.judgment.reasoning,
      soWhat: r.judgment.so_what,
      gaps: r.judgment.gaps,
      expertQuestions: r.judgment.expert_questions,
      keyEvidence: [...r.keyed.entries()].slice(0, 4).map(([key, e]) => ({ key, quote: e.quote.slice(0, 160), grade: e.grade })),
      assertions: (r.assertions ?? []).map((a) => ({ key: a.key, status: a.status, basis: a.basis, text: a.text })),
      answer: r.judgment.answer,
      conditions: (r.conditions ?? []).map((c) => ({ label: c.label, text: c.text, status: c.status })),
      key: r.claim.key,
    })),
  });
}

const isRecommendationFailure = (f: CheckFailure) => f.code === 'incomplete_recommendation' || /^推荐判断里/.test(f.message);

/** What the recommendation call is told about one claim. */
export type RecommendClaim = Parameters<typeof recommendPrompt>[0]['claims'][number];

/** A judged claim as the recommendation call sees it (a simulated interview is never offered as something to cite). */
export function recommendClaimOf(r: ClaimResult): RecommendClaim {
  return {
    label: r.label,
    statement: r.claim.statement,
    verdict: r.verdict,
    revised: r.revisedStatement,
    reasoning: r.judgment.reasoning,
    soWhat: r.judgment.so_what,
    keyEvidence: [...r.keyed.entries()].filter(([, e]) => !(isExpert(e) && e.simulated)).slice(0, 6).map(([key, e]) => ({ key, quote: e.quote.slice(0, 160), grade: e.grade })),
    assertions: (r.assertions ?? []).map((a) => ({ key: a.key, status: a.status, basis: a.basis, text: a.text })),
    answer: r.judgment.answer,
    conditions: (r.conditions ?? []).map((c) => ({ label: c.label, text: c.text, status: c.status })),
  };
}

/** The recommendation call; an unreadable answer leaves it out (the self-check then keeps the report a draft). */
/**
 * D-48 第 3 轮: the exec directive ([M#]) is what "怎么回应高层指示" answers, never its 依据 (W5 v4: [^9], the directive's
 * own words, cited as the basis for supporting it). An [M#] after "依据：" moves to the conclusion; a 依据 left empty goes.
 * Round 5 (a): an [M#] the sentence reads as a noun ("[M1] 说…", "[M1] 的…", "所以 [M1] 里…": DIRECTIVE_AS_SUBJECT) leaves
 * "高层指示" in its place, so the sentence does not break (WS-A v8: "， 说决定权在 CIO…"); one in a footnote's place goes.
 */
/** What follows an [M#] the sentence reads as a noun: "[M1] 说", "[M1] 的", "[M1] 里", "[M1] 要求" (not "[M1] 微软已管…"). */
const DIRECTIVE_AS_SUBJECT = /^(?:说|的|里|中|要求|提出|认为|强调|指出|提到|所说|希望|讲)/;

export function directivesOutOfBasis(cell: string): string {
  const at = /依据[:：]/.exec(cell);
  if (!at) return cell;
  const head = cell.slice(0, at.index);
  const keys = [...new Set(cell.slice(at.index).match(/\[M\d+\]/g) ?? [])];
  if (!keys.length) return cell;
  const basis = cell
    .slice(at.index)
    .replace(/\s*(?:\[M\d+\]\s*)+(?=(\S{0,2}))/g, (_m, next: string) => (DIRECTIVE_AS_SUBJECT.test(next) ? '高层指示' : ''))
    .replace(/^(依据[:：])\s+/, '$1');
  const missing = keys.filter((k) => !head.includes(k)).join('');
  const conclusion = missing ? head.replace(/(\s*[。；;.]?\s*)$/, `${missing}$1`) : head;
  return /^依据[:：]\s*[、，,；;。.]*\s*$/.test(basis) ? conclusion.replace(/\s+$/, '') : `${conclusion}${basis}`;
}

/**
 * "怎么回应高层指示" without any [M#] (M1 验收 5, run 3: a draft at the demo): the 依据 may not cite the directive (round 2)
 * and code takes an [M#] out of it (round 5 (a)), the row must cite it (directiveGaps). Code adds the directive's keys to
 * the conclusion: after its 支持 / 修正 / 推翻, else "针对高层指示[M1]：" in front. Every exec directive the
 * investigation started from is what the row answers, so all of them. Before "依据：": never taken out again.
 */
export function withDirectiveRef(cell: string, directives: DirectiveRef[] | undefined): { cell: string; added: string[] } {
  const keys = (directives ?? []).filter((d) => d.kind === '会议').map((d) => d.key);
  if (!keys.length || !cell.trim()) return { cell, added: [] };
  const cited = new Set((cell.match(/\[[MW]\d+(?:[^\]]*)\]/g) ?? []).flatMap((g) => g.match(/[MW]\d+/g) ?? []));
  if (keys.some((k) => cited.has(k))) return { cell, added: [] };
  const tag = keys.map((k) => `[${k}]`).join('');
  const verb = /^(\s*(?:支持|修正|推翻))\s*([：:])/.exec(cell);
  return { cell: verb ? `${verb[1]}${tag}${verb[2]}${cell.slice(verb[0].length)}` : `针对高层指示${tag}：${cell.trimStart()}`, added: keys };
}

export async function recommendFor(
  run: ResearchRun,
  input: {
    plan: { question: string; purpose: string };
    claims: RecommendClaim[];
    soWhat: string;
    workplanImpact: string[];
    exploratory: boolean;
    failures?: string[];
    /** A follow-up's rewrite: vN's recommendation, the evidence this follow-up added, how the re-judged claim moved. */
    previous?: string;
    newEvidence?: { key: string; quote: string; grade: string }[];
    judgmentChange?: string;
    /** The exec directive / decisions the investigation started from, keyed [M#] / [W#]. */
    directives?: DirectiveRef[];
    /** A follow-up whose re-judged claim changed: its label (the rewrite also gives its Summary 理由 / 一句话答案). */
    summaryFor?: string;
    /** A follow-up: vN's parts that stood on a disproven source (they must be rewritten). */
    disproven?: { part: string; sources: { name: string; note: string | null }[] }[];
  },
): Promise<Recommendation | undefined> {
  const prompt = recommendPrompt({
    // the recommendation answers the project's business decision (项目.md 支撑的决策 / D1), not the next research step
    decision: await projectDecision(run.ctx.vault, run.ctx.projectPath),
    question: input.plan.question,
    purpose: input.plan.purpose,
    exploratory: input.exploratory,
    context: run.contextText.slice(0, 3000),
    soWhat: input.soWhat,
    workplanImpact: input.workplanImpact,
    failures: input.failures,
    previous: input.previous,
    newEvidence: input.newEvidence,
    judgmentChange: input.judgmentChange,
    directives: input.directives,
    claims: input.claims,
    summaryFor: input.summaryFor,
    disproven: input.disproven,
  });
  try {
    const rec = await run.llm(input.failures ? 'recommend:repair' : 'recommend', prompt, recommendationSchema);
    const d = withDirectiveRef(directivesOutOfBasis(rec.directive_response), input.directives);
    if (d.added.length) await run.log('research:directive-ref-added', `“怎么回应高层指示”没有引用高层指示：在结论里补上 ${d.added.map((k) => `[${k}]`).join('')}`, '这一格必须引用它回应的高层指示；依据里不能用它，所以补在结论里');
    return { ...rec, directive_response: d.cell };
  } catch (e) {
    if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
    await run.log('research:recommend-failed', `推荐判断的模型输出不是合格的 JSON：${shortError(e)}`, '这一段留空，报告存成草稿');
    return undefined;
  }
}

function recommend(run: ResearchRun, plan: { question: string; purpose: string }, results: ClaimResult[], summary: SummaryDraft, exploratory: boolean, failures?: string[], directives?: DirectiveRef[]) {
  return recommendFor(run, { plan, claims: results.map(recommendClaimOf), soWhat: summary.so_what, workplanImpact: summary.workplan_impact, exploratory, failures, directives });
}

/**
 * D-39 (sample 备注 1): one source block should support one hypothesis; the same block in two hypotheses' support
 * tables is flagged (frontmatter `shared_evidence`, a log line), never a reason to keep the report a draft.
 */
export function sharedSupport(results: ClaimResult[]): { source: string; hypotheses: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const r of results) {
    for (const line of r.judgment.support_lines) {
      for (const m of line.matchAll(/E\d+/g)) {
        const e = r.keyed.get(m[0]);
        if (e) by.set(e.ref, new Set([...(by.get(e.ref) ?? []), r.label]));
      }
    }
  }
  return [...by].filter(([, ls]) => ls.size > 1).map(([source, ls]) => ({ source, hypotheses: [...ls] }));
}

/** A Summary built from the verdicts alone (no recommendation: the self-check then asks the repair round for it). */
export function fallbackSummary(results: ClaimResult[]): SummaryDraft {
  return {
    so_what: results.map((r) => `${r.label} ${r.verdict}`).join('；'),
    results: results.map((r) => `${r.label} → ${r.verdict}（提议）：${r.verdict === '证据不足' ? '证据还不够下判断' : '见逐个假设'}`),
    answers: [],
    sufficiency: '',
    workplan_impact: [],
  };
}

/** "AI 的推荐判断" must be complete (方法库 so what 提炼 第 4 步): the gaps go back to the summary repair. */
export function recommendationFailures(summary: SummaryDraft, keyed?: Map<string, Evidence>, directives: DirectiveRef[] = [], results: ClaimResult[] = []): CheckFailure[] {
  const assertions = results.flatMap((r) => r.assertions ?? []);
  return [...recommendationGaps(summary.recommendation, keyed), ...directiveGaps(summary.recommendation, directives), ...assertionGaps(summary.recommendation, assertions)].map((m) => ({ code: 'incomplete_recommendation' as const, message: `推荐判断不完整：${m}` }));
}

/** check_citations (card + log) plus the full checks on the text. */
export async function selfCheck(run: ResearchRun, body: string, unknownKeys: string[], issuedKeys?: ReadonlySet<string>): Promise<CheckFailure[]> {
  await run.tool('check_citations', { text: body }, '交出报告之前自检每一条引用');
  const all = await run.ctx.vault.checkCitations(body);
  return [...citationFailures(all), ...(await linkFailures(run.ctx.vault, body)), ...(await decisionFailures(run.ctx.vault, body)), ...checkReportText(body, unknownKeys, issuedKeys)];
}

/** Ask the model to fix only the failing parts, claim by claim, then re-apply §9.5. */
export async function repair(
  run: ResearchRun,
  results: ClaimResult[],
  summary: SummaryDraft,
  failures: CheckFailure[],
  sections: Map<string, string>,
): Promise<{ results: ClaimResult[]; summary: SummaryDraft }> {
  const byClaim = new Map<string, string[]>();
  const forSummary: string[] = [];
  for (const f of failures) {
    const owner = (f.claimId ? results.find((r) => r.claim.id === f.claimId) : undefined) ?? results.find((r) => {
      const md = sections.get(r.claim.id) ?? '';
      return (f.excerpt && md.includes(f.excerpt)) || (f.code === 'unknown_evidence_key' && f.excerpt && JSON.stringify(r.judgment).includes(f.excerpt));
    });
    if (owner) byClaim.set(owner.claim.id, [...(byClaim.get(owner.claim.id) ?? []), f.message]);
    else forSummary.push(f.message);
  }
  const next = await Promise.all(
    results.map(async (r) => {
      const fs = byClaim.get(r.claim.id);
      if (!fs) return r;
      try {
        // the whole judgment is written again, every response included: the judge's output room
        const fixed = await run.llm(`repair:${r.claim.id}`, repairPrompt({ judgmentJson: JSON.stringify(r.judgment), failures: fs, evidenceKeys: [...r.keyed.keys()] }), judgmentSchema, { maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS });
        return reEnforce(r, fixed);
      } catch (e) {
        // an unreadable repair leaves the part as it was: the self-check then keeps the report a draft
        if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
        await run.log('research:repair-failed', `${r.claim.id} 的修复输出不是合格的 JSON：${shortError(e)}`, '保留修复前的内容');
        return r;
      }
    }),
  );
  let nextSummary = summary;
  if (forSummary.length) {
    const keys = results.flatMap((r) => [...r.keyed.keys()]);
    // the recommendation is not the Summary repair's (its own repair is the recommendation call): sent along, the model
    // gave it back cut short (no change_if) and the whole repair failed (M1 验收 5, run 3: one wasted round)
    const { recommendation, ...rest } = summary;
    try {
      const repaired = await run.llm('repair:summary', repairPrompt({ judgmentJson: JSON.stringify(rest), failures: forSummary, evidenceKeys: keys }), summarySchema.omit({ recommendation: true }));
      nextSummary = { ...repaired, ...(recommendation ? { recommendation } : {}) };
    } catch (e) {
      if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
      await run.log('research:repair-failed', `Summary 的修复输出不是合格的 JSON：${shortError(e)}`, '保留修复前的内容');
    }
  }
  return { results: next, summary: nextSummary };
}

/** What the report's frontmatter says about the run that produced it (`research_run`). Read it from here, not from the body. */
export interface ResearchRunFacts {
  mode: ResearchMode;
  searches: number;
  fetches: number;
  retries: number;
  durationMs: number;
  model: string;
  modelLabel: string;
  providerId: string;
  judgmentModel?: string;
  judgmentModelLabel?: string;
  kbSources: number;
  webSources: number;
  droppedQuotes: number;
  /** D-48: a version rewritten from vN's evidence, not investigated again. */
  rewrite?: boolean;
}

export async function patchReport(ctx: ToolContext, path: string, patch: Record<string, unknown>) {
  const n = await ctx.vault.read(path);
  await ctx.vault.write(path, { frontmatter: { ...n.data, ...patch }, body: n.body }, { overwrite: true });
}
