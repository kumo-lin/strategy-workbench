/**
 * Steps 1–3 of the workplan harness (D-61): a free-form holistic judgment, a strategic evaluation by a fresh call that
 * sees only the contract and the draft, and one revision. The model writes the text; the code decides what is
 * acceptable: the evaluator must answer all six questions, and an answer that finds a problem must point at a phrase
 * that is in the draft and give a concrete counterexample and a concrete fix, or it is thrown back. The draft itself
 * has no required shape. Everything runs on the one model the workplan segment uses.
 */
import type { LanguageModel } from 'ai';
import { LlmJsonError, LlmTimeoutError, LlmTruncatedError } from '@/lib/research/llm';
import { BudgetError, type Meter } from './budget';
import { composeJson, composeText } from './llm';
import { EVAL_QUESTIONS, evaluationSchema, SLOT_KEYS, SLOT_LABELS, type ComposeState, type EvalAnswer } from './types';

/** A call that failed in a way asking again can fix (a cut-off or unreadable answer, a timeout) is tried once more. */
const RETRIES = 1;
const MIN_DRAFT = 200;
const MIN_COUNTEREXAMPLE = 20;
const MIN_FIX = 12;
const MIN_REASON = 10;
/** A fix or counterexample that only says "go deeper": the vague feedback the code throws back. */
const VAGUE = /^(应|需要?|可以|建议)?(进一步|更加?|再)(具体|详细|深入|完善|细化|明确|充分|全面|丰富)|^(补充|完善|细化|加强|优化)(一下|相关|更多)?(内容|论证|分析|说明|信息|证据)?[。.]?$/;

export interface Judgment {
  draft: string;
  evaluation: EvalAnswer[];
  revised: string;
  /** Findings the revision did not take in, as plain sentences for 风险和待确认. */
  open: string[];
}

const flat = (text: string) => text.replace(/[\s，。、：:；;！!？?（）()《》"“”'‘’\-—*#>]/g, '');

/** The contract as the block both the drafter and the evaluator read (no pack ids: the judgment is about the question, not the notes). */
export function contractText(state: ComposeState): string {
  const byId = new Map(state.pack.map((i) => [i.id, i]));
  const marks = state.marks
    .filter((m) => m.verdict !== '无关')
    .map((m) => `- 《${byId.get(m.ref)?.title ?? ''}》：${m.verdict}${m.resolution ? `（${m.resolution}）` : ''}。${m.note}`);
  return [
    '## 决策契约',
    ...SLOT_KEYS.map((k) => `${SLOT_LABELS[k]}：${state.frame[k]}`),
    `研究资源（验证方法只能在这里面选）：${state.resources}`,
    ...(marks.length ? ['', '用户的方向和高层指示、已确认的决定、公司方针的关系：', ...marks] : []),
  ].join('\n');
}

// ── step 1: the holistic judgment ─────────────────────────────────────────────────────────────────

const DRAFT_SYSTEM = [
  '你是战略部的资深顾问。决策契约已经定下，现在不要拆题，先写一份"整体判断草案"：自由行文，不限格式，像给合伙人写的一页纸备忘。',
  '要写清楚：',
  '1. 核心问题到底是什么（可以和字面问题不同，说明为什么）；',
  '2. 几个互相竞争的假设（至少两个）：每个都说"如果它是对的，我们会看到什么；看到什么就说明它错了"；',
  '3. 关键的不确定性：哪几件事不确定，而且答案不同会改变决策；',
  '4. 容易被忽略的解释（别人不会先想到、但同样说得通的原因）；',
  '5. 最值得先验证什么，为什么先验证它（花最少的力气、得到最能改变决策的信息）；验证办法只能用契约里"研究资源"写的手段。',
  '规矩：',
  '- 契约里"已知的事实和判断"当作已知，不要再把它写成不确定；"证据要多强才能拍板"是验证的门槛，每个关键假设要说清楚要看到什么才够；',
  '- 高层指示、已确认的决定、公司方针只当边界，不当证据；用户的方向和它们冲突又选了"按指示"的，不要和指示打架；',
  '- 用户把没有证据的说法当前提时，要把"它是不是真的"本身写成一个关键不确定性；',
  '- 说资料时用《标题》，不要写任何编号、文件名；不要画问题树，不要用 A、B、Q1 这类代号；',
  '- 1500 字以内，直接写正文，不要客套话和标题套话。',
].join('\n');

export function draftPrompt(state: ComposeState, perspectives: string[]): string {
  const refs = state.pack.filter((i) => i.kind === 'reference' || i.kind === 'method');
  const bounds = state.pack.filter((i) => i.kind === 'directive' || i.kind === 'decision' || i.kind === 'policy');
  const line = (i: ComposeState['pack'][number]) => `- 《${i.title}》${i.status ? `（${i.status}）` : ''}：${i.gist}`;
  return [
    contractText(state),
    '',
    '## 指示、决定、业务方针（只当边界）',
    ...(bounds.length ? bounds.map(line) : ['（没有）']),
    '',
    '## 资料库里找到的参考资料（已读过的事实可以用；没有的不要编）',
    ...(refs.length ? refs.map(line) : ['（没有命中的资料）']),
    ...(perspectives.length ? ['', `团队习惯从这些视角看问题（有用就用，不强求）：${perspectives.join('、')}`] : []),
  ].join('\n');
}

/** Is a text long enough to be a judgment at all? (The only thing the code asks of the draft's shape.) */
export const isJudgmentText = (text: string): boolean => flat(text).length >= MIN_DRAFT;

// ── step 2: the strategic evaluator ───────────────────────────────────────────────────────────────

const EVAL_SYSTEM = [
  '你是战略评估员，没有参与写这份草案，也看不到它是怎么写出来的。你只拿到决策契约和草案。你的任务是挑刺，不是总结，也不是夸。',
  '逐条回答下面 6 个问题（q 是题号）：',
  ...EVAL_QUESTIONS.map((q, i) => `${i + 1}. ${q}？`),
  '每个问题至少回答一次，有多处问题可以回答多次。每条回答：',
  '- verdict 为"有问题"或"没问题"；',
  '- 第 6 问提出的更便宜的证伪办法，必须在契约的"研究资源"之内（超出的不算更便宜，是做不到）；草案里用了研究资源以外的方法，也算"有问题"；',
  '- "有问题"的：target 必须是从草案里**原样抄下来**的一个短语（6–30 个字，说明你在说哪一条）；counterexample 写一个具体的反例或场景（草案的这一条在什么情况下会出错，要有名字、数字或情形，不要写"可能不够全面"）；fix 写具体怎么改（改成什么，不是"应更具体"）；',
  '- "没问题"的：counterexample 写一句话说明为什么这一问草案是站得住的（引用草案里的内容），target 和 fix 留空。',
  '不合格的回答会被打回重写：target 不在草案里、反例和改法太空、有题号没回答，都算。',
  '只输出 JSON：{"answers":[{"q":1,"verdict":"有问题","target":"…","counterexample":"…","fix":"…"},…]}',
].join('\n');

export function evalPrompt(state: ComposeState, draft: string, problems: string[] = []): string {
  return [
    contractText(state),
    '',
    '## 草案',
    draft,
    ...(problems.length ? ['', '## 上一次的回答不合格，请逐条改正后重新回答全部 6 个问题', ...problems.map((p) => `- ${p}`)] : []),
  ].join('\n');
}

export interface EvalCheck {
  valid: EvalAnswer[];
  /** Why answers were thrown back (for the retry and the log). */
  problems: string[];
}

/** The code's gate on the evaluator: all six questions answered, every "有问题" concrete and tied to the draft. */
export function checkEvaluation(answers: EvalAnswer[], draft: string): EvalCheck {
  const text = flat(draft);
  const valid: EvalAnswer[] = [];
  const problems: string[] = [];
  for (const a of answers) {
    const tag = `第 ${a.q} 问`;
    if (a.verdict === '没问题') {
      if (flat(a.counterexample).length < MIN_REASON) problems.push(`${tag}答"没问题"，但没写为什么站得住（要引用草案的内容）。`);
      else valid.push(a);
      continue;
    }
    const target = flat(a.target);
    if (target.length < 4 || !text.includes(target)) problems.push(`${tag}的 target「${a.target.slice(0, 20)}」不是草案里的原话：从草案里原样抄一个短语。`);
    else if (flat(a.counterexample).length < MIN_COUNTEREXAMPLE || VAGUE.test(a.counterexample.trim())) problems.push(`${tag}的反例太空（「${a.counterexample.slice(0, 20)}」）：写一个具体的情形。`);
    else if (flat(a.fix).length < MIN_FIX || VAGUE.test(a.fix.trim())) problems.push(`${tag}的改法太空（「${a.fix.slice(0, 20)}」）：写清楚改成什么。`);
    else valid.push(a);
  }
  for (let q = 1; q <= EVAL_QUESTIONS.length; q++) {
    if (!valid.some((a) => a.q === q)) problems.push(`第 ${q} 问（${EVAL_QUESTIONS[q - 1]}）还没有合格的回答。`);
  }
  return { valid, problems };
}

/** One evaluation: asked, gated, asked again with the problems named (once), then whatever passed the gate is kept. */
export async function evaluate(model: LanguageModel, state: ComposeState, draft: string, signal?: AbortSignal): Promise<{ answers: EvalAnswer[]; problems: string[] }> {
  let problems: string[] = [];
  let best: EvalCheck = { valid: [], problems: ['评估员没有给出可读的回答。'] };
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let answers: EvalAnswer[];
    try {
      answers = (await composeJson({ model, task: 'workplan_eval', system: EVAL_SYSTEM, prompt: evalPrompt(state, draft, problems), schema: evaluationSchema, signal })).answers;
    } catch (e) {
      if (e instanceof BudgetError || !(e instanceof LlmJsonError || e instanceof LlmTimeoutError)) throw e;
      problems = [e instanceof LlmTruncatedError ? '上一次的输出太长被截断了：每条写短一点。' : `上一次的输出不是合法的 JSON：${e.message.slice(0, 120)}`];
      continue;
    }
    const check = checkEvaluation(answers, draft);
    if (check.valid.length >= best.valid.length) best = check;
    if (check.problems.length === 0) return { answers: check.valid, problems: [] };
    problems = check.problems.slice(0, 8);
  }
  return { answers: best.valid, problems: best.problems };
}

// ── step 3: one revision ──────────────────────────────────────────────────────────────────────────

const OPEN_HEADING = /^#{1,4}\s*没能改动的意见\s*$/m;

const REVISE_SYSTEM = [
  '你是写这份整体判断草案的顾问。评估员对草案提了意见（见下面编号），请改一版。',
  '- 直接改正文：每条意见都要么改掉，要么明确不改；改成什么样，就让正文本身说清楚，不要在正文里写"根据评估意见"；',
  '- 保留草案里没有被质疑的部分，不要重写一遍；篇幅不超过原来的 1.3 倍；',
  '- 正文照旧：不写编号、文件名，不画问题树；',
  '- 最后另起一段，标题写「## 没能改动的意见」：逐条写没能改动的意见，格式 `[编号] 原因`；都改了就写「无」。',
].join('\n');

export function revisePrompt(state: ComposeState, draft: string, issues: EvalAnswer[]): string {
  return [
    contractText(state),
    '',
    '## 草案',
    draft,
    '',
    '## 评估员的意见',
    ...issues.map((a, i) => `[${i + 1}] （${EVAL_QUESTIONS[a.q - 1]}）针对「${a.target}」\n    反例：${a.counterexample}\n    改法：${a.fix}`),
  ].join('\n');
}

/** The revised text without its closing section, and the issues that section says were not taken in. */
export function splitRevision(text: string, issues: EvalAnswer[]): { revised: string; unresolved: { issue: EvalAnswer; why: string }[] } {
  const m = OPEN_HEADING.exec(text);
  if (!m) return { revised: text.trim(), unresolved: [] };
  const revised = text.slice(0, m.index).trim();
  const unresolved: { issue: EvalAnswer; why: string }[] = [];
  for (const line of text.slice(m.index + m[0].length).split('\n')) {
    const x = /^\s*[-*]?\s*\[(\d+)\]\s*(.*)$/.exec(line);
    const issue = x ? issues[Number(x[1]) - 1] : undefined;
    if (x && issue) unresolved.push({ issue, why: x[2].trim() });
  }
  return { revised, unresolved };
}

/** An evaluator finding as one sentence for the Senior (no question numbers, no reviewer's code). */
export function openLine(a: EvalAnswer, why = ''): string {
  return `评估提醒：${EVAL_QUESTIONS[a.q - 1]}——「${a.target}」，${a.counterexample.replace(/[。.]$/, '')}${why ? `；这一版没能改动：${why.replace(/[。.]$/, '')}` : ''}。`;
}

// ── steps 1–3 together ────────────────────────────────────────────────────────────────────────────

async function asked<T>(call: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (e instanceof BudgetError || !(e instanceof LlmJsonError || e instanceof LlmTimeoutError)) throw e;
    }
  }
  return null;
}

export interface JudgmentDeps {
  model: LanguageModel;
  meter: Meter;
  perspectives: string[];
  signal?: AbortSignal;
}

/** Draft → evaluate → revise (one round). Returns null when no usable draft could be written (the caller reports a failed compose). */
export async function holisticJudgment(state: ComposeState, deps: JudgmentDeps): Promise<{ judgment: Judgment; log: string[] } | null> {
  const { model, meter, signal } = deps;
  const log: string[] = [];
  const draft = await asked(async () => {
    const t = await composeText({ model, task: 'workplan_judgment', system: DRAFT_SYSTEM, prompt: draftPrompt(state, deps.perspectives), signal });
    if (!isJudgmentText(t)) throw new LlmJsonError('草案太短');
    return t;
  });
  if (!draft) return null;

  if (!meter.canSpend()) {
    log.push('预算已过软限制：跳过评估和修订');
    return { judgment: { draft, evaluation: [], revised: draft, open: ['这一版的整体判断没有经过独立评估（时间或预算用完了），建议你重点看关键假设能不能被证伪。'] }, log };
  }
  const ev = await evaluate(model, state, draft, signal);
  const issues = ev.answers.filter((a) => a.verdict === '有问题');
  log.push(`评估：${ev.answers.length} 条合格回答，${issues.length} 处问题${ev.problems.length ? `；没过关口的：${ev.problems.join(' ')}`.slice(0, 300) : ''}`);

  if (issues.length === 0) return { judgment: { draft, evaluation: ev.answers, revised: draft, open: [] }, log };
  if (!meter.canSpend()) {
    log.push('预算已过软限制：跳过修订');
    return { judgment: { draft, evaluation: ev.answers, revised: draft, open: issues.map((a) => openLine(a, '时间或预算用完，没来得及改')) }, log };
  }
  const revision = await asked(async () => {
    const t = await composeText({ model, task: 'workplan_revise', system: REVISE_SYSTEM, prompt: revisePrompt(state, draft, issues), signal });
    const split = splitRevision(t, issues);
    // a revision that lost most of the draft is a different failure, not a revision
    if (!isJudgmentText(split.revised) || flat(split.revised).length < flat(draft).length * 0.5) throw new LlmJsonError('修订版太短');
    return split;
  });
  if (!revision) {
    log.push('修订失败：沿用原草案');
    return { judgment: { draft, evaluation: ev.answers, revised: draft, open: issues.map((a) => openLine(a, '修订没有成功')) }, log };
  }
  log.push(`修订：${revision.unresolved.length} 条没能改动`);
  return { judgment: { draft, evaluation: ev.answers, revised: revision.revised, open: revision.unresolved.map((u) => openLine(u.issue, u.why)) }, log };
}

