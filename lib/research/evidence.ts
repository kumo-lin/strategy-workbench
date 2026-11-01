/**
 * Evidence records and the code-side rules that read them: independence
 * (PRD §9.5 "互相独立"), the stop rule (§9.6) and the verdict check (§9.5).
 * The model proposes; these functions decide what is allowed to stand.
 */
import type { Verdict } from '@/lib/notes/schema';
import { isUserUploadPlatform } from './grading';
import type { ConditionStatus } from './schemas';

export type Grade = 'A' | 'B' | 'C';
export type EvidenceOrigin = '知识库' | '网络' | '专家访谈';
export type Stance = 'supports' | 'refutes' | 'irrelevant';
/** Which step found it (PRD §6.3.1): vault lookup, first web round, counter-evidence round, gap-filling round. */
export type EvidenceRound = 'kb' | 'web1' | 'counter' | 'web2';

export interface Evidence {
  /** `[[资料名#^cN]]` — what a report cites. */
  ref: string;
  path: string;
  block: string;
  /** The block text as stored (`「原文」— 位置：…`). */
  text: string;
  /** The original sentence, without the 「」 and location. */
  quote: string;
  sourceName: string;
  publisher: string;
  url: string | null;
  grade: Grade;
  origin: EvidenceOrigin;
  gradedBy: 'AI' | '人';
  /** 'expert' = an interview note (knowledge, kind expert-input, blocks ^eN). Default 'source'. */
  sourceKind?: 'source' | 'expert';
  /** Expert input from a simulated interview (simulated: true): a challenge or a lead, never evidence (PRD §7 rule 9). */
  simulated?: boolean;
  /** The source note's `reliability` (disproven sources never become evidence; unverified ones are marked). */
  reliability?: 'ok' | 'unverified';
  reliabilityNote?: string;
  published: string | null;
  claimId: string;
  subQuestionId: string;
  round: EvidenceRound;
  stance: Stance;
  /** Why the model judged this stance (one line). */
  reason: string;
  /** refutes only: the evidence directly overturns the claim's core premise. */
  core: boolean;
  /** refutes only: the claim holds only under narrower conditions. */
  partial: boolean;
}

export const GRADE_RANK: Record<Grade, number> = { A: 3, B: 2, C: 1 };

export const isExpert = (e: Pick<Evidence, 'sourceKind'>): boolean => e.sourceKind === 'expert';

/** "A 级" / "专家意见": what a reader sees next to a citation. */
export function gradeLabel(e: Pick<Evidence, 'grade' | 'sourceKind'>): string {
  return isExpert(e) ? '专家意见' : `${e.grade} 级`;
}

/** "知识库" / "网络 · AI 定级" / "模拟访谈 · 不计入 A/B 级来源". */
export function originLabel(e: Pick<Evidence, 'origin' | 'gradedBy' | 'sourceKind' | 'simulated'> & { url?: string | null; reliability?: string }): string {
  if (isExpert(e)) return e.simulated ? '模拟访谈 · 不计入 A/B 级来源' : '专家访谈 · 按 C 级计';
  const base = e.origin === '网络' ? `网络 · ${e.gradedBy === '人' ? '人工定级' : 'AI 定级'}` : '知识库';
  return [base, ...(isUserUploadPlatform(e.url) ? ['用户上传文档，转述'] : []), ...(e.reliability === 'unverified' ? ['未核实'] : [])].join(' · ');
}

const GENERIC_TOKENS = new Set(['企业', '公司', '是否', '什么', '怎么', '如何', '为什', '什么', '可以', '需要', '是不', '不是', '时的', '的角', '角色']);

/** Latin words (2+ letters) and CJK character pairs of a text, lower-cased: what two short texts can share. */
function overlapTokens(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.normalize('NFKC').toLowerCase();
  for (const w of t.match(/[a-z][a-z0-9]+/g) ?? []) out.add(w);
  for (const run of t.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) {
      const bi = run.slice(i, i + 2);
      if (!GENERIC_TOKENS.has(bi)) out.add(bi);
    }
  }
  return out;
}

/**
 * Is an interview answer about what this sub-question / claim asks? An interview note holds answers to many
 * questions (budget, rollout, security …) and the evaluator was not stopping the unrelated ones (C's v3: a budget
 * answer hung under the manageability claim). It must share at least two words or character pairs with the
 * claim statement plus the sub-question.
 */
export function expertAnswerRelevant(quote: string, ...about: string[]): boolean {
  const mine = overlapTokens(quote);
  const wanted = overlapTokens(about.join(' '));
  let shared = 0;
  for (const t of mine) if (wanted.has(t) && ++shared >= 2) return true;
  return false;
}

const SECOND_LEVEL = new Set(['com', 'co', 'org', 'net', 'gov', 'edu', 'ac']);

/** Registrable-ish domain of a URL, or null. `news.cn.reuters.com` → `reuters.com`; `x.gov.cn` → `x.gov.cn`. */
export function registrableDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.');
    if (labels.length <= 2) return labels.join('.');
    const tld = labels[labels.length - 1];
    const sld = labels[labels.length - 2];
    const keep = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
    return labels.slice(-keep).join('.');
  } catch {
    return null;
  }
}

/** "互相独立"：不同的发布方。Web sources are keyed by domain; preset sources by their publisher name. */
export function independenceKey(e: Pick<Evidence, 'url' | 'publisher'>): string {
  return registrableDomain(e.url) ?? `publisher:${e.publisher.trim().toLowerCase()}`;
}

export interface EvidenceSummary {
  supports: Evidence[];
  refutes: Evidence[];
  /** Distinct publishers among the supports. */
  independentSupports: number;
  /** Highest grade among the supports, or null. */
  bestSupportGrade: Grade | null;
  /** Refutes of grade A/B that directly overturn the core premise. */
  strongRefutes: Evidence[];
}

export function summarizeEvidence(evidence: Evidence[]): EvidenceSummary {
  // PRD §7 rule 9 / D-18: a simulated interview is a challenge or a lead, never a source: it supports nothing.
  // (A real expert interview counts as a C-grade source: its grade is C, so it can never make a 成立 alone.)
  const supports = evidence.filter((e) => e.stance === 'supports' && !(isExpert(e) && e.simulated));
  const refutes = evidence.filter((e) => e.stance === 'refutes');
  const independentSupports = new Set(supports.map(independenceKey)).size;
  const best = supports.reduce<Grade | null>((acc, e) => (acc === null || GRADE_RANK[e.grade] > GRADE_RANK[acc] ? e.grade : acc), null);
  const strongRefutes = refutes.filter((e) => e.core && GRADE_RANK[e.grade] >= GRADE_RANK.B);
  return { supports, refutes, independentSupports, bestSupportGrade: best, strongRefutes };
}

// ── Verdict rules (PRD §9.5) ─────────────────────────────────────────────────

export interface VerdictCheck {
  verdict: Verdict;
  /** True when the model's proposal was not allowed and was downgraded. */
  adjusted: boolean;
  /** Why (shown in the report when adjusted). */
  note: string;
}

export interface VerdictProposal {
  verdict: Verdict;
  /** Refs of refutes the model argues are overturned (with a stated reason elsewhere). */
  rebutted: string[];
  revisedStatement?: string | null;
}

/** Refutes that are not rebutted and are at least as strong as the best support. */
function unrebuttedBlockers(sum: EvidenceSummary, rebutted: ReadonlySet<string>): Evidence[] {
  if (!sum.bestSupportGrade) return [];
  return sum.refutes.filter((r) => !rebutted.has(r.ref) && GRADE_RANK[r.grade] >= GRADE_RANK[sum.bestSupportGrade!]);
}

/** What stops a 成立 under §9.5: the refutes not rebutted that are at least as strong as the best support. */
export function blockingRefutes(evidence: Evidence[], rebutted: string[]): Evidence[] {
  return unrebuttedBlockers(summarizeEvidence(evidence), new Set(rebutted));
}

/** D63 §3 rule 2: public material alone (interviews left out) clears the 成立 bar. */
function publicHolds(evidence: Evidence[], rb: ReadonlySet<string>): boolean {
  const sum = summarizeEvidence(evidence.filter((e) => !isExpert(e)));
  const abSupport = sum.bestSupportGrade === 'A' || sum.bestSupportGrade === 'B';
  return sum.independentSupports >= 2 && abSupport && unrebuttedBlockers(sum, rb).length === 0;
}

/** D63 §3 rule 3: at least one interview (real or simulated) supports, and no refute stands unrebutted. */
function interviewHolds(evidence: Evidence[], rb: ReadonlySet<string>): boolean {
  return evidence.some((e) => e.stance === 'supports' && isExpert(e)) && !evidence.some((e) => e.stance === 'refutes' && !rb.has(e.ref));
}

/**
 * The strongest verdict the evidence allows (D63 §3, in order): 不成立, 成立 on public material, 访谈支持, else 证据不足.
 * Never 需要修改: that is a judgement call.
 */
export function baselineVerdict(evidence: Evidence[], rebutted: string[] = []): Verdict {
  const sum = summarizeEvidence(evidence);
  const rb = new Set(rebutted);
  if (sum.strongRefutes.some((r) => !rb.has(r.ref))) return '不成立';
  if (publicHolds(evidence, rb)) return '成立';
  if (interviewHolds(evidence, rb)) return '访谈支持';
  return '证据不足';
}

/** A claim's verdict as pages show it: a 访谈支持 that rests only on simulated interviews says so. */
export function verdictLabel(verdict: Verdict, evidence: Evidence[] = []): string {
  if (verdict !== '访谈支持') return verdict;
  const interviews = evidence.filter((e) => e.stance === 'supports' && isExpert(e));
  return interviews.length > 0 && interviews.every((e) => e.simulated) ? '访谈支持（模拟访谈）' : verdict;
}

/** Best first (D63 §3): how a key question's claims are ranked. */
const KEY_QUESTION_ORDER: Verdict[] = ['成立', '需要修改', '访谈支持', '证据不足', '不成立'];

/** A key question (K1–K4, 1–3 claims) takes the best verdict among its claims. */
export function keyQuestionVerdict(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0) return '证据不足';
  return verdicts.reduce((best, v) => (KEY_QUESTION_ORDER.indexOf(v) < KEY_QUESTION_ORDER.indexOf(best) ? v : best));
}

/** A key question's verdict as pages show it: 需要修改 reads 部分支持. */
export function keyQuestionLabel(verdict: Verdict): string {
  return verdict === '需要修改' ? '部分支持' : verdict;
}

/**
 * Enforce §9.5 / D63 §3 on the model's proposal: anything the evidence does not support is downgraded to 证据不足;
 * a 成立 that only an interview carries becomes 访谈支持.
 */
export function enforceVerdict(proposal: VerdictProposal, evidence: Evidence[]): VerdictCheck {
  const sum = summarizeEvidence(evidence);
  const rb = new Set(proposal.rebutted);
  const downgrade = (note: string): VerdictCheck => ({ verdict: '证据不足', adjusted: true, note });

  switch (proposal.verdict) {
    case '成立': {
      if (publicHolds(evidence, rb)) return { verdict: '成立', adjusted: false, note: '' };
      if (interviewHolds(evidence, rb)) return { verdict: '访谈支持', adjusted: true, note: '访谈样本少，只能提到访谈支持' };
      const pub = summarizeEvidence(evidence.filter((e) => !isExpert(e)));
      if (pub.independentSupports < 2) return downgrade(`成立 需要至少 2 条互相独立的公开资料支持，现有 ${pub.independentSupports} 条，已调整为证据不足`);
      if (pub.bestSupportGrade !== 'A' && pub.bestSupportGrade !== 'B') return downgrade('成立 需要至少 1 条 A/B 级支持证据，已调整为证据不足');
      const blockers = unrebuttedBlockers(pub, rb);
      return downgrade(`存在同等级以上、未被驳倒的反证 ${blockers.map((b) => b.ref).join('、')}，已调整为证据不足`);
    }
    case '访谈支持': {
      if (interviewHolds(evidence, rb)) return { verdict: '访谈支持', adjusted: false, note: '' };
      return downgrade('访谈支持 需要至少 1 条访谈支持、且没有未被驳倒的反证，已调整为证据不足');
    }
    case '不成立': {
      const strong = sum.strongRefutes.filter((r) => !rb.has(r.ref));
      if (strong.length === 0) return downgrade('不成立 需要 A/B 级、直接推翻核心前提的反证，没有找到，已调整为证据不足');
      return { verdict: '不成立', adjusted: false, note: '' };
    }
    case '需要修改': {
      if (sum.supports.length + sum.refutes.length === 0) return downgrade('需要修改 需要有证据支持一部分，现有证据为 0，已调整为证据不足');
      if (!proposal.revisedStatement?.trim()) return downgrade('需要修改 必须同时给出修正后的假设，缺失，已调整为证据不足');
      return { verdict: '需要修改', adjusted: false, note: '' };
    }
    default:
      return { verdict: '证据不足', adjusted: false, note: '' };
  }
}

/**
 * The 成立 bar for a claim's part (an assertion of a revised statement, a plan condition): at least 2 independent
 * public supports, at least one of them A/B; an interview (real or simulated) is not a public source (D63 §3).
 */
export function supportBar(evidence: Evidence[]): { passed: boolean; basis: string } {
  const supports = evidence.filter((e) => e.stance === 'supports' && !isExpert(e));
  const independent = new Set(supports.map(independenceKey)).size;
  const best = supports.reduce<Grade | null>((acc, e) => (acc === null || GRADE_RANK[e.grade] > GRADE_RANK[acc] ? e.grade : acc), null);
  const passed = independent >= 2 && (best === 'A' || best === 'B');
  const basis = supports.length === 0 ? '没有资料证据支持' : `${independent >= 2 ? `${independent} 个独立来源` : `只有 ${independent} 个独立来源`}，最高 ${best} 级`;
  return { passed, basis };
}

// ── Plan conditions, one by one (D-48 格式约定) ──────────────────────────────

/**
 * A condition that states the judging standard, not anything about the world (W5 计划 v1, C1 ③: "至少 2 条互相独立的
 * 支持证据，其中至少 1 条 A/B 级"): only evidence counts, grades and independence. Code judges that bar itself, so the
 * line is skipped. "三者至少两个成立" is about the world and stays.
 */
export function isCriterionCondition(text: string): boolean {
  const COUNT = /(?:至少|不少于|不低于)\s*[\d一二两三四五六七八九十]+\s*[条份个篇家项]/;
  if (!COUNT.test(text) || !/[A-C]\s*[/／、或和]?\s*[A-C]?\s*级|独立/.test(text)) return false;
  const rest = text
    .replace(new RegExp(COUNT.source, 'g'), '')
    .replace(/[A-C]\s*[/／、或和]?\s*[A-C]?\s*级(?:以上)?/g, '')
    .replace(/(?:互相|彼此|相互)?独立|发布方不同|不同发布方|来源不同/g, '')
    .replace(/支持|证据|来源|资料|调研|报告|其中|以上|的|有|要|需要|需|并且|而且|且|和|与|及/g, '')
    .replace(/[\s\p{P}]/gu, '');
  return rest === '';
}

export interface ConditionCheck {
  n: number;
  status: ConditionStatus;
  keys: string[];
  note: string;
  /** Why code changed the model's status; absent when it did not. */
  adjusted?: string;
}

/**
 * Code checks the model's status of each condition against the evidence it names: a 成立 must clear supportBar; a
 * 不成立 must rest on an A/B refute that was not rebutted. What fails is 证据不足.
 */
export function checkCondition(c: { n: number; status: ConditionStatus; keys: string[]; note: string }, keyed: Map<string, Evidence>, rebutted: ReadonlySet<string>): ConditionCheck {
  const keys = [...new Set(c.keys.map((k) => k.replace(/[[\]\s]/g, '')).filter((k) => keyed.has(k)))];
  const cited = keys.map((k) => keyed.get(k)!);
  if (c.status === '成立') {
    const bar = supportBar(cited);
    if (!bar.passed) return { n: c.n, status: '证据不足', keys, note: c.note, adjusted: `成立要至少 2 个独立来源、其中 1 个 A/B 级，这条${bar.basis}，改为证据不足` };
  }
  if (c.status === '不成立') {
    const strong = cited.filter((e) => e.stance === 'refutes' && !isExpert(e) && GRADE_RANK[e.grade] >= GRADE_RANK.B && !rebutted.has(e.ref));
    if (!strong.length) return { n: c.n, status: '证据不足', keys, note: c.note, adjusted: '不成立要有一条没被驳倒的 A/B 级反证，这条没有，改为证据不足' };
  }
  return { n: c.n, status: c.status, keys, note: c.note };
}

/**
 * The claim's verdict from its conditions: all 成立 → 成立, all 不成立 → 不成立, all 证据不足 → 证据不足 (the user's
 * rule says "the rest 需要修改", which reads wrong for all 证据不足), anything else → 需要修改.
 */
export function verdictFromConditions(statuses: ConditionStatus[]): Verdict {
  for (const s of ['成立', '不成立', '证据不足'] as const) if (statuses.every((x) => x === s)) return s;
  return '需要修改';
}

// ── Stop rule (PRD §9.6) ─────────────────────────────────────────────────────

export type StopReason = 'decidable' | 'no_new_evidence' | 'rounds_exhausted' | 'budget_exhausted';

export interface StopInput {
  /** Evidence collected for this sub-question so far. */
  evidence: Evidence[];
  /** Web rounds already run for it. */
  webRoundsDone: number;
  maxWebRounds: number;
  /** New relevant (non-irrelevant) evidence each web round added, in order (rounds that read no page are left out). */
  newEvidenceByRound: number[];
  searchesLeft: number;
}

/** Returns why searching for this sub-question should stop, or null to continue. Order matters: decidable first. */
export function stopReason(input: StopInput): StopReason | null {
  const v = baselineVerdict(input.evidence);
  if (v === '成立' || v === '不成立') return 'decidable';
  const last2 = input.newEvidenceByRound.slice(-2);
  if (last2.length === 2 && last2.every((x) => x === 0)) return 'no_new_evidence';
  if (input.webRoundsDone >= input.maxWebRounds) return 'rounds_exhausted';
  if (input.searchesLeft <= 0) return 'budget_exhausted';
  return null;
}
