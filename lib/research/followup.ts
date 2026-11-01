/**
 * 追加调查 (D-18, smallest scope): on a delivered report, the owner picks a claim and adds ONE new sub-question
 * under it ("专家的反面意见：管得太死会不会让员工绕开 IT"). The sub-question joins the plan as a new plan version
 * that the owner approves with that same click (a human event, logged). The system then reruns from step 2 for
 * that sub-question with the small budget — vault first (interviews included), the web only if needed, the
 * mandatory counter-evidence round, the stop rule — judges the claim again under §9.5, and writes report v(N+1):
 *
 *   - everything in vN is kept; the claim's section gets the new verdict on top, the old line relabelled
 *     "vN 的提议判断", and an "追加调查（v(N+1)）" block at the bottom with the NEW evidence only;
 *   - a section "本版变化" right after Summary, written by code: what was added, whether the verdict moved, why;
 *   - "这次调查的出发点" (from the plan's links) is written again by code and replaces the old one under 怎么查的;
 *   - the same self-check as any report; a report that fails it stays a draft.
 * The follow-up runs through the same 9 steps and the same tool calls, so phase checks and the log apply.
 */
import type { LanguageModel } from 'ai';
import type { WebToolsClient } from '@/lib/deepseek/web-tools';
import { isPlanApproved } from '@/lib/harness/phases';
import { ToolNotAllowedError, type ToolContext } from '@/lib/harness/types';
import { resolveRunModels } from './run-models';
import { AI_WRITABLE_STATUSES, normalizeVerdict, VERDICTS, type Verdict } from '@/lib/notes/schema';
import { addSubQuestion, updateSubQuestion } from '@/components/research/plan-edit-utils';
import { applyApprovalEvent } from '@/lib/harness/events';
import type { Role } from '@/lib/config/roles';
import type { Vault } from '@/lib/vault';
import { RESEARCH_LIMITS, MAX_REPORT_REPAIR_ROUNDS, type ResearchMode } from './constants';
import { loadResearchContext, renderContext } from './context';
import { counterRound, firstRoundReserve, fillGaps, linkTo, patchReport, phaseA, recommendClaimOf, recommendFor, repair, type ExecuteResult, type RecommendClaim, type ResearchRunFacts } from './execute';
import { loadEvidenceRecord, restoreEvidence, serializeEvidence, writeEvidenceSidecar, type EvidenceRecordEntry } from './evidence-record';
import { summarizeEvidence, type Evidence } from './evidence';
import { challengeFailures, judgeClaim, revisionFailures, type ClaimResult, type KeyCounter } from './judge';
import { collectOrigins, renderOriginLines } from './origin';
import { directiveGaps, directiveRefs, expandDirectiveKeys, type DirectiveRef } from './directives';
import type { Emit } from './progress';
import { assertionGaps, cardAnswer, cell, citationOf, expandAssertionKeys, expandCitations, FOOTNOTE_HEADING, Footnotes, footnotesIn, isSoftGap, joinClauses, leafAnswer, recommendationGaps, renderClaimSection, renderRecommendation, softGapAction, soLenovo, sortedAlternatives, trimEndMark, verdictWithConditions } from './report';
import { mergeRecommendation, partsCiting, recommendationRange, recommendationRows, recommendationText, renderPartChanges, replaceRecommendation, partOfRow, REC_FIELD_ORDER, REC_PART_LABEL, type PartDecision, type RecPart } from './recommendation-diff';
import { entityFlagsOf } from './entity-check';
import { carryHumanEdits, disprovenCitations, mergeSourceWarnings, type DisprovenCitation } from './carry-over';
import { readSourceWarnings } from '@/lib/report/source-warnings';
import { describeFlag, describeInferenceFlag, describeKeyFlag, inferenceFlagsOf, isFlagCheck, isNumberCheck, keyFlagsOf, needsRepair, numberFailures, numberFlagsOf } from './number-repair';
import { citeBareBlockLinks } from './bare-links';
import { hypothesisLabel, questionTreeOf, type TreeLeaf, type TreeRoot } from './question-tree';
import { FIRST_HAND_CATEGORIES, sourceCategory } from './grading';
import { fixCarriedNumbers, modelReword, type CarriedFix } from './carried-numbers';
import { ResearchRun, type PlanClaim, type PlanSubQuestion } from './run';
import { clearRunClient, startRunClient } from './run-client';
import { responseKeys, type Recommendation, type SummaryDraft } from './schemas';
import { checkNewLines, citationFailures, decisionFailures, describeFailures, oldWordingHits, type CheckFailure } from './selfcheck';
import { writeProposedVerdicts } from './verdict-writer';
import { latestVersion } from './folders';
import { PlanSaveDenied, savePlanVersion } from './plan-save';
import { toEditable } from './plan-types';

export class FollowUpDenied extends Error {
  name = 'FollowUpDenied';
}

export interface FollowUpOptions {
  ctx: ToolContext;
  claimId: string;
  /** The new sub-question (already in the approved plan: see addFollowUpSubQuestion), e.g. `C1-Q3`. */
  subQuestionId: string;
  model?: LanguageModel;
  modelInfo?: { providerId: string; label: string; model: string };
  webClient?: WebToolsClient;
  emit?: Emit;
  signal?: AbortSignal;
  evalTimeoutMs?: number;
  repairRounds?: number;
  /**
   * The search / fetch budget. Default 'small' (what the live demo runs); 'full' runs the follow-up on the full
   * investigation's budget (D-28: C's (b)(a)(c) follow-ups, about 30 searches and 45 fetches).
   */
  budget?: ResearchMode;
}

export interface FollowUpChange {
  claimId: string;
  label: string;
  from: Verdict | null;
  to: Verdict;
  changed: boolean;
  newEvidence: number;
}

export interface FollowUpResult extends ExecuteResult {
  followUp: FollowUpChange & { subQuestionId: string; question: string; baseReport: string };
}

// ── pure text helpers (tested on their own) ─────────────────────────────────

interface Section {
  start: number;
  end: number;
}

/**
 * Line range of the `### <label> …` section (a question tree's `### 假设 H1：` / `#### 假设 H2-1：`), up to the next
 * heading. In a question tree the "- Q2-1 的回答：" line (in the card since D-48, after it before) is part of it.
 */
export function claimSectionRange(lines: string[], label: string): Section | null {
  const start = lines.findIndex((l) => l.startsWith(`### ${label} `) || l === `### ${label}` || new RegExp(`^#{3,4} 假设 ${label.replace(/-/g, '\\-')}[：:]`).test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,4} /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function h2Range(lines: string[], title: RegExp): Section | null {
  const start = lines.findIndex((l) => /^## /.test(l) && title.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Why the evidence allows this verdict, in §9.5's words, from the numbers (no model involved). */
export function whyVerdict(verdict: Verdict, evidence: Evidence[], revised?: string | null): string {
  const s = summarizeEvidence(evidence);
  const best = s.bestSupportGrade === 'A' || s.bestSupportGrade === 'B' ? `最高 ${s.bestSupportGrade} 级` : '没有 A/B 级';
  switch (verdict) {
    case '成立':
      return `现在有 ${s.independentSupports} 家互相独立的发布方支持（${best}），没有同等级以上、又没被驳倒的反证（按判断标准）`;
    case '不成立':
      return `有 ${s.strongRefutes.length} 条 A/B 级反证直接推翻了论点的核心前提（按判断标准）`;
    case '需要修改':
      return `证据只支持一部分，或只在更窄的条件下成立${revised ? `；修正后的假设：${revised}` : ''}（按判断标准）`;
    default:
      return `独立支持只有 ${s.independentSupports} 家（${best}），判断标准要求至少 2 家互相独立的、且至少 1 家是 A/B 级，也没有足以判“不成立”的 A/B 级反证`;
  }
}

const STANCE_WORD = { supports: '支持', refutes: '反驳' } as const;
/** What a new piece of evidence is called in the follow-up lines: an interview is a challenge or a view that agrees, never "support". */
const stanceOf = (e: Evidence): string => (e.sourceKind === 'expert' ? (e.stance === 'refutes' ? '专家意见 · 挑战' : '专家意见 · 同向的看法（不算支持证据）') : STANCE_WORD[e.stance as 'supports' | 'refutes']);
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

export interface FollowUpText {
  vNext: number;
  vPrev: number;
  label: string;
  statement: string;
  subQuestionId: string;
  question: string;
  from: Verdict | null;
  result: ClaimResult;
  newEvidence: Evidence[];
  searches: number;
  fetches: number;
  kbCount: number;
  webCount: number;
  expertCount: number;
  origins: string[];
  skipped: string[];
  /** v(N) had no evidence record: the starting evidence was read back from its text. */
  restoredFromText?: boolean;
  /** The base report uses footnotes (the D-20 format): new citations continue its numbering. Old reports: inline citations. */
  notes?: Footnotes;
  /** "AI 的推荐判断" rewritten on all of v(N+1)'s judgments; replaces vN's in Summary. */
  recommendation?: Recommendation;
  /** Why the recommendation could not be rewritten (vN's stays, the report is a draft). */
  recommendationFailed?: string;
  /** The follow-up found no new first-hand source for its sub-question: its conclusion is 证据不足, as a question for experts. */
  noPrimarySource?: boolean;
  /** The exec directive / decisions behind [M#] / [W#] in the rewritten recommendation. */
  recDirectives?: DirectiveRef[];
  /** The budget this follow-up ran on (default small). */
  budget?: ResearchMode;
  /**
   * D-39, a question-tree report: the re-judged hypothesis' sub-question (and the top-level one it belongs to). Its
   * section is written again on all of v(N+1)'s evidence (one response per challenge), its answers replaced.
   */
  tree?: { leaf: TreeLeaf; root: TreeRoot };
  /** Per part of the rewritten recommendation: changed (with why) or not; a part left out keeps vN's rows. */
  recParts?: Partial<Record<RecPart, PartDecision>>;
  /** Footnote ids whose source is disproven: a vN recommendation row citing one is never kept. */
  disprovenFootnotes?: ReadonlySet<string>;
  /** The re-judged claim's revised hypothesis in vN (its section's "- 修正后的假设：" line), null if it had none. */
  baseRevised?: string | null;
  /** The first-hand-source passes a full-budget follow-up ran (D-21 (b)): one line each, for 怎么查的. */
  primaryPasses?: string[];
  /** vN's carried-over clauses whose numbers were not in their originals, repaired before composing (Q-F). */
  carriedFixes?: CarriedFix[];
}

/** A registry seeded from the base report's footnotes, or undefined for an old-format report. */
export function footnotesFor(baseBody: string): Footnotes | undefined {
  if (!new RegExp(`^${FOOTNOTE_HEADING}\\s*$`, 'm').test(baseBody)) return undefined;
  const seed = footnotesIn(baseBody);
  return new Footnotes({ byRef: seed.byRef, max: seed.max });
}

const cite = (t: FollowUpText, e: Evidence) => (t.notes ? t.notes.cite(e) : citationOf(e));

/** "本版变化": what was added, did the verdict move, why. Code only. */
export function renderChangeSection(t: FollowUpText, recChanges?: string[], carried: CarriedFix[] = t.carriedFixes ?? []): string[] {
  const moved = t.from !== t.result.verdict;
  const by = (stance: 'supports' | 'refutes', expert: boolean) => t.newEvidence.filter((e) => e.stance === stance && (e.sourceKind === 'expert') === expert).length;
  const out = [
    `## 本版变化（v${t.vNext}，追加调查）`,
    t.tree
      ? `- 针对：${t.tree.leaf.qid} 的假设 ${t.label} ${trimEndMark(t.statement)}；新增要查的问题：「${t.question}」`
      : `- 针对：${t.label} ${trimEndMark(t.statement)}；新增的子问题 ${t.subQuestionId}：「${t.question}」`,
    `- 判断：${t.from ?? '（v' + t.vPrev + ' 没有记录）'} → ${t.result.verdict}（${moved ? '变了' : '没变'}）`,
    `- 为什么：${t.newEvidence.length === 0 ? '这一轮没有新增证据，所以判断依据和 v' + t.vPrev + ' 一样；' : `新增 ${t.newEvidence.length} 条证据（支持 ${by('supports', false)} · 反驳 ${by('refutes', false)} · 专家意见 ${by('supports', true) + by('refutes', true)}：挑战 ${by('refutes', true)} · 同向 ${by('supports', true)}）；`}${whyVerdict(t.result.verdict, t.result.evidence, t.result.revisedStatement)}${t.result.adjusted ? `。系统复核：模型提议“${t.result.judgment.verdict}”，${t.result.adjustNote}` : ''}`,
    '- 新增的证据（只看这几条就能确认这一版改了什么）：',
    ...(t.newEvidence.length
      ? t.newEvidence.map((e) => `  - ${stanceOf(e)} · ${cite(t, e)}`)
      : ['  - （没有新增）']),
    // what the recommendation table changed, compared by code (never told by the model)
    ...(recChanges
      ? ['- 推荐判断的变化（只列这次真正改了的格；没改的格逐字沿用 v' + t.vPrev + '）：', ...recChanges, `  - v${t.vPrev} 的推荐判断原样保留在附录里。`]
      : t.recommendationFailed
        ? [`- 推荐判断的变化：这一版没有重写推荐判断（${t.recommendationFailed}），Summary 里仍是 v${t.vPrev} 的推荐判断；报告存成草稿。`]
        : []),
    ...(carried.length ? [`- 沿用的 v${t.vPrev} 文字里，数字对不上所引原文的地方（数字核对，本版改了）：`, ...carried.map((f) => f.note)] : []),
    t.tree
      ? `- 没变的部分：其余子问题和假设原样保留。${t.label} 这一节按这一版的全部证据（v${t.vPrev} 的加上新增的）重写，每条挑战只保留这一版的回应；${t.tree.root.qid} 的回答和 Summary 里它的那一行跟着这一版改，v${t.vPrev} 的原句放在附录里。`
      : `- 没变的部分：其余论点，以及 ${t.label} 在 v${t.vPrev} 里的全部证据和推导，都原样保留在下面的正文里；v${t.vPrev} 的判断行标成了“v${t.vPrev} 的提议判断”。`,
    '',
  ];
  return out;
}

/** The block appended at the bottom of the claim's section. */
export function renderClaimAddition(t: FollowUpText): string[] {
  const ex = (s: string) => oneLine(expandCitations(s, t.result.keyed, t.notes).text);
  const responses = t.result.judgment.challenge_responses.filter((c) => responseKeys(c).some((k) => t.result.keyed.has(k)));
  return [
    `- 追加调查（v${t.vNext}）：新增子问题 ${t.subQuestionId}「${t.question}」`,
    `  - 提议的判断：${t.from ?? '（无记录）'} → ${t.result.verdict}（${t.from !== t.result.verdict ? '变了' : '没变'}）`,
    '  - 新增的证据：',
    ...(t.newEvidence.length
      ? t.newEvidence.map((e) => `    - ${stanceOf(e)} · ${cite(t, e)} — 评估：${oneLine(e.reason) || '（无）'}`)
      : ['    - （没有新增）']),
    // each challenge answered one by one, by the judge step, written in by code; the challenge's footnote goes after
    // the challenge (what the source says), not after the response (Q-F: the inference is the author's)
    ...(responses.length
      ? ['  - 逐条回应挑战：', ...responses.map((c) => `    - ${ex(c.challenge)}${responseKeys(c).flatMap((k) => (t.result.keyed.has(k) ? [cite(t, t.result.keyed.get(k)!)] : [])).join('')} → ${c.effect}：${ex(c.response)}`)]
      : []),
    // a revision made now is checked like a first run's: each core assertion against the 成立 bar
    ...((t.result.assertions ?? []).length
      ? [
          '  - 修正后的论断，逐条过证据门槛（至少 2 个独立来源、其中至少 1 个 A/B 级）：',
          ...(t.result.assertions ?? []).map((a) => `    - ${a.key}（${a.status}：${a.basis}${a.status === '待验证' ? '；转成要问专家的问题' : ''}）：${ex(`${a.text}${a.keys.map((k) => ` [${k}]`).join('')}`)}`),
        ]
      : []),
    `  - 更新后的推导（推断）：${ex(t.result.judgment.reasoning)}`,
    ...(t.noPrimarySource ? [`  - 这一问的结论：证据不足（这次没有找到一手来源），转成要问专家的问题`] : []),
    ...((qs) => (qs.length ? [`  - 仍要问专家：${joinClauses(qs)}`] : []))([
      ...t.result.judgment.expert_questions.map((q) => ex(q)),
      ...(t.result.assertions ?? []).filter((a) => a.status === '待验证').map((a) => `核实「${a.text}」（${a.key} 待验证：${a.basis}）`),
    ]),
  ];
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').replace(/[。.]+$/, '');

/** The claim's "- 修正后的假设：" line in vN's section, or null. */
export function revisedIn(body: string, label: string): string | null {
  const lines = body.split('\n');
  const sec = claimSectionRange(lines, label);
  const line = sec ? lines.slice(sec.start, sec.end).find((l) => /^- 修正后的假设：/.test(l)) : undefined;
  return line ? line.replace(/^- 修正后的假设：/, '').trim() : null;
}

/** The follow-up changed the claim's judgment: its verdict moved, or its revised hypothesis is not vN's. */
export function judgmentChanged(t: Pick<FollowUpText, 'from' | 'result' | 'baseRevised'>): { verdict: boolean; revised: boolean; any: boolean } {
  const verdict = t.from !== t.result.verdict;
  const revised = !!t.result.revisedStatement && norm(t.result.revisedStatement) !== norm(t.baseRevised);
  return { verdict, revised, any: verdict || revised };
}

/** What marks a Summary sentence kept from vN that this version's changed judgment may contradict. */
export const staleMark = (vPrev: number) => `（v${vPrev} 原文，以本版变化为准）`;
/** An earlier version's mark (a second follow-up replaces it, never stacks a second one). */
const ANY_STALE = /（v\d+ 原文，以本版变化为准）/;

/**
 * Summary after a follow-up changed a claim's judgment (D-21 (b) v4: the 一句话答案 and H2's 理由 still said v3's
 * "门槛" while 本版变化 said "不承诺门槛"). The claim's 理由 is replaced by the rewrite, the 一句话答案 too when one
 * was written; whatever was not rewritten, and the workplan-impact lines about the claim, are marked as vN's text.
 * Returns the lines and vN's sentences that were replaced (they go to the appendix).
 */
export function rewriteSummary(lines: string[], o: { label: string; vPrev: number; vNext: number; changed: boolean; reason: string; soWhat: string }): { lines: string[]; replaced: string[] } {
  const out = [...lines];
  const replaced: string[] = [];
  const sum = h2Range(out, /^## Summary/);
  if (!sum || !o.changed) return { lines: out, replaced };
  const stale = staleMark(o.vPrev);
  const tag = `（v${o.vNext} 按本版判断重写）`;
  const aboutClaim = new RegExp(`${o.label}(?!\\d)`);
  let inImpact = false;
  for (let k = sum.start; k < sum.end; k++) {
    const l = out[k];
    const answer = /^- (一句话答案|So what)：(.*)$/.exec(l);
    if (answer) {
      if (o.soWhat) {
        replaced.push(`  - 一句话答案：${answer[2]}`);
        out[k] = `- ${answer[1]}：${o.soWhat}${tag}`;
      } else out[k] = `- ${answer[1]}：${stale}${answer[2].replace(ANY_STALE, '')}`;
      continue;
    }
    if (new RegExp(`^\\|\\s*${o.label}\\s`).test(l)) {
      const cells = l.split('|');
      if (cells.length > 4) {
        const old = cells[3].trim();
        if (o.reason) {
          replaced.push(`  - ${o.label} 的理由：${old}`);
          cells[3] = ` ${o.reason}${tag} `;
        } else cells[3] = ` ${stale}${old.replace(ANY_STALE, '')} `;
        out[k] = cells.join('|');
      }
      continue;
    }
    if (/^- /.test(l)) inImpact = /^- 对 ?(workplan|研究计划) ?的影响/.test(l); // reports before 复核 A say workplan
    else if (inImpact && /^\s+- /.test(l) && aboutClaim.test(l)) out[k] = l.replace(/^(\s+- )(?:（v\d+ 原文，以本版变化为准）)?/, `$1${stale}`);
  }
  return { lines: out, replaced };
}

/** Lines appended at the end of the appendix (one is created before 引文出处 when there is none). */
function appendToAppendix(lines: string[], block: string[]): string[] {
  const out = [...lines];
  const app = out.findIndex((l) => /^## 附录/.test(l));
  if (app >= 0) {
    let end = out.findIndex((l, k) => k > app && /^## /.test(l));
    if (end < 0) end = out.length;
    while (end > app + 1 && out[end - 1].trim() === '') end--;
    out.splice(end, 0, ...block, '');
  } else {
    const fn = out.findIndex((l) => /^## 引文出处/.test(l));
    out.splice(fn < 0 ? out.length : fn, 0, '## 附录：过程记录', ...block, '');
  }
  return out;
}

export interface ComposeInput extends FollowUpText {
  baseBody: string;
  runLine: string;
}

/** vN's body → v(N+1)'s body. Throws when the base report has no section for the claim. */
export function composeFollowUpBody(i: ComposeInput): string {
  let lines = i.baseBody.replace(/\r\n/g, '\n').split('\n');
  // title
  lines = lines.map((l, idx) => (idx === lines.findIndex((x) => /^# /.test(x)) ? l.replace(/调查报告 v\d+/, `调查报告 v${i.vNext}`) : l));
  // A hand-confirmed v(N) must not pass its confirmation on to what is new in v(N+1)
  if (/内容已由用户确认/.test(i.baseBody)) {
    const t = lines.findIndex((x) => /^# /.test(x));
    lines.splice(t + 1, 0, '', `> ⚠ v${i.vPrev} 开头写的“内容已由用户确认”只对 v${i.vPrev} 的原文有效；v${i.vNext} 新增的“本版变化”和“追加调查（v${i.vNext}）”还没有被确认。`);
  }
  const treeReplaced: string[] = [];
  if (i.tree) lines = composeTreeSections(lines, i, treeReplaced);
  else lines = composeClaimSection(lines, i);
  // the claim's 理由 and the 一句话答案, when the judgment changed: rewritten, or marked as vN's text (a question tree: done above)
  const ex = (t: string) => oneLine(expandCitations(expandAssertionKeys(expandDirectiveKeys(t, i.recDirectives ?? [], i.notes), i.result.assertions ?? [], { tree: Boolean(i.tree) }), i.result.keyed, i.notes).text);
  const su = i.recommendation?.summary_update;
  const rewritten = i.tree ? { lines, replaced: treeReplaced } : rewriteSummary(lines, { label: i.label, vPrev: i.vPrev, vNext: i.vNext, changed: judgmentChanged(i).any, reason: su?.reason.trim() ? ex(su.reason) : '', soWhat: su?.so_what.trim() ? ex(su.so_what) : '' });
  lines = rewritten.lines;
  return finishFollowUpBody(lines, i, ex, rewritten.replaced);
}

/** The older report: vN's claim section kept, the new judgment and the follow-up's block added; the Summary line marked. */
function composeClaimSection(base: string[], i: ComposeInput): string[] {
  let lines = base;
  const sec = claimSectionRange(lines, i.label);
  if (!sec) throw new FollowUpDenied(`报告 v${i.vPrev} 里找不到 ${i.label} 的小节，没法追加`);
  let body = lines.slice(sec.start, sec.end);
  let trailing = 0;
  while (body.length > 1 && body[body.length - 1].trim() === '') {
    body.pop();
    trailing++;
  }
  const moved = judgmentChanged(i);
  body = body.map((l) => (/^- 提议的判断：/.test(l) ? l.replace('- 提议的判断：', `- v${i.vPrev} 的提议判断：`) : moved.revised && /^- 修正后的假设：/.test(l) ? l.replace('- 修正后的假设：', `- v${i.vPrev} 的修正后的假设：`) : l));
  const headIdx = 0;
  body.splice(
    headIdx + 1,
    0,
    `- 提议的判断：${i.result.verdict}（追加调查 v${i.vNext} 之后；AI 提议，等人拍板后才生效）`,
    ...(moved.revised ? [`- 修正后的假设（v${i.vNext}）：${oneLine(i.result.revisedStatement ?? '')}`] : []),
    ...(i.result.adjusted ? [`- 系统复核：模型提议“${i.result.judgment.verdict}”，${i.result.adjustNote}`] : []),
  );
  body.push(...renderClaimAddition(i), ...Array(trailing).fill(''));
  lines = [...lines.slice(0, sec.start), ...body, ...lines.slice(sec.end)];

  // Summary result line for this claim
  const sum = h2Range(lines, /^## Summary/);
  if (sum) {
    for (let k = sum.start; k < sum.end; k++) {
      if (new RegExp(`^\\s*- ${i.label} → `).test(lines[k])) lines[k] = `${lines[k]} ⇒ 追加调查 v${i.vNext} 之后：${i.result.verdict}（详见“本版变化”）`;
      // the D-20 claims table: | H1 论点 | 提议的判断 | 理由 | 证据 |
      else if (new RegExp(`^\\|\\s*${i.label}\\s`).test(lines[k])) {
        const cells = lines[k].split('|');
        if (cells.length > 3) cells[2] = ` ${cells[2].trim()} ⇒ v${i.vNext}：${i.result.verdict}（见“本版变化”） `;
        lines[k] = cells.join('|');
      }
    }
  }
  return lines;
}

/**
 * A split sub-question's card and its answer line: since D-48 renderClaimSection writes "- Q2-1 的回答：" in the card;
 * a card without it (written the older way) gets it after, as before. Never twice.
 */
export function withLeafAnswer(card: string[], qid: string, answer: () => string): string[] {
  return card.some((l) => l.startsWith(`- ${qid} 的回答：`)) ? card : [...card, `- ${qid} 的回答：${answer()}`];
}

/**
 * A question-tree report (D-39): the hypothesis' section is written again on all of v(N+1)'s evidence (the judge saw
 * vN's evidence and the new; one response per challenge, so vN's responses are not kept beside the new ones), with its
 * code-written "Q2-1 的回答"; the top-level sub-question's answer (### Q2 的回答 and its Summary line), the hypothesis'
 * row in the Summary table and, when the model rewrote it, the one-line answer follow this version. Only this
 * version's judgment is written; the comparison with vN goes to 本版变化 (用词对照表). Replaced lines are returned.
 */
function composeTreeSections(base: string[], i: ComposeInput, replaced: string[]): string[] {
  const { leaf, root } = i.tree!;
  const lines = [...base];
  const ex = (t: string) => oneLine(expandCitations(expandAssertionKeys(t, i.result.assertions ?? [], { tree: true }), i.result.keyed, i.notes).text);
  // the section: a heading, or the line a small run left for a hypothesis it did not reach
  let sec = claimSectionRange(lines, i.label);
  if (!sec) {
    const at = lines.findIndex((l) => new RegExp(`^\\s*- 假设 ${i.label.replace(/-/g, '\\-')}：.*（本次没有查`).test(l));
    if (at < 0) throw new FollowUpDenied(`报告 v${i.vPrev} 里找不到 ${i.label} 的小节，没法追加`);
    let end = at + 1;
    if (leaf.parent && lines[end]?.startsWith(`- ${leaf.qid} 的回答：`)) end++;
    sec = { start: at, end };
  }
  const card = renderClaimSection(i.result, i.notes, { depth: leaf.parent ? 4 : 3, qid: leaf.qid }).md.split('\n');
  let tail = sec.end;
  while (tail > sec.start + 1 && lines[tail - 1].trim() === '') tail--;
  lines.splice(sec.start, tail - sec.start, ...(leaf.parent ? withLeafAnswer(card, leaf.qid, () => leafAnswer(i.result, ex)) : card));

  // the top-level sub-question's answer: the model's rewrite, else code from the hypotheses' judgments
  const su = i.recommendation?.summary_update;
  const childLines = root.children.map((c) => lines.find((l) => l.startsWith(`- ${c.qid} 的回答：`))?.replace(/^- /, '').replace(' 的回答：', '：') ?? '');
  // (the live run's rewrite opened with "H2 的理由改成：": the answer is the answer, without that label)
  const written = su?.reason.trim() ? ex(su.reason).replace(/^H\d+(?:-\d+)?\s*的(?:理由|回答)(?:改成)?[：:]\s*/, '') : '';
  const answer = written || (root.leaf ? leafAnswer(i.result, ex) : childLines.filter(Boolean).join(' '));
  const head = lines.findIndex((l) => l.trim() === `### ${root.qid} 的回答`);
  if (head >= 0) {
    let end = lines.findIndex((l, k) => k > head && /^#{1,4} /.test(l));
    if (end < 0) end = lines.length;
    let last = end;
    while (last > head + 1 && lines[last - 1].trim() === '') last--;
    lines.splice(head + 1, last - head - 1, '', answer);
  }
  // the appendix of a small v1 said this hypothesis was not run: it is now
  const notRun = lines.findIndex((l) => /^- 计划之外的调整：/.test(l));
  if (notRun >= 0) {
    const kept = lines[notRun].replace(/^- 计划之外的调整：/, '').split('；').filter((x) => ![`${i.label} 本次没有查（试水调查范围）`, `${i.label} 本次没有查（小调查范围）`].includes(x.trim())); // older reports say 小调查
    lines[notRun] = `- 计划之外的调整：${kept.join('；') || '无'}`;
  }
  const sum = h2Range(lines, /^## Summary/);
  if (sum) {
    for (let k = sum.start; k < sum.end; k++) {
      const l = lines[k];
      if (new RegExp(`^\\s+- ${root.qid} → `).test(l)) {
        replaced.push(`  - ${l.trim()}`);
        lines[k] = `  - ${root.qid} → ${answer}`;
      } else if (new RegExp(`^\\|\\s*${leaf.qid.replace(/-/g, '\\-')}\\s*\\|`).test(l)) {
        const cells = l.split('|');
        if (cells.length > 3) cells[3] = ` ${cell(verdictWithConditions(i.result, ex))} `;
        // D-48's 回答 column (| 子问题 | 假设 | 提议的判断 | 回答 |) follows this version too
        if (cells.length > 5) cells[4] = ` ${cell(root.leaf ? answer : cardAnswer(i.result, ex))} `;
        lines[k] = cells.join('|');
      } else if (/^- 回答（一句话）：/.test(l)) {
        const parts = /^- 回答（一句话）：(.*?)（由 (.*?) 的回答组装而成）(.*)$/.exec(l);
        const from = new Set((parts?.[2] ?? '').split('、').filter((x) => /^Q\d+$/.test(x)));
        from.add(root.qid);
        const order = [...from].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).join('、');
        if (su?.so_what.trim()) {
          replaced.push(`  - 回答（一句话）：${parts?.[1] ?? l.replace(/^- 回答（一句话）：/, '')}`);
          lines[k] = `- 回答（一句话）：${ex(su.so_what)}（由 ${order} 的回答组装而成）${parts?.[3] ?? ''}`;
        } else if (parts) lines[k] = `- 回答（一句话）：${parts[1]}（由 ${order} 的回答组装而成）${parts[3]}`;
      }
    }
  }
  return lines;
}

/** "- 所以联想：" (D-48 round 2), in a Summary that has one: from its recommendation table's 对决策的回答, as it now reads. */
export function withLenovoLine(lines: string[]): string[] {
  const sum = h2Range(lines, /^## Summary/);
  if (!sum) return lines;
  const at = lines.findIndex((l, k) => k >= sum.start && k < sum.end && /^- 所以联想：/.test(l));
  if (at < 0) return lines;
  const row = lines.slice(sum.start, sum.end).find((l) => /^\|\s*对决策的回答\s*\|/.test(l));
  const lenovo = row ? soLenovo(row.trim().replace(/^\|\s*对决策的回答\s*\|/, '').replace(/\|$/, '')) : '';
  const out = [...lines];
  if (lenovo) out[at] = `- 所以联想：${lenovo}`;
  else out.splice(at, 1);
  return out;
}

/** What follows the claim's part for both formats: the recommendation, 本版变化, 怎么查的, the footnotes. */
function finishFollowUpBody(base: string[], i: ComposeInput, ex: (t: string) => string, replacedSummary: string[]): string {
  let lines = base;
  const rewritten = { replaced: replacedSummary };
  // AI 的推荐判断: the rewritten table replaces vN's (which moves to the appendix); the rows that changed go to 本版变化
  let recChanges: string[] | undefined;
  if (i.recommendation) {
    let block = renderRecommendation(i.recommendation, ex, Boolean(i.tree));
    while (block.length && block[block.length - 1].trim() === '') block.pop();
    const range = recommendationRange(lines);
    if (range) {
      // part by part: vN's rows verbatim unless the part really changed (decided and checked in executeFollowUp)
      const merged = mergeRecommendation(lines.slice(range.start, range.end + 1), block, i.recParts ?? {}, i.disprovenFootnotes);
      block = merged.block;
      recChanges = renderPartChanges(merged.changes, merged.keptRows, ex);
    } else {
      recChanges = [`  - v${i.vPrev} 没有推荐判断表，这一版新写了一张`];
    }
    lines = replaceRecommendation(lines, block, i.vPrev).lines;
    lines = withLenovoLine(lines);
  }
  if (rewritten.replaced.length) lines = appendToAppendix(lines, [`- v${i.vPrev} 的 Summary 原文（这一版按新的判断重写了的句子）：`, ...rewritten.replaced]);
  // 本版变化 right after Summary
  const sum2 = h2Range(lines, /^## Summary/);
  const at = sum2 ? sum2.end : 1;
  // a carried clause the rewrite replaced anyway is not a change of its own
  const carried = (i.carriedFixes ?? []).filter((f) => lines.some((l) => l.includes(f.after)));
  lines.splice(at, 0, ...renderChangeSection(i, recChanges, carried));
  // 怎么查的: this follow-up's facts and its starting point (by code, like the first run)
  const how = h2Range(lines, /^## 怎么查的/);
  const add = [
    `- 追加调查（v${i.vNext}）：针对 ${i.label}；${i.budget === 'full' ? '完整调查' : '试水调查'}的预算；联网搜索 ${i.searches} 次、抓取 ${i.fetches} 次；这一轮读了 知识库 ${i.kbCount} 份、网络 ${i.webCount} 份${i.expertCount ? `、专家访谈 ${i.expertCount} 份（模拟访谈只当挑战或线索，不计入 A/B 级来源）` : ''}`,
    ...(i.restoredFromText ? [`- 追加调查的起点：v${i.vPrev} 没有证据记录，起始证据按它正文里 ${i.label} 小节引用的块还原（支持 / 反证按所在小节判定，“是否直接推翻核心前提”看不出来，按否处理）`] : []),
    ...(i.primaryPasses ?? []),
    ...i.skipped.map((s) => `- 追加调查中跳过：${s}`),
  ];
  if (how) {
    // the starting point is replaced where it stands (a second copy would say the same thing twice)
    const at0 = lines.findIndex((l, k) => k > how.start && k < how.end && /^- 这次调查的出发点/.test(l));
    if (at0 >= 0) {
      let stop = at0 + 1;
      while (stop < how.end && /^\s+- /.test(lines[stop])) stop++;
      lines.splice(at0, stop - at0, ...i.origins);
      how.end += i.origins.length - (stop - at0);
    } else {
      add.unshift(...i.origins);
    }
    let end = how.end;
    while (end > how.start + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, ...add);
  }
  // new footnotes go to the end of 引文出处 (numbering continues from the base report)
  const added = i.notes?.lines() ?? [];
  if (added.length) {
    const fn = h2Range(lines, new RegExp(`^${FOOTNOTE_HEADING}\\s*$`));
    if (fn) {
      let end = fn.end;
      while (end > fn.start + 1 && lines[end - 1].trim() === '') end--;
      const none = lines.findIndex((l, k) => k > fn.start && k < end && l.trim() === '（没有引用）');
      if (none >= 0) {
        lines.splice(none, 1);
        end--;
      }
      lines.splice(end, 0, ...added);
    } else {
      lines.push('', FOOTNOTE_HEADING, ...added);
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Reports written before `evidence_record` existed: take the evidence from what the claim's section cites.
 * A ref under "支持的证据" supports, under "反证" refutes; in the 专家意见 line, 挑战 refutes. Whether a refutation
 * was "core" is not in the text, so it is false: the restored set can never make a 不成立 by itself.
 */
export function evidenceRecordFromSection(bodyLines: string[], label: string, claim: { id: string; sub_questions: { id: string }[] }): EvidenceRecordEntry[] {
  const sec = claimSectionRange(bodyLines, label);
  if (!sec) return [];
  const out: EvidenceRecordEntry[] = [];
  const seen = new Set<string>();
  let mode: 'supports' | 'refutes' | 'expert' | null = null;
  for (const line of bodyLines.slice(sec.start + 1, sec.end)) {
    if (/^- /.test(line)) {
      mode = /^- 支持的证据/.test(line) ? 'supports' : /^- 反证/.test(line) ? 'refutes' : /^- 专家意见/.test(line) ? 'expert' : null;
      if (!mode) continue;
    }
    if (!mode || /^- v\d+ 的提议判断|^- 追加调查/.test(line)) continue;
    const stance = mode === 'expert' ? (/挑战/.test(line) ? 'refutes' : 'supports') : mode;
    for (const m of line.matchAll(/\[\[[^\]]+?#\^[A-Za-z0-9-]+(?:\|[^\]]*)?\]\]/g)) {
      const ref = m[0].replace(/\|[^\]]*\]\]$/, ']]');
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push({ claim: claim.id, sub: claim.sub_questions[0]?.id ?? `${claim.id}-Q1`, ref, stance, core: false, partial: false, round: 'kb', reason: '' });
    }
  }
  return out;
}

/** check_citations (card + log) over the WHOLE new report, the text rules over what was written now. */
async function followUpSelfCheck(run: ResearchRun, body: string, newLines: string[], issuedKeys: Set<string>, numbers: { results: ClaimResult[]; baseBody: string }): Promise<CheckFailure[]> {
  await run.tool('check_citations', { text: body }, '交出报告之前自检每一条引用（整份报告）');
  // Q-F: numbers are checked everywhere, vN's carried text too (it was repaired before composing: fixCarriedNumbers);
  // the 回应 rules only in what this version wrote (vN's text is kept verbatim)
  const vN = new Set(numbers.baseBody.split('\n'));
  const numberFails = await numberFailures({ vault: run.ctx.vault, log: (a, c, r) => run.log(a, c, r), results: numbers.results, issuedKeys, onlyLines: (_, text) => !vN.has(text), numberLines: () => true }, body);
  return [...citationFailures(await run.ctx.vault.checkCitations(body)), ...(await decisionFailures(run.ctx.vault, newLines.join('\n'))), ...checkNewLines(newLines, issuedKeys, body), ...numberFails];
}

/** The model's why opening with what code already says for a part that stood on a disproven source. */
const DISPROVEN_OPENING = /^\s*上一版依据的来源已证伪[，,；;：:。\s]*/;

/** A vN part that stood on a disproven source must come back marked changed (code keeps nothing of it either way). */
export function forcedGaps(rec: Recommendation | undefined, forced: ReadonlyMap<RecPart, string[]>): string[] {
  if (!rec) return [];
  return [...forced]
    .filter(([part]) => rec.changes?.[part]?.changed !== true || (part === 'decision_answer' && !rec.decision_answer.trim()) || (part === 'directive_response' && !rec.directive_response.trim()))
    .map(([part, ids]) => `“${REC_PART_LABEL[part]}”这一格上一版依据的来源已证伪（${ids.map((n) => `[^${n}]`).join('')}）：必须按这一版的证据重写，不能再用那份资料里的说法；changes.${part} 写 changed=true，why 开头写“上一版依据的来源已证伪”`);
}

type SummaryUpdateInput = { label: string; changed: boolean; keyed: Map<string, Evidence>; issuedKeys: ReadonlySet<string>; body: string };

/** The new-line rules on the rewrite's new Summary 理由 / 一句话答案 (none when the judgment did not change). */
function summaryUpdateChecks(rec: Recommendation | undefined, o: SummaryUpdateInput): CheckFailure[] {
  const su = rec?.summary_update;
  if (!o.changed || !su?.reason.trim()) return [];
  const ex = (t: string) => oneLine(expandCitations(t, o.keyed).text);
  return checkNewLines([ex(su.reason), ...(su.so_what.trim() ? [ex(su.so_what)] : [])], o.issuedKeys, o.body);
}

/**
 * The re-judged claim's judgment changed: the rewrite must give its new Summary 理由, written like any new line.
 * `numbers: false` (after the repair rounds): a number with no source is flagged (summaryUpdateNumberFlags), not a gap.
 */
export function summaryUpdateGaps(rec: Recommendation | undefined, o: SummaryUpdateInput & { numbers?: boolean; tree?: boolean }): string[] {
  if (!rec || !o.changed) return [];
  // a question tree: an answer the rewrite leaves out is written by code from the judgments (never a reason to stop)
  if (!rec.summary_update?.reason.trim() && o.tree) return [];
  if (!rec.summary_update?.reason.trim()) return [`summary_update.reason 没有写：${o.label} 的判断或修正后的论点这一版变了，Summary 论点表里它的“理由”要按这一版重写`];
  return summaryUpdateChecks(rec, o)
    .filter((f) => o.numbers !== false || !isNumberCheck(f))
    .map((f) => `summary_update：${f.message}`);
}

/** What the repair rounds left of the number checks on the new Summary 理由: flagged with the rest (D-21-4 f). */
export const summaryUpdateNumberFlags = (rec: Recommendation | undefined, o: SummaryUpdateInput): CheckFailure[] => summaryUpdateChecks(rec, o).filter(isNumberCheck);

/**
 * D-21 (b) v4: a full-budget follow-up stopped after 2 searches (the stop rule saw "no new evidence" after one round)
 * with no A/B first-hand source. On the full budget, until one is found, the sub-question is searched for each kind of
 * first-hand source, in Chinese and in English; only then may it end as 证据不足 (a question for experts).
 */
export const FIRST_HAND_PASSES = [
  { kind: '监管规定原文', what: '监管机构或政府部门发布的规定、指引、通知原文（发布机构官网上的文件本身）' },
  { kind: '招标与采购文件', what: '招标公告、采购文件、评分办法、中标结果公告的原文（采购平台或采购方官网上的文件本身）' },
  { kind: '官方发布', what: '企业或机构在自己官网发布的原文（公告、白皮书、产品与合规文档），不是媒体对它的报道' },
] as const;
const HAS_CJK = /[\u3400-\u9fff]/;
export const QUERY_LANGS = [
  { name: '中文', ok: (q: string) => HAS_CJK.test(q) },
  { name: '英文', ok: (q: string) => !HAS_CJK.test(q) && /[A-Za-z]/.test(q) },
] as const;

/**
 * Is this a first-hand source found by this follow-up (D-21-4 v4): a page THIS run fetched from the web (not vN's
 * evidence, not a note reused from the vault: v4 counted the knowledge base's Gartner and 数位时代 and skipped all six
 * passes), of a first-hand type (监管 / 采购招标 / 官方发布: sourceCategory, from the URL), A/B, not an interview.
 * Analyst firms and media retell the original; they never end the passes.
 */
export const isFirstHand = (seedRefs: ReadonlySet<string>, fetched: ReadonlySet<string>) => (e: Evidence) =>
  !seedRefs.has(e.ref) && e.sourceKind !== 'expert' && (e.grade === 'A' || e.grade === 'B') && fetched.has(e.path) && FIRST_HAND_CATEGORIES.has(sourceCategory(e.url));

async function firstHandPasses(run: ResearchRun, claim: PlanClaim, q: PlanSubQuestion, seedRefs: ReadonlySet<string>, vNext: number): Promise<string[]> {
  const st = run.subStates.get(q.id);
  const tried = st?.tried ?? [];
  const found = () => run.evidenceFor(claim.id, q.id).filter(isFirstHand(seedRefs, run.fetchedSources));
  const lines: string[] = [];
  let n = 0;
  for (const pass of FIRST_HAND_PASSES) {
    for (const lang of QUERY_LANGS) {
      if (found().length) break;
      n += 1;
      const what = `${pass.kind} · ${lang.name}`;
      if (run.availableSearches() <= 0) {
        lines.push(`  - ${what}：搜索次数用完了，没有查`);
        continue;
      }
      const sid = `s7:${q.id}:first-hand:${n}`;
      const title = `找一手来源 · ${q.id}（${what}）`;
      run.step(sid, 7, title, 'running');
      try {
        const gap = `这一轮只找一手来源：${pass.what}。不要二手转述、媒体报道、自媒体文章，也不要文库网站上用户上传的文档。web_queries 全部用${lang.name}写。`;
        const qp = await run.planQueries(claim, q, 'gap', tried, gap);
        const inLang = qp.web_queries.filter(lang.ok);
        const before = found().length;
        const res = await run.webRound(claim, q, 'gap', 'web2', inLang.length ? inLang : qp.web_queries, tried);
        if (!res) {
          lines.push(`  - ${what}：搜索次数用完了，没有查`);
          run.step(sid, 7, title, 'skipped', '没有搜索次数了');
          continue;
        }
        if (st) {
          st.webRounds += 1;
          if (!(res.added.length === 0 && res.pagesRead === 0)) st.newByRound.push(res.added.length);
        }
        const got = found().length - before;
        const line = `「${tried.at(-1) ?? ''}」${inLang.length ? '' : `（模型没有给出${lang.name}查询词，用了它给的）`}→ 读了 ${res.pagesRead} 页，新增 A/B 级一手来源 ${got} 条`;
        lines.push(`  - ${what}：${line}`);
        await run.log('research:first-hand', `${q.id} 找一手来源（${what}）：${line}`, '完整调查预算的追加调查：没有 A/B 级一手来源之前不停');
        run.step(sid, 7, title, 'done', line);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lines.push(`  - ${what}：出错（${msg.slice(0, 80)}）`);
        run.step(sid, 7, title, 'failed', msg);
      }
    }
  }
  if (!lines.length) return [];
  const got = found().length;
  return [`- 追加调查（v${vNext}）找一手来源（完整调查的预算：没有 A/B 级一手来源之前不停；${got ? `找到 ${got} 条` : '查完仍没有找到，这一问判为证据不足，转成要问专家的问题'}）：`, ...lines];
}

// ── the run ─────────────────────────────────────────────────────────────────

export async function executeFollowUp(opts: FollowUpOptions): Promise<FollowUpResult> {
  const t0 = Date.now();
  const { ctx } = opts;
  const emit: Emit = opts.emit ?? (() => {});
  const plan = ctx.research?.plan ?? null;
  if (ctx.phase !== 'research_execute' || !ctx.research || !plan || !ctx.research.planPath || !isPlanApproved(plan)) {
    throw new ToolNotAllowedError('research.followup', ctx.phase, 'research plan is not approved');
  }
  const planPath = ctx.research.planPath;
  const researchDir = ctx.research.dir;
  const claimIndex = plan.claims.findIndex((c) => c.id === opts.claimId);
  if (claimIndex < 0) throw new FollowUpDenied(`计划里没有论点 ${opts.claimId}`);
  const claim = plan.claims[claimIndex];
  const label = hypothesisLabel(plan, claim.id);
  const sub = claim.sub_questions.find((q) => q.id === opts.subQuestionId);
  if (!sub) throw new FollowUpDenied(`论点 ${claim.id} 下面没有子问题 ${opts.subQuestionId}`);

  const baseV = await latestVersion(ctx.vault, researchDir, '报告');
  if (!baseV) throw new FollowUpDenied('还没有报告，先完成一次调查');
  const base = await ctx.vault.read(baseV.path);
  if (base.data.type !== 'report') throw new FollowUpDenied(`${baseV.path} 不是报告`);
  if (base.data.delivery !== '已交付') throw new FollowUpDenied(`最新的 报告 v${baseV.n} 没有交付（自检没通过的草稿），不能在它上面追加调查；先重新调查`);
  const vPrev = baseV.n;
  const vNext = vPrev + 1;
  const reportName = `报告 v${vNext}`;

  const mode: ResearchMode = opts.budget ?? 'small';
  const inner = opts.webClient ?? (await ctx.webTools());
  const client = startRunClient(researchDir, inner, mode);
  try {
    const { model, judgmentModel, modelInfo, judgmentInfo } = await resolveRunModels(ctx.vault, { model: opts.model, modelInfo: opts.modelInfo });
    const rc = await loadResearchContext(ctx, { sources: false });
    const run = new ResearchRun({ ctx, mode, model, judgmentModel, client, emit, signal: opts.signal, contextText: renderContext(rc), evalTimeoutMs: opts.evalTimeoutMs });

    // The evidence vN stood on, restored from its record (exactly), and marked as judged so it is not judged twice.
    const record = await loadEvidenceRecord(ctx.vault, baseV.path, base.data);
    let mine = record.filter((r) => r.claim === claim.id);
    let restoredFromText = false;
    if (mine.length === 0) {
      mine = evidenceRecordFromSection(base.body.split('\n'), label, claim);
      restoredFromText = mine.length > 0;
      if (restoredFromText) await run.log('research:followup', `报告 v${vPrev} 没有证据记录：按 ${label} 小节里引用的块还原了 ${mine.length} 条证据`, '支持 / 反证按它们所在的小节判定；是否“直接推翻核心前提”看不出来，按否处理');
    }
    const seed = await restoreEvidence(ctx.vault, mine, baseV.path);
    run.evidence.push(...seed);
    for (const e of seed) {
      for (const q of claim.sub_questions) run.evaluated.add(`${q.id}|${e.ref}`);
      run.evaluated.add(`${claim.id}:counter|${e.ref}`);
    }
    const seedRefs = new Set(seed.map((e) => e.ref));
    // Q-F: vN's carried-over text must pass the number rule too: re-cite (or reword) its clauses before composing
    const carried = await fixCarriedNumbers(
      {
        vault: ctx.vault,
        log: (a, c, why) => run.log(a, c, why),
        fromPath: baseV.path,
        vPrev,
        reword: modelReword(run),
      },
      base.body,
    );
    const baseBody = carried.body;
    // D-39: a question-tree report on a question-tree plan is followed up in its own format
    const planTree = questionTreeOf(plan);
    const treeLeaf = planTree.format === 'question_tree' && /^## Q\d+ /m.test(baseBody) ? planTree.byClaim.get(claim.id) : undefined;
    const treeRoot = treeLeaf && planTree.format === 'question_tree' ? planTree.roots.find((r) => r.qid === (treeLeaf.parent ?? treeLeaf.qid)) : undefined;
    const treeInfo = treeLeaf && treeRoot ? { leaf: treeLeaf, root: treeRoot } : undefined;
    // what vN's text still cites that a person has since found wrong (reliability: disproven), and its revised hypothesis
    const disproven = await disprovenCitations(ctx.vault, base.body, baseV.path);
    const disprovenIds = new Set(disproven.flatMap((d) => d.footnotes));
    const baseRevised = revisedIn(base.body, label);
    // an older report may still say 需要修正 (CONTRACT-CHANGE-M3-1 B)
    const verdictsBefore = Object.fromEntries(Object.entries((base.data.verdicts_proposed ?? {}) as Record<string, string>).map(([k, v]) => [k, normalizeVerdict(v) as string]));
    const from = (VERDICTS as readonly string[]).includes(verdictsBefore[claim.id]) ? (verdictsBefore[claim.id] as Verdict) : null;

    // 1 拆问题
    const subs = [sub];
    run.step('s1', 1, `拆问题：追加调查 ${label}（${claim.id}）· 新增子问题 ${sub.id}`, 'done', `${sub.question}；在 报告 v${vPrev} 的基础上，${mode === 'full' ? '完整调查' : '试水调查'}预算`);
    await run.log('research:followup', `追加调查 ${label}（${claim.id}）新增子问题 ${sub.id}「${sub.question}」：在 报告 v${vPrev} 上生成 ${reportName}`, `${mode === 'full' ? '完整调查' : '试水调查'}预算（搜 ${RESEARCH_LIMITS[mode].maxSearches} 次、抓 ${RESEARCH_LIMITS[mode].maxFetches} 次）· 先查知识库（含专家输入）· 模型：${modelInfo.label}（${modelInfo.model}）${judgmentInfo ? ` · 判断用：${judgmentInfo.label}（${judgmentInfo.model}）` : ''}`);
    run.reserve = { searches: 1, fetches: 1 };

    // 2 3 → 6 → 7 : the same steps as a full run, for this claim only
    firstRoundReserve(run, subs);
    await Promise.all(subs.map((q) => phaseA(run, claim, q)));
    await counterRound(run, claim, subs[0]);
    const primaryPasses: string[] = [];
    if (mode === 'full') for (const q of subs) primaryPasses.push(...(await firstHandPasses(run, claim, q, seedRefs, vNext)));
    for (const q of subs) await fillGaps(run, claim, q);
    for (const q of subs) {
      if (!run.extractSteps.get(q.id)) run.step(`s4:${q.id}`, 4, `提取 · ${run.subName(q)}`, 'skipped', '没有联网抓新页面，不需要提取');
    }

    // 8 判断
    run.step('s8', 8, `判断：按判断标准重新判断 ${label}（系统复核）`, 'running');
    const counter: KeyCounter = { n: 0 };
    let result = await judgeClaim(run, claim, label, counter);
    run.step('s8', 8, `判断：按判断标准重新判断 ${label}（系统复核）`, 'done', `${label} → ${result.verdict}${result.adjusted ? '（系统调整）' : ''}`);
    await run.log('research:verdict', `${claim.id} 追加调查后的提议判断：${result.verdict}（之前：${from ?? '无记录'}）${result.adjusted ? `；模型提议 ${result.judgment.verdict}，${result.adjustNote}` : ''}`, `§9.5 · 证据 ${result.evidence.length} 条（新增 ${result.evidence.filter((e) => !seedRefs.has(e.ref)).length}）`);

    // 9 write v(N+1) + self-check
    run.step('s9', 9, '写报告并自检引用', 'running');
    const originItems = await collectOrigins(ctx.vault, planPath, plan);
    const origins = renderOriginLines(originItems);
    const directives = directiveRefs(originItems);
    const issuedKeys = new Set(result.keyed.keys());
    const dropped = new Set<string>();
    let recOut: Pick<FollowUpText, 'recommendation' | 'recommendationFailed' | 'recParts'> = {};
    const textFor = (r: ClaimResult): ComposeInput => ({
      vNext,
      vPrev,
      label,
      statement: claim.statement,
      subQuestionId: sub.id,
      question: sub.question,
      from,
      result: r,
      newEvidence: r.evidence.filter((e) => !seedRefs.has(e.ref)),
      searches: client.usage().searches,
      fetches: client.usage().fetches,
      kbCount: run.kbSources.size,
      webCount: run.webSources.size,
      expertCount: run.expertSources.size,
      origins,
      skipped: [...run.stats.skipped, ...[...dropped].map(() => '模型引用了证据列表里没有的编号，系统已去掉这条引用')].slice(0, 6),
      baseBody,
      runLine: '',
      restoredFromText,
      notes: footnotesFor(baseBody),
      budget: mode,
      noPrimarySource,
      recDirectives: directives,
      disprovenFootnotes: disprovenIds,
      baseRevised,
      primaryPasses,
      carriedFixes: carried.fixes,
      ...(treeInfo ? { tree: treeInfo } : {}),
      ...recOut,
    });
    // No first-hand source for the new sub-question (D-28): its answer is "证据不足", and the question really goes on the
    // expert list, instead of a conclusion squeezed out of nothing.
    // On the full budget, first-hand means A/B (D-21 (b): C-grade reposts and an interview do not answer "find the original").
    const noPrimarySource = mode === 'full' ? !result.evidence.some(isFirstHand(seedRefs, run.fetchedSources)) : !result.evidence.some((e) => !seedRefs.has(e.ref) && !(e.sourceKind === 'expert' && e.simulated));
    const withExpertQuestion = (r: ClaimResult): ClaimResult => {
      if (!noPrimarySource || r.judgment.expert_questions.some((q) => q.includes(sub.question))) return r;
      return { ...r, judgment: { ...r.judgment, expert_questions: [...r.judgment.expert_questions, `「${sub.question}」——这次追加调查没有找到一手来源，需要问专家`] } };
    };
    result = withExpertQuestion(result);
    // a block link the model wrote without its quote: code writes the block's original into a footnote (see bare-links.ts)
    const quoteBare = async (b: string) => (await citeBareBlockLinks({ vault: ctx.vault, log: (x, c, why) => run.log(x, c, why), fromPath: baseV.path }, b)).body;
    let body = await quoteBare(composeFollowUpBody(textFor(result)));
    // what this version writes: the follow-up's block (an older report), or the hypothesis' new section (a question tree)
    const newLinesOf = (r: ClaimResult) => {
      if (!treeInfo) return [...renderClaimAddition(textFor(r))];
      const t = textFor(r);
      const ex = (s: string) => oneLine(expandCitations(s, r.keyed, t.notes).text);
      const card = renderClaimSection(r, t.notes, { depth: treeInfo.leaf.parent ? 4 : 3, qid: treeInfo.leaf.qid }).md.split('\n');
      return treeInfo.leaf.parent ? withLeafAnswer(card, treeInfo.leaf.qid, () => leafAnswer(r, ex)) : card;
    };
    let failures: CheckFailure[] = [...(await followUpSelfCheck(run, body, newLinesOf(result), issuedKeys, { results: [result], baseBody })), ...challengeFailures([result]), ...revisionFailures([result])];
    const dummy: SummaryDraft = { so_what: '-', results: ['-'], answers: [], sufficiency: '', workplan_impact: [] };
    const maxRepair = opts.repairRounds ?? MAX_REPORT_REPAIR_ROUNDS;
    for (let round = 1; failures.some(needsRepair) && round <= maxRepair; round++) {
      // vN passed the same checks, so a failure here is in the part written now; only that part can be repaired
      const block = newLinesOf(result).join('\n');
      const mine = failures.filter((f) => needsRepair(f) && (f.claimId === claim.id || (f.excerpt && block.includes(f.excerpt))));
      if (mine.length === 0) break;
      run.step('s9', 9, `写报告并自检引用（第 ${round} 次修复）`, 'running', describeFailures(mine).slice(0, 3).join('；'));
      const sections = new Map([[claim.id, block]]);
      const fixed = await repair(run, [result], dummy, mine, sections);
      result = withExpertQuestion(fixed.results[0]);
      body = await quoteBare(composeFollowUpBody(textFor(result)));
      failures = [...(await followUpSelfCheck(run, body, newLinesOf(result), issuedKeys, { results: [result], baseBody })), ...challengeFailures([result]), ...revisionFailures([result])];
    }
    // AI 的推荐判断, rewritten on all of v(N+1)'s judgments: a new finding under any claim may move it (D-21 step 4).
    // Same call and checks as a first run; if it cannot be done, vN's stays in Summary and the report is a draft.
    run.step('s9', 9, '重写推荐判断（按这一版的全部论点判断）', 'running');
    const recClaims: RecommendClaim[] = plan.claims.map((c) =>
      c.id === claim.id
        ? recommendClaimOf(result)
        : { label: hypothesisLabel(plan, c.id), statement: c.statement, verdict: verdictsBefore[c.id] ?? '证据不足', revised: null, reasoning: `沿用 v${vPrev} 的判断（这次追加调查没有重判这个论点）`, soWhat: [], keyEvidence: [] },
    );
    // what a change may stand on: the evidence this follow-up added (not a simulated interview), or the verdict that moved
    const newKeyed = [...result.keyed].filter(([, e]) => !seedRefs.has(e.ref) && !(e.sourceKind === 'expert' && e.simulated));
    const moved = judgmentChanged({ from, result, baseRevised });
    const baseLines = baseBody.split('\n');
    const baseRange = recommendationRange(baseLines);
    const baseBlock = baseRange ? baseLines.slice(baseRange.start, baseRange.end + 1) : [];
    // vN's rows by part, and the parts that stood on a disproven source (they must be rewritten)
    const prevParts = new Set(recommendationRows(baseBlock).map((r) => partOfRow(r.label)));
    const forced = partsCiting(baseBlock, disprovenIds);
    const sourcesOf = (ids: string[]): DisprovenCitation[] => disproven.filter((d) => d.footnotes.some((f) => ids.includes(f)));
    const recInput = {
      plan,
      claims: recClaims,
      soWhat: /^- (?:一句话答案|So what|回答（一句话）)：(.*)$/m.exec(baseBody)?.[1] ?? '',
      workplanImpact: [],
      exploratory: ctx.exploratory,
      previous: recommendationText(baseBody),
      newEvidence: newKeyed.map(([key, e]) => ({ key, quote: e.quote.slice(0, 160), grade: e.grade })),
      directives,
      judgmentChange: `${label}「${claim.statement}」：${from ?? '（无记录）'} → ${result.verdict}${moved.verdict ? '（变了）' : '（没变）'}${result.revisedStatement ? `；修正后的论点：${result.revisedStatement}${moved.revised ? `（变了；上一版是：${baseRevised ?? '没有修正'}）` : '（和上一版一样）'}` : ''}`,
      // a question tree: the sub-question's answer follows this version's judgment whether or not it moved
      summaryFor: moved.any || treeInfo ? label : undefined,
      ...(treeInfo ? { treeAnswer: { qid: treeInfo.root.qid, question: treeInfo.root.question } } : {}),
      disproven: [...forced].map(([part, ids]) => ({ part: REC_PART_LABEL[part], sources: sourcesOf(ids).map((d) => ({ name: d.name, note: d.note })) })),
    };
    let rec = await recommendFor(run, recInput);
    const gapsOf = (r: typeof rec, numbers = true) => [
      ...recommendationGaps(r, result.keyed),
      ...directiveGaps(r, directives),
      ...assertionGaps(r, result.assertions ?? []),
      ...forcedGaps(r, forced),
      ...summaryUpdateGaps(r, { label, changed: moved.any || Boolean(treeInfo), keyed: result.keyed, issuedKeys, body: baseBody, numbers, tree: Boolean(treeInfo) }),
    ];
    // Q-F: a number in the rewritten table (or the new Summary 理由) that is not in its evidence goes back to this
    // call, like any other gap (otherwise the report could only stay a draft)
    const recNumberGaps = async (r: typeof rec): Promise<string[]> => {
      if (!r) return [];
      const used = new Set<string>();
      const ex = (t: string) => t.replace(/\[([^\]]*E\d+[^\]]*)\]/g, (m, g: string) => {
        const ks = [...g.matchAll(/E(\d+)/g)].map((k) => k[1]);
        ks.forEach((k) => used.add(k));
        return ks.length ? ks.map((k) => `[^${k}]`).join('') : m;
      });
      const su = r.summary_update;
      const lines = ['## Summary', ...(su?.reason.trim() ? [`- 理由：${ex(su.reason)}`] : []), ...(su?.so_what.trim() ? [`- 一句话答案：${ex(su.so_what)}`] : []), ...renderRecommendation(r, ex)];
      const defs = [...used].flatMap((n) => {
        const e = result.keyed.get(`E${n}`);
        return e ? [`[^${n}]: “${e.quote}”（证据）${e.ref}`] : [];
      });
      const fails = await numberFailures({ vault: ctx.vault, log: (a, c, why) => run.log(a, c, why), results: [result], issuedKeys }, [...lines, '', '## 引文出处', ...defs].join('\n'));
      return fails.map((f) => (/^推荐判断里/.test(f.message) ? f.message : `summary_update：${f.message}`).replace(/\[\^(\d+)\]/g, '[E$1]'));
    };
    let recGaps = [...gapsOf(rec), ...(await recNumberGaps(rec))];
    for (let round = 1; recGaps.length > 0 && round <= maxRepair; round++) {
      const again = await recommendFor(run, { ...recInput, failures: recGaps });
      if (again) rec = again;
      recGaps = [...gapsOf(rec), ...(await recNumberGaps(rec))];
    }
    // D-21-4 (f): a number the rewrite still gets wrong does not throw the rewrite away; the whole-report check below
    // settles it (re-cite / reword) or flags it
    recGaps = gapsOf(rec, false);
    for (const g of recGaps.filter(isSoftGap)) await run.log(softGapAction(g), g, '修复轮没有改掉：只记下来，不阻止交付');
    recGaps = recGaps.filter((g) => !isSoftGap(g));
    const suNumbers = recGaps.length === 0 ? summaryUpdateNumberFlags(rec, { label, changed: moved.any || Boolean(treeInfo), keyed: result.keyed, issuedKeys, body: baseBody }) : [];
    // a part may change only on this follow-up's new evidence or on the judgment that changed; otherwise vN's text stays
    const newKeys = new Set(newKeyed.map(([k]) => k));
    const grounded = (why: string) => [...why.matchAll(/E\d+/g)].some((m) => newKeys.has(m[0])) || (moved.any && why.includes(label));
    const recParts: Partial<Record<RecPart, PartDecision>> = {};
    const reverted = (part: RecPart, why: string) =>
      run.log('research:recommend-reverted', `推荐判断的“${REC_PART_LABEL[part]}”标了改动，但理由没有指向这次的新证据或变了的判断：退回 v${vPrev} 的原文`, why.slice(0, 200) || '（没有写理由）');
    for (const part of REC_FIELD_ORDER) {
      const c = rec?.changes?.[part];
      // a part vN did not have is new whatever was marked: nothing to go back to (v4 logged a revert to a v3 row that never existed)
      if (!c?.changed || !prevParts.has(part)) continue;
      // a part that stood on a disproven source is replaced in any case (mergeRecommendation); its why is said once
      const why = c.why.replace(DISPROVEN_OPENING, '');
      if (part === 'alternatives' && rec) {
        // row by row: a row changes when it is not marked unchanged and its own text or why stands on new evidence or the changed judgment
        const rows = sortedAlternatives(rec).map((a) => ({ changed: a.changed !== false && grounded(`${a.why_changed ?? ''} ${a.why_not}`), why: (a.why_changed?.trim() || c.why).replace(DISPROVEN_OPENING, '') }));
        if (rows.some((r) => r.changed)) recParts[part] = { changed: true, why, rows };
        else if (!forced.has(part)) await reverted(part, c.why);
        continue;
      }
      if (forced.has(part)) recParts[part] = { changed: true, why };
      else if (grounded(c.why)) recParts[part] = { changed: true, why: c.why };
      else await reverted(part, c.why);
    }
    recOut = recGaps.length === 0 && rec ? { recommendation: rec, recParts } : { recommendationFailed: `推荐判断没有通过检查：${recGaps.join('；')}` };
    body = await quoteBare(composeFollowUpBody(textFor(result)));
    failures = [...(await followUpSelfCheck(run, body, newLinesOf(result), issuedKeys, { results: [result], baseBody })), ...challengeFailures([result]), ...revisionFailures([result])];
    if (recOut.recommendationFailed) failures.push({ code: 'incomplete_recommendation', message: recOut.recommendationFailed });
    failures.push(...suNumbers);
    // Q-F: a number the repair rounds left gets the same last pass as a first run (re-cite, else reword)
    if (failures.some((f) => f.code === 'number_not_in_quote')) {
      const settled = await fixCarriedNumbers({ vault: ctx.vault, log: (a, c, why) => run.log(a, c, why), fromPath: baseV.path, vPrev, what: `v${vNext} 的正文`, reword: modelReword(run) }, body);
      if (settled.fixes.length) {
        body = settled.body;
        failures = [...(await followUpSelfCheck(run, body, newLinesOf(result), issuedKeys, { results: [result], baseBody })), ...challengeFailures([result]), ...revisionFailures([result])];
        if (recOut.recommendationFailed) failures.push({ code: 'incomplete_recommendation', message: recOut.recommendationFailed });
        failures.push(...suNumbers);
      }
    }
    await run.log('research:followup', recOut.recommendation ? `按 v${vNext} 的全部论点判断重写了推荐判断` : `推荐判断没有重写：${recOut.recommendationFailed}`, '追加调查的新结论可能改变推荐判断');

    // D-21-4 (f): the number checks flag after the repair, they do not block (see execute.ts)
    const numberFlags = numberFlagsOf(failures);
    // so does inference_cited, the other heuristic (inference words before a footnote); the citation checks still block
    const inferenceFlags = inferenceFlagsOf(failures);
    const keyFlags = keyFlagsOf(failures);
    failures = failures.filter((f) => !isFlagCheck(f));
    for (const f of numberFlags) await run.log('research:number-flagged', describeFlag(f), '修复轮没有修掉：照实标出来（页面的“数字核对”框里列出），不阻止交付');
    for (const f of inferenceFlags) await run.log('research:inference-flagged', describeInferenceFlag(f), '修复轮没有修掉：照实标出来（页面在那一句的脚注旁标“⚠ 推论挂了脚注”），不阻止交付');
    for (const f of keyFlags) await run.log('research:key-flagged', describeKeyFlag(f), '判断不了是证据编号还是名字：照实记下来（frontmatter key_flags），不阻止交付');
    // the 用词对照表 (D-39), in what this version writes: logged, not blocking
    if (treeInfo) for (const h of oldWordingHits(newLinesOf(result).join('\n'))) await run.log('research:old-wording', `正文里有旧词「${h.word}」${h.count} 处，例：「${h.example}」`, '用词对照表换掉了这个词：只记下来，不阻止交付');
    const delivered = failures.length === 0;
    const failedChecks = describeFailures(failures);
    const finalBody = delivered ? body : `> ⚠ 自检没有通过，这份报告**没有交付**，状态停在草稿；${`报告 v${vPrev}`} 仍是最新的已交付版本。没通过的项：\n${failedChecks.map((f) => `> - ${f}`).join('\n')}\n\n${body}`;

    const verdictsProposed = { ...verdictsBefore, [claim.id]: result.verdict };
    // vN's source warnings and human edits, still true of what v(N+1) keeps; plus a warning for every disproven source it cites
    const sourceWarnings = mergeSourceWarnings(readSourceWarnings(base.data), await disprovenCitations(ctx.vault, finalBody, baseV.path), finalBody, { today: ctx.now().toISOString().slice(0, 10), vNext });
    const humanEdits = carryHumanEdits(base.data.human_edits, finalBody, { from: linkTo(baseV.path), vNext });
    const written = await run.tool<{ path: string }>(
      'write_draft',
      {
        note_type: 'report',
        name: reportName,
        // a new version of the same document carries the status the document had (v2 may have been polished by hand as 推断)
        status: AI_WRITABLE_STATUSES.includes(base.data.status as never) ? (base.data.status as string) : '进行中',
        frontmatter: {
          id: `report-${Date.now().toString(36)}-v${vNext}`,
          version: vNext,
          research_plan: linkTo(planPath), // the plan that now contains the new sub-question
          mode: 'team',
          derived_from: [linkTo(planPath), linkTo(baseV.path)],
          relates_to: (base.data.relates_to as string[] | undefined) ?? [linkTo(`${ctx.workspacePath}/workspace`)],
          delivery: delivered ? '已交付' : '草稿',
          failed_checks: failedChecks,
          ...(numberFlags.length ? { number_flags: numberFlags } : {}),
          ...(inferenceFlags.length ? { inference_flags: inferenceFlags } : {}),
          ...(keyFlags.length ? { key_flags: keyFlags } : {}),
          run_mode: mode,
          verdicts_proposed: verdictsProposed,
          follow_up: { claim: claim.id, label, sub_question: sub.id, question: sub.question, base: linkTo(baseV.path), from: from ?? null, to: result.verdict, budget: mode },
          ...(sourceWarnings.length ? { source_warnings: sourceWarnings } : {}),
          ...(humanEdits.length ? { human_edits: humanEdits } : {}),
        },
        body: finalBody,
      },
      delivered ? `追加调查完成，引用自检通过：交付 ${reportName}（保留 报告 v${vPrev} 的全部内容）` : '自检没有通过：存为草稿，不交付',
    );

    let finalDelivered = delivered;
    let finalFailed = failedChecks;
    if (delivered) {
      const post = await run.tool<{ ok: boolean; failed: { link: string }[] }>('check_citations', { path: written.path }, '交出报告之前，对写好的文件再自检一次');
      if (!post.ok) {
        finalDelivered = false;
        finalFailed = post.failed.map((f) => `写入后的文件自检失败：${f.link}`);
      }
    }
    // the evidence record: this claim's (old + new), everything else as vN had it
    const keepOthers = record.filter((r) => r.claim !== claim.id);
    const researchRun: ResearchRunFacts = {
      mode,
      searches: client.usage().searches,
      fetches: client.usage().fetches,
      retries: client.usage().retries,
      durationMs: Date.now() - t0,
      model: modelInfo.model,
      modelLabel: modelInfo.label,
      providerId: modelInfo.providerId,
      ...(judgmentInfo ? { judgmentModel: judgmentInfo.model, judgmentModelLabel: judgmentInfo.label } : {}),
      kbSources: run.kbSources.size,
      webSources: run.webSources.size,
      droppedQuotes: run.stats.droppedQuotes,
    };
    // D-48 round 4 (C): names and numbers its source does not have, marked (never a reason to hold delivery)
    const entityFlags = await entityFlagsOf(ctx.vault, finalBody, written.path);
    for (const f of entityFlags) await run.log('research:entity-flagged', `${f.footnote}：「${f.sentence.slice(0, 60)}」的原文里没有出现 ${f.missing.join('、')}`, '只标不改（frontmatter entity_flags），不阻止交付');
    await patchReport(ctx, written.path, {
      delivery: finalDelivered ? '已交付' : '草稿',
      failed_checks: finalFailed,
      research_run: { ...researchRun, followUp: true },
      ...(entityFlags.length ? { entity_flags: entityFlags } : {}),
      ...(await writeEvidenceSidecar(ctx.vault, written.path, [...keepOthers, ...serializeEvidence(run.evidence)])),
    });

    let verdicts: Awaited<ReturnType<typeof writeProposedVerdicts>> = [];
    if (finalDelivered) {
      verdicts = await writeProposedVerdicts({
        vault: ctx.vault,
        logPath: ctx.logPath,
        reportName,
        now: ctx.now(),
        proposals: [{ claimId: claim.id, hypothesisPath: result.hypothesisPath, verdict: result.verdict }],
      });
    }
    run.step('s9', 9, '写报告并自检引用', finalDelivered ? 'done' : 'failed', finalDelivered ? `${reportName} 已交付；${label}：${from ?? '无记录'} → ${result.verdict}` : `未交付：${finalFailed.join('；')}`);
    await run.log('research:done', `${reportName} ${finalDelivered ? '已交付' : '草稿（未交付）'}（追加调查 ${label}：${from ?? '无记录'} → ${result.verdict}）`, `搜索 ${client.usage().searches} 次、抓取 ${client.usage().fetches} 次，用时 ${Math.round((Date.now() - t0) / 1000)} 秒 · 模型：${modelInfo.label}（${modelInfo.model}）`);

    const newEvidence = result.evidence.filter((e) => !seedRefs.has(e.ref));
    return {
      reportPath: written.path,
      reportName,
      delivered: finalDelivered,
      failedChecks: finalFailed,
      verdicts,
      claims: [{ id: claim.id, verdict: result.verdict, adjusted: result.adjusted, evidence: result.evidence.length }],
      usage: client.usage(),
      counts: { kbSources: run.kbSources.size, webSources: run.webSources.size, droppedQuotes: run.stats.droppedQuotes },
      durationMs: Date.now() - t0,
      model: modelInfo,
      timing: run.timing(),
      followUp: { claimId: claim.id, label, from, to: result.verdict, changed: from !== result.verdict, newEvidence: newEvidence.length, subQuestionId: sub.id, question: sub.question, baseReport: baseV.path },
    };
  } finally {
    clearRunClient(researchDir);
  }
}

// ── the new sub-question joins the plan (a human click) ─────────────────────

export interface AddedSubQuestion {
  planPath: string;
  subQuestionId: string;
  /** false when the claim already had a sub-question with the same wording (nothing was written). */
  created: boolean;
}

/**
 * The owner adds a sub-question under an existing claim. It has to be in the APPROVED plan before anything may
 * search for it, so it becomes plan v(M+1), written as the owner (a human edit) and approved with the owner's
 * research_plan.approve event: the same two writes the plan editor makes, and both are logged.
 */
export async function addFollowUpSubQuestion(opts: {
  vault: Vault;
  workspacePath: string;
  researchDir: string;
  role: Role;
  claimId: string;
  question: string;
}): Promise<AddedSubQuestion> {
  const question = opts.question.replace(/\s+/g, ' ').trim();
  if (question.length < 6) throw new FollowUpDenied('子问题至少写几个字，说清楚要查什么');
  if (question.length > 200) throw new FollowUpDenied('子问题太长了（最多 200 字）');
  const latest = await latestVersion(opts.vault, opts.researchDir, '计划');
  if (!latest) throw new FollowUpDenied('还没有调查计划');
  const note = (await opts.vault.readTyped(latest.path, 'research_plan')).note;
  if (!isPlanApproved(note)) throw new FollowUpDenied('最新的调查计划还没有批准，先批准再追加调查');
  const claim = note.claims.find((c) => c.id === opts.claimId);
  if (!claim) throw new FollowUpDenied(`计划里没有论点 ${opts.claimId}`);
  const same = claim.sub_questions.find((q) => q.question.replace(/\s+/g, ' ').trim() === question);
  if (same) return { planPath: latest.path, subQuestionId: same.id, created: false };

  const editable = toEditable(note);
  const withNew = addSubQuestion(editable, claim.id, question);
  const added = withNew.claims.find((c) => c.id === claim.id)!.sub_questions.at(-1)!;
  const plan = updateSubQuestion(withNew, added.id, { methods: ['知识库', '网络'] });
  const saved = await savePlanVersion({ vault: opts.vault, workspacePath: opts.workspacePath, researchDir: opts.researchDir, role: opts.role, plan }); // throws PlanSaveDenied unless the owner
  await applyApprovalEvent(
    opts.vault,
    { type: 'research_plan.approve', actor: opts.role, workspace: `${opts.workspacePath}/workspace.md`, plan: saved.path },
    { logPath: `${opts.workspacePath}/日志.md`, reason: `负责人在报告上追加调查，新增子问题 ${added.id}，计划随之更新并批准` },
  );
  return { planPath: saved.path, subQuestionId: added.id, created: true };
}

export { PlanSaveDenied };
