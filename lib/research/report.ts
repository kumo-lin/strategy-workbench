/**
 * Report assembly (PRD §8). The skeleton, the verdict lines, the "怎么查的" facts and
 * every citation are produced by CODE; the model supplies sentences that point at
 * evidence by key ([E3]). Citations are expanded from the evidence record, so a quote
 * can only be a quote of the block it links to. The self-check still verifies them.
 */
import { gradeLabel, isExpert, keyQuestionVerdict, originLabel, type Evidence } from './evidence';
import type { CheckedAssertion, CheckedCondition, ClaimResult } from './judge';
import { expandDirectiveKeys, type DirectiveRef } from './directives';
import { displayExcerpt } from './quote-span';
import { isEditionName, numberInQuote, numbersIn, numbersInQuote } from './number-check';
import { responseKeys, type BasisKind, type Recommendation, type ReportGap, type ReportReason, type ReportRecommendation, type SummaryDraft } from './schemas';
import { recommendationProblems } from './recommendation-refs';
import type { Verdict } from '@/lib/notes/schema';
import { IMPACT_HEADING } from './report-headings';
import { hypothesisLabel, questionTreeOf, subQuestionLabel, type TreePlan, type TreeRoot } from './question-tree';
import { interviewAsks, renderInterviewCard, unverifiedAsk, type InterviewClaim } from './interview-card';

/** `“原文片段”（B 级，网络 · AI 定级）[[资料名#^c1]]` */
export function citationOf(e: Evidence): string {
  const quote = e.quote
    .replace(/[“”"]/g, '')
    .replace(/\[\[|\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // cut by meaning, never mid-number: the clause with the number (else the longest) and its neighbours
  const cut = displayExcerpt(quote);
  return `“${cut}”（${gradeLabel(e)}，${originLabel(e)}）${e.ref}`;
}

/** A bracket group that names evidence: `[E3]`, `[E3, E4]`, `[E58–E60]`, `[E1、E59 等]`. */
const KEY_GROUP = /[\[【]\s*(E\d+[^\]】\n]*)[\]】]/g;
const KEY_TOKEN = /E(\d+)(?:\s*[–—~\-～]\s*E?(\d+))?/g;
/** A key written without brackets, outside quotes and links: "E2 表明…". */
const BARE_KEY = /(?<![A-Za-z0-9“"「\[#^])E(\d{1,3})(?:\s*[–—~\-～]\s*E?(\d{1,3}))?(?![A-Za-z0-9])/g;

export interface Expanded {
  text: string;
  /** Keys the model cited that are not in the evidence list: their citation is removed (and logged by the caller). */
  unknown: string[];
  /** Keys cited at least once. */
  used: string[];
}

/** Keys named inside one bracket group, ranges expanded (E58–E60 → E58, E59, E60). */
function keysIn(group: string): string[] {
  const keys: string[] = [];
  for (const m of group.matchAll(KEY_TOKEN)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (to >= from && to - from <= 20) for (let n = from; n <= to; n++) keys.push(`E${n}`);
    else keys.push(`E${from}`, `E${to}`);
  }
  return keys;
}

/**
 * Replace evidence keys with verified citations. Never leaves a key behind: known keys become
 * `“原文”（等级，来源）[[资料#^cN]]`, unknown ones are removed (reported in `unknown`). One field =
 * one sentence or bullet: the same evidence is cited once in it, however often the model wrote it.
 */
/** Wording from the step prompts ("本步下发的材料", "证据清单"): a reader of the report never sees how the model was briefed. */
const INTERNAL_WORDING = /下发的|证据清单|提示词|系统提示|我给你的|给我的(材料|证据)|上面(列出|给出)的(材料|证据)|本步(的)?(材料|证据)|(材料|清单)里(没有|为空)/;

/** Drops the clauses (split at ，；：。) that talk about the briefing instead of the topic. */
export function scrubInternalWording(text: string): string {
  if (!INTERNAL_WORDING.test(text)) return text;
  const parts = text.split(/([，,；;：:。])/);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i];
    const delim = parts[i + 1] ?? '';
    if (INTERNAL_WORDING.test(clause)) continue;
    kept.push(clause, delim);
  }
  const out = kept.join('').replace(/^[，,；;：:。\s]+/, '').replace(/[：:，,；;]+$/, '。');
  return out.trim() || '（这一项没有可写的内容）';
}

/**
 * Section numbers, gate codes and frontmatter field names, as a reader would say them (D-20: no internal ids in
 * the report body). Applied to model-written text and to the facts code writes.
 */
const PLAIN_WORDS: [RegExp, string][] = [
  [/[ \t]*(?:PRD\s*)?§\s*9\.5[ \t]*(?:要求的|的)?/g, '判断标准'],
  [/(?:PRD\s*)?§\s*\d+(?:\.\d+)*\s*/g, ''],
  [/G1\s*之前/g, '研究计划批准之前'],
  [/G1\s*之后/g, '研究计划批准之后'],
  [/\bG1\b/g, '研究计划批准'],
  [/\bderived_from\b/g, '来源链接'],
  [/\brelates_to\b/g, '关联'],
  [/\baffects\b/g, '影响'],
];
export function plainWords(text: string): string {
  // [[links]] are left as written: a note name may contain any of these
  return text.split(/(\[\[[^\]]*\]\])/).map((part, i) => (i % 2 ? part : PLAIN_WORDS.reduce((t, [re, to]) => t.replace(re, to), part))).join('');
}

/** The verified citation a footnote holds: `“原文”（等级，来源）[[资料#^cN]]` (check_citations reads it like any other). */
export function footnoteText(e: Evidence): string {
  const quote = e.quote.replace(/[“”"]/g, '').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();
  const note = e.reliability === 'unverified' && e.reliabilityNote ? `：${e.reliabilityNote.replace(/[（）()]/g, ' ').trim()}` : '';
  return `“${displayExcerpt(quote, 300)}”（${gradeLabel(e)}，${originLabel(e)}${note}）${e.ref}`;
}

/** One numbering for the whole report: the same evidence (block) is always the same footnote. */
export class Footnotes {
  private readonly byRef = new Map<string, number>();
  private readonly defs: { n: number; text: string }[] = [];
  private next: number;
  /** `seed`: footnotes already in a report this one extends (follow-up): their numbers are kept, new ones go after. */
  constructor(seed?: { byRef: Map<string, number>; max: number }) {
    for (const [ref, n] of seed?.byRef ?? []) this.byRef.set(ref, n);
    this.next = (seed?.max ?? 0) + 1;
  }
  cite(e: Evidence): string {
    let n = this.byRef.get(e.ref);
    if (n === undefined) {
      n = this.next++;
      this.byRef.set(e.ref, n);
      this.defs.push({ n, text: footnoteText(e) });
    }
    return `[^${n}]`;
  }
  /** A footnote for a block that is not evidence (a directive, a decision): `text` is its definition, `ref` its link. */
  citeRaw(ref: string, text: string): string {
    let n = this.byRef.get(ref);
    if (n === undefined) {
      n = this.next++;
      this.byRef.set(ref, n);
      this.defs.push({ n, text });
    }
    return `[^${n}]`;
  }
  /** Definitions added through this registry (not the seeded ones). */
  lines(): string[] {
    return this.defs.map((d) => `[^${d.n}]: ${d.text}`);
  }
  get size(): number {
    return this.defs.length;
  }
}

export const FOOTNOTE_HEADING = '## 引文出处';
const FOOTNOTE_DEF = /^\[\^(\d+)\]:\s*(.*)$/;
export const FOOTNOTE_REF = /\[\^(\d+)\](?!:)/g;

/** Footnotes already in a report body: block ref → number, and the highest number. */
export function footnotesIn(body: string): { byRef: Map<string, number>; max: number; defs: Map<number, string> } {
  const byRef = new Map<string, number>();
  const defs = new Map<number, string>();
  let max = 0;
  for (const line of body.split('\n')) {
    const m = FOOTNOTE_DEF.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    defs.set(n, m[2]);
    max = Math.max(max, n);
    const ref = /\[\[[^\]]+#\^[A-Za-z0-9-]+\]\]/.exec(m[2])?.[0];
    if (ref && !byRef.has(ref)) byRef.set(ref, n);
  }
  return { byRef, max, defs };
}

/** A section's text with each footnote marker followed by its definition (for readers that look for block citations in a section, e.g. M3). */
export function withFootnotesInline(section: string, body: string): string {
  const { defs } = footnotesIn(body);
  if (defs.size === 0) return section;
  return section.replace(FOOTNOTE_REF, (m, n: string) => (defs.has(Number(n)) ? `${m}（${defs.get(Number(n))}）` : m));
}

export function expandCitations(rawText: string, keyed: Map<string, Evidence>, notes?: Footnotes): Expanded {
  const text = plainWords(scrubInternalWording(rawText));
  const unknown: string[] = [];
  const used = new Set<string>();
  const seen = new Set<string>();
  const cite = (keys: string[]): string => {
    const parts: string[] = [];
    for (const k of keys) {
      const e = keyed.get(k);
      if (!e) {
        unknown.push(k);
        continue;
      }
      used.add(k);
      // inline citations carry the whole quote, so a field cites each block once; a footnote marker is short and
      // repeating it keeps the sentence whole ("[^4] 与 [^2] 同出 IDC")
      if (notes || !seen.has(k)) parts.push(notes ? notes.cite(e) : citationOf(e));
      seen.add(k);
    }
    return parts.join(notes ? '' : ' ');
  };
  const out = text
    .replace(KEY_GROUP, (_m, group: string) => cite(keysIn(group)))
    // bare keys: only the model's own prose (known → citation; 2+ digits and unknown → a made-up key, dropped;
    // E3 / E5 alone may be a product name, e.g. Microsoft 365 E3, and stay)
    .replace(BARE_KEY, (m, n: string, n2: string | undefined, at: number, all: string) => {
      // "E7 Frontier Suite" is a product even when E7 is also this claim's key
      if (isEditionName(all.slice(Math.max(0, at - 20), at), all.slice(at + m.length, at + m.length + 20))) return m;
      const keys = keysIn(m);
      return keys.some((k) => keyed.has(k)) || n.length >= 2 || (n2?.length ?? 0) >= 2 ? cite(keys) : m;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。；、])/g, '$1')
    .replace(/[ \t]+(\[\^\d+\])/g, '$1');
  return { text: out, unknown, used: [...used] };
}

export function hasEvidenceKey(text: string): boolean {
  KEY_GROUP.lastIndex = 0;
  const r = KEY_GROUP.test(text);
  KEY_GROUP.lastIndex = 0;
  return r;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

export interface ReportFacts {
  title: string;
  version: number;
  question: string;
  purpose: string;
  planLink: string;
  workplanLink: string;
  mode: 'small' | 'full';
  exploratory: boolean;
  kbCount: number;
  webCount: number;
  /** Interview notes read (simulated or not): shown on their own line, never counted as sources. */
  expertCount?: number;
  searches: number;
  fetches: number;
  /** Plan scope that the mode left out, e.g. "C1-Q3". */
  notExecuted: string[];
  droppedQuotes: number;
  adjustments: string[];
  /** The "引用对得上吗" check's counts (M3, citation-fit.ts): the appendix line; undefined = not run (no footnotes). */
  citationFit?: CitationFitCounts;
  skipped: string[];
  /** The exec directive / decisions behind [M#] / [W#] in the recommendation (lib/research/directives.ts). */
  directives?: DirectiveRef[];
  /** "这次调查的出发点": lines written by code from the plan's links (lib/research/origin.ts). */
  origins?: string[];
  /** Confirmed decisions found along relates_to that bound this run (M3); undefined = not looked up. */
  decisions?: string[];
  /** One line per claim about the mandatory counter-evidence round. */
  counterLines: string[];
  /** The plan: a question-tree plan (D-39) is written in the question-tree skeleton; an older one as before. */
  plan?: TreePlan;
  /** A version only rewritten from an earlier one's evidence (D-48): "## 本版变化（vN，只改写法）" after Summary. */
  rewrite?: RewriteFacts;
  /** D-56 ⑤b: the 访谈建议 section; set by new runs only, so a frozen report rendered again stays as it was. */
  interviewCard?: boolean;
}

/** What 本版变化 of a rewrite says, besides the verdicts (compared by code with `verdictsBefore`). */
export interface RewriteFacts {
  /** The version whose evidence this one is written on, and its link. */
  from: number;
  /** The version whose run found the evidence (`from`, or before it when `from` is a rewrite too): 怎么查的's counts. */
  countsFrom?: number;
  fromLink: string;
  /** "计划 v3（…）" / "沿用计划 v2": the plan line. */
  plan: string;
  /** That version's verdicts_proposed, claim id → verdict. */
  verdictsBefore: Record<string, string>;
  /** Record entries this vault could not restore (allowed by the owner), one note per entry. */
  missing?: string[];
  /** D-48 第 4 轮 (M3): vN's judgment kept; the hypotheses that could not be read back were judged again. */
  frozen?: { fallback: { claimId: string; label: string; why: string }[]; only?: string[]; rerender?: string };
}

/**
 * 怎么查的's counts; a rewrite's are the run's that found its evidence, said so (D-48 round 2: next to 本版变化 they
 * read as this version's; round 3: a rewrite of a rewrite says the first run's, "（v4 当时；之后都没有重新调查）").
 */
const searchCounts = (facts: ReportFacts) => {
  const w = facts.rewrite;
  const at = w?.countsFrom ?? w?.from;
  return `联网搜索 ${facts.searches} 次、抓取 ${facts.fetches} 次${w ? `（v${at} 当时；${at === w.from ? '本版' : '之后都'}没有重新调查）` : ''}`;
};

/** "## 本版变化（v5，只改写法）": written by code (D-48 格式约定). */
export function rewriteChanges(facts: ReportFacts, claims: ClaimResult[]): string[] {
  const w = facts.rewrite;
  if (!w) return [];
  const moved = claims.filter((c) => w.verdictsBefore[c.claim.id] && w.verdictsBefore[c.claim.id] !== c.verdict).map((c) => `${c.label}：${w.verdictsBefore[c.claim.id]} → ${c.verdict}`);
  return [
    `## 本版变化（v${facts.version}，只改写法）`,
    w.missing?.length
      ? `- 本版只改写法，证据沿用 v${w.from}（${w.fromLink}），有 ${w.missing.length} 条没能恢复（缺 ${[...new Set(w.missing)].join('、')}），没有重新调查。`
      : `- 本版只改写法，证据沿用 v${w.from}（${w.fromLink}），没有重新调查。`,
    `- 计划：${w.plan}`,
    ...(w.frozen
      ? // D-48 第 4 轮 (M3): judged once, kept; only a hypothesis vN could not give back was judged again
        [
          `- ${w.frozen.rerender ? `只重新渲染：${w.frozen.rerender}，判断和文字都没变` : w.frozen.only ? `局部重做：${w.frozen.only.join('、')}；其余原样沿用 v${w.from}；判断都没变` : `判断都没变（沿用 v${w.from} 的逐条判断）`}${w.frozen.fallback
            .map((f) => {
              const c = claims.find((x) => x.claim.id === f.claimId);
              const was = w.verdictsBefore[f.claimId];
              return `；${f.label} 读不回来，重新判断：${was && c ? `${was} → ${c.verdict}` : (c?.verdict ?? '')}（${f.why}）`;
            })
            .join('')}`,
        ]
      : [`- 判断变了的：${moved.length ? moved.join('；') : '各假设的判断都没变'}`, '- 判断每次重跑会有出入（同一个判断模型自己跟自己约 84% 一致），上面如实列出。']),
    '',
  ];
}

export interface CitationFitCounts {
  checked: number;
  replaced: number;
  removed: number;
  flagged: number;
}

/** The appendix line of the "引用对得上吗" check (D-48 round 3). */
export const citationFitLine = (c: CitationFitCounts) => `- 引用核对：查了 ${c.checked} 个，换了 ${c.replaced} 个，删了 ${c.removed} 个，标了 ${c.flagged} 个`;

/**
 * The line put into a report already written (the check runs after rendering and repair): after "- 计划之外的调整："
 * in 附录：过程记录, or in place of the one there; a body without that appendix as it was.
 */
export function withCitationFitLine(body: string, counts: CitationFitCounts): string {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => l.trim() === '## 附录：过程记录');
  if (at < 0) return body;
  let end = lines.findIndex((l, k) => k > at && /^#{1,2} /.test(l));
  if (end < 0) end = lines.length;
  const had = lines.findIndex((l, k) => k > at && k < end && l.startsWith('- 引用核对：'));
  if (had >= 0) lines[had] = citationFitLine(counts);
  else {
    const after = lines.findIndex((l, k) => k > at && k < end && l.startsWith('- 计划之外的调整：'));
    let k = after >= 0 ? after + 1 : end;
    if (after < 0) while (k > at + 1 && !lines[k - 1].trim()) k--;
    lines.splice(k, 0, citationFitLine(counts));
  }
  return lines.join('\n');
}

export interface RenderedReport {
  body: string;
  /** Per claim: the markdown of its section (for repair targeting). */
  sections: Map<string, string>;
  unknownKeys: string[];
  /** Question tree only: top-level sub-questions whose answer the Summary call left out, written by code from the judgments. */
  answerFallbacks?: string[];
  /** D-48 round 4: what code did to the answers' segments (a key its condition does not cite dropped, the old answer used), for the run log. */
  segmentLog?: string[];
  /** Round 5: refutes taken off positive claims (answer segments, what [Qx①] brings in), for research:role-dropped. */
  roleLog?: string[];
}

function bullets(lines: string[], indent = '  '): string[] {
  return lines.length ? lines.map((l) => `${indent}- ${oneLine(l)}`) : [`${indent}- （无）`];
}

/** A table cell: one line, and a `|` never splits it. */
export const cell = (s: string) => oneLine(s).replace(/\|/g, '｜') || '—';

/**
 * Model text that code follows with its own mark ("。怎么估的", "：不选，", "；") loses its end mark first, also one
 * before its trailing footnotes: "跑 2 个季度。" + "。怎么估的" read "。。" (WS-A v4, W5 v2); "…亿美元。[^3]" → "…亿美元[^3]".
 */
const END_MARK = /[\s。！!？?；;，,、：:]+((?:\[\^\d+\])*)\s*$/;
export const trimEndMark = (s: string) => s.replace(END_MARK, '$1');
const QUESTION_END = /[？?](?:\[\^\d+\])*\s*$/;

/** Clauses joined with "；": each loses its own end mark ("。；" in 模型知识); a question keeps its "？", no "；" after it. */
export const joinClauses = (items: string[]): string =>
  items
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i, all) => (QUESTION_END.test(s) ? s : `${trimEndMark(s)}${i < all.length - 1 ? '；' : ''}`))
    .join('');

/** Numbers worth a column of their own: 59%, 82.9%, 11,000, 3 倍, 1.2 亿 (not years, not ids). */
export function keyNumbers(text: string): string {
  const plain = text.replace(FOOTNOTE_REF, ' ').replace(/\[\[[^\]]*\]\]/g, ' ');
  const found = plain.match(/(?<![A-Za-z0-9.])\d[\d,]*(?:\.\d+)?\s*(?:%|％|个百分点|倍|亿|万|家|人|台|美元|元|个月|周|天)?(?![\dA-Za-z])/g) ?? [];
  const keep = found.map((x) => x.trim()).filter((x) => !/^(19|20)\d\d$/.test(x) && !/^\d$/.test(x));
  return [...new Set(keep)].slice(0, 3).join('、') || '—';
}

/**
 * The markers at the END of a line (what goes to the 出处 column), and the line without them. A marker inside the
 * sentence ("与[^5] 同向") stays where it is: taking it out would leave a hole in the sentence.
 */
export function splitMarkers(text: string): { claim: string; markers: string } {
  const m = /((?:\[\^\d+\]\s*)+)([。．.；;]?)\s*$/.exec(text.trim());
  if (!m) return { claim: text.trim(), markers: '' };
  const claim = `${text.trim().slice(0, m.index).trimEnd()}${m[2]}`;
  return { claim, markers: m[1].replace(/\s+/g, '') };
}

const gradeOf = (e: Evidence) => (isExpert(e) ? '专家' : e.grade);

/** "需要修改（改成：…）" (D-39 用词对照表): the revision goes in the verdict's brackets. */
export function verdictWithRevision(verdict: string, revised: string | null, ex: (t: string) => string = oneLine): string {
  return verdict === '需要修改' && revised?.trim() ? `需要修改（改成：${ex(revised).replace(/[。；;]+$/, '')}）` : verdict;
}

/** A judgment written the D-48 way: the plan's conditions one by one, or any of its new fields. */
export const isD48 = (r: ClaimResult): boolean => (r.conditions?.length ?? 0) > 0 || Boolean(r.judgment.changed?.trim() || r.judgment.answer?.trim() || r.judgment.reasons?.length);

/**
 * The verdict as the card and the Summary table write it (D-48): "需要修改（② 不成立、③ 证据不足）", the conditions that
 * are not 成立 in the brackets; a D-48 judgment without conditions says the bare verdict (its 改了什么 line says the
 * rest); an older one "需要修改（改成：…）" as before.
 */
export function verdictWithConditions(r: ClaimResult, ex: (t: string) => string = oneLine): string {
  const open = (r.conditions ?? []).filter((c) => c.status !== '成立');
  if (r.conditions?.length) return r.verdict === '需要修改' && open.length ? `需要修改（${open.map((c) => `${c.label} ${c.status}`).join('、')}）` : r.verdict;
  return isD48(r) ? r.verdict : verdictWithRevision(r.verdict, r.revisedStatement, ex);
}

/** The keys a condition cites that its note does not already write. */
const keysAfter = (c: CheckedCondition) => c.keys.filter((k) => !new RegExp(`\\[${k}\\]`).test(c.note)).map((k) => `[${k}]`).join('');

/** "  - ② <the plan's condition> → 证据不足：（系统复核：…）<note>[E3]": the condition and the status by code, the note by the model. */
export function conditionLine(c: CheckedCondition, ex: (t: string) => string): string {
  const note = [c.adjusted?.trim() ? `（系统复核：${trimEndMark(c.adjusted.trim())}）` : '', ex(`${c.note.trim()}${keysAfter(c)}`)].join('');
  const rest = c.note.trim() || c.adjusted?.trim() ? `：${note}` : note;
  return `  - ${c.label} ${oneLine(c.text)} → ${c.status}${rest}`;
}

/** D-48 round 4 (S1): one part of a card's answer, the condition it stands on, its evidence; the model writes no marks. */
export interface AnswerSegment {
  text: string;
  /** "①" (or "Q2-1①"). */
  cond: string;
  keys: string[];
}

export const answerSegmentsOf = (r: ClaimResult): AnswerSegment[] =>
  ((r.judgment as { answer_segments?: AnswerSegment[] }).answer_segments ?? []).filter((x) => typeof x?.text === 'string' && x.text.trim());

/**
 * What each key is under its hypothesis (D-48 round 5): supports or refutes, by the evidence record; a block that is
 * both under one hypothesis counts as refutes.
 */
export function evidenceRoles(claims: Pick<ClaimResult, 'keyed'>[]): Map<string, 'supports' | 'refutes'> {
  const out = new Map<string, 'supports' | 'refutes'>();
  for (const r of claims) {
    const refuting = new Set([...r.keyed.values()].filter((e) => e.stance === 'refutes').map((e) => e.ref));
    for (const [k, e] of r.keyed) out.set(k, refuting.has(e.ref) ? 'refutes' : 'supports');
  }
  return out;
}

/** A contrast the text says out loud: only there may a refute stand beside a positive claim. */
const CONTRAST_WORD = /但|不过|然而/;
/** What code adds to a part left with no citation (round 5), unless the text says it already. */
const NO_SOURCE = '（还缺证据）';
/** Where a log line goes: `role` → research:role-dropped (round 5), else the segments' log. */
export type RenderLog = (m: string, kind?: 'role') => void;

/** Words that already say a part stands on too little: no "（还缺证据）" after them. */
const HEDGED = /多半|还缺|是否|尚未/;
/** Marks a segment's text must not carry (its keys are its own field): taken out, never shown. */
const SEGMENT_MARKS = /\s*(?:\[\^\d+[!~]*\]|\[E\d+(?:\s*[,，、]\s*E?\d+)*\]|\[Q\d+(?:-\d+)?\s*[①-⑳]\])/g;

/**
 * The answer from its segments, by code (D-48 round 4): each part's keys only those its condition cites (the others
 * dropped, said in `log`); a part on a 证据不足 condition that does not say so gets "（还缺证据）"; its footnotes at
 * its end; parts joined with "；", "。" at the end. Null: the model wrote no segments.
 */
export function segmentAnswer(r: ClaimResult, ex: (t: string) => string, log: RenderLog = () => {}): string | null {
  const segs = answerSegmentsOf(r);
  if (!segs.length) return null;
  const roles = evidenceRoles([r]);
  const parts = segs.map((x) => {
    const label = x.cond.trim().replace(/^Q\d+(?:-\d+)?\s*/, '');
    const c = r.conditions?.find((k) => k.label === label);
    const keys = [...new Set((x.keys ?? []).map((k) => k.trim().toUpperCase()).filter(Boolean))];
    const kept = keys.filter((k) => c?.keys.includes(k));
    const dropped = keys.filter((k) => !kept.includes(k));
    if (dropped.length) log(`${r.label} 回答的一段（${label || '没写条件'}）引用了 ${dropped.map((k) => `[${k}]`).join('')}，不是${c ? `条件 ${label} ` : '任何一条条件'}挂过的编号，去掉了`);
    let text = trimEndMark(x.text.replace(SEGMENT_MARKS, '').trim());
    // round 5: a positive part cites supports only; a refute only on a 不成立 condition, or as a contrast the text says
    const contrast = ((x as { contrast?: boolean }).contrast ?? false) && CONTRAST_WORD.test(text);
    const refutesHere = c?.status === '不成立' || contrast;
    const off = refutesHere ? [] : kept.filter((k) => roles.get(k) === 'refutes');
    // a refute whose original has one of the part's numbers that no other key here has stays: the number keeps its
    // only source (WS-A v9 H3-1 ②, "80% 的 AI 支出发生在 IT 预算之外 [E107]"; the user: 只按这一条)
    const nums = numbersIn(text);
    const has = (k: string) => nums.filter((t) => numberInQuote(t, numbersInQuote(r.keyed.get(k)?.quote ?? '')));
    const offRole = off.filter((k) => !has(k).some((t) => !kept.some((o) => o !== k && !off.includes(o) && has(o).includes(t))));
    if (offRole.length) log(`${r.label} 回答的一段（${label}）把反证 ${offRole.map((k) => `[${k}]`).join('')} 挂在了正面的说法上，去掉了`, 'role');
    const cited = kept.filter((k) => !offRole.includes(k));
    if (c?.status === '证据不足' && !HEDGED.test(text)) text += NO_SOURCE;
    else if (kept.length && !cited.length && !text.endsWith(NO_SOURCE)) text += NO_SOURCE;
    return `${text}${cited.map((k) => ` [${k}]`).join('')}`;
  });
  return `${oneLine(ex(parts.join('；')))}。`;
}

/**
 * The card's answer (D-48): from its segments (round 4), else the model's answer (logged when the judgment checked
 * conditions, the old field kept as a fallback), else code's, from the judgment (leafAnswer).
 */
export function cardAnswer(r: ClaimResult, ex: (t: string) => string, log: RenderLog = () => {}): string {
  const segmented = segmentAnswer(r, ex, log);
  if (segmented) return segmented;
  if (r.judgment.answer?.trim()) {
    if (r.conditions?.length) log(`${r.label} 没有写回答分段（answer_segments），用了旧的 answer`);
    return oneLine(ex(r.judgment.answer));
  }
  return leafAnswer(r, ex);
}

/** `[Q2-1①]`, `[Q1①]`: a condition the model leans on (round 4, S2). */
const CONDITION_REF = /\s*\[(Q\d+(?:-\d+)?)\s*([①-⑳])\]/g;

/**
 * `[Q2-1①]` written out (D-48 round 4, S2): that condition's evidence (its keys, footnotes once expanded) and, when
 * it is 证据不足, "（靠 Q2-1 ①，待验证）". `withKeys` false for a condition whose evidence the text cannot cite (another
 * hypothesis' card): "（靠 Q2-1 ①）" only. An unknown one says its name.
 */
export function expandConditionRefs(
  text: string,
  conds: ReadonlyMap<string, CheckedCondition>,
  withKeys: (qid: string) => boolean = () => true,
  o: { roles?: ReadonlyMap<string, 'supports' | 'refutes'>; log?: RenderLog; asLink?: boolean } = {},
): string {
  return text.replace(CONDITION_REF, (_m, qid: string, label: string) => {
    const c = conds.get(`${qid}${label}`);
    if (!c) return `（${qid} ${label}）`;
    // round 5 A: the recommendation and the one-line answer point at the condition in its card, not its footnotes
    if (o.asLink) return conditionLink(qid, label, c.status);
    // round 5: what leans on a condition is a positive claim: its supports only, unless the condition is 不成立
    const offRole = c.status === '不成立' || !o.roles ? [] : c.keys.filter((k) => o.roles!.get(k) === 'refutes');
    if (offRole.length && withKeys(qid)) o.log?.(`引用 [${qid}${label}] 带进来的反证 ${offRole.map((k) => `[${k}]`).join('')} 挂在了正面的说法上，去掉了`, 'role');
    const own = c.keys.filter((k) => !offRole.includes(k));
    const keys = withKeys(qid) ? own.map((k) => ` [${k}]`).join('') : '';
    const none = withKeys(qid) && c.keys.length > 0 && !own.length ? NO_SOURCE : '';
    return `${keys}${none}${c.status === '证据不足' ? `（靠 ${qid} ${label}，待验证）` : keys || none ? '' : `（靠 ${qid} ${label}）`}`;
  });
}

/**
 * "（见 Q2-1 ②）", "（见 Q2-1 ②，待验证）" for a 证据不足 one (D-48 round 5 A): where the recommendation and the one-line
 * answer lean on a condition. The page links it to that ①②③ line of the card (lib/report/condition-link.ts); Obsidian shows the text.
 */
export const conditionLink = (qid: string, label: string, status: CheckedCondition['status']) => `（见 ${qid} ${label}${status === '证据不足' ? '，待验证' : ''}）`;

/** A one-line text that ends without an end mark gets "。" before code adds its own brackets (M1 验收 3: "…待验证）（由 Q1…"). */
const withEndMark = (t: string) => (/[。！？!?](?:\[\^\d+[!~]*\])*$/.test(t.trim()) ? t : `${t.trimEnd()}。`);

/** "改了什么" (D-48): the model's line; 成立 without one is "没改". */
const changedLine = (r: ClaimResult, ex: (t: string) => string) => (r.judgment.changed?.trim() ? oneLine(ex(r.judgment.changed)) : r.verdict === '成立' ? '没改' : '');

/**
 * One hypothesis' section. `tree`: a question-tree report (D-39): "#### 假设 H2-1：…" under its sub-question (depth 3 or
 * 4), the revision in the verdict's brackets, 理由 and one So What; otherwise the older "### H1 …" section as it was.
 */
export function renderClaimSection(
  r: ClaimResult,
  notes: Footnotes = new Footnotes(),
  tree?: { depth: 3 | 4; qid?: string; conds?: ReadonlyMap<string, CheckedCondition>; roles?: ReadonlyMap<string, 'supports' | 'refutes'> },
): { md: string; unknown: string[]; log: string[]; roleLog: string[] } {
  const unknown: string[] = [];
  const log: string[] = [];
  const roleLog: string[] = [];
  const toLog: RenderLog = (m, kind) => (kind === 'role' ? roleLog : log).push(m);
  const ex = (t: string) => {
    const x = expandCitations(tree?.conds ? expandConditionRefs(t, tree.conds, (q) => q === tree.qid, { roles: tree.roles, log: toLog }) : t, r.keyed, notes);
    unknown.push(...x.unknown);
    return x;
  };
  const j = r.judgment;
  const lines: string[] = [];
  const exText = (t: string) => ex(t).text;
  if (tree) {
    // D-48: 当时的假设 ①②③ → 提议的判断 → 改了什么 → 回答 → 理由 (sub-items) → So What; then the evidence (layer 3)
    lines.push(`${'#'.repeat(tree.depth)} 假设 ${r.label}：${r.claim.statement}${r.hypothesisLink ? `  ${r.hypothesisLink}` : ''}`);
    if (r.conditions?.length) lines.push('- 当时的假设，逐条对照：', ...r.conditions.map((c) => conditionLine(c, exText)));
    lines.push(`- 提议的判断：${verdictWithConditions(r, (t) => oneLine(exText(t)))}`);
    if (r.adjusted) lines.push(`- 系统复核：模型提议“${j.verdict}”，${plainWords(r.adjustNote)}`);
    const changed = isD48(r) ? changedLine(r, exText) : '';
    if (changed) lines.push(`- 改了什么：${changed}`);
    // a split sub-question answers in its own line ("- Q2-1 的回答："); an unsplit one says "- 回答：" when the model wrote one
    const answer = () => cardAnswer(r, (t) => oneLine(exText(t)), toLog);
    if (tree.depth === 4 && tree.qid) lines.push(`- ${tree.qid} 的回答：${answer()}`);
    else if (tree.depth === 3 && (j.answer?.trim() || answerSegmentsOf(r).length)) lines.push(`- 回答：${answer()}`);
    if (j.reasons?.length) lines.push('- 理由：', ...j.reasons.map((t) => `  - ${oneLine(exText(t))}`));
    else lines.push(`- 理由：${oneLine(exText(j.reasoning))}`);
    lines.push(`- So What：${j.so_what.length ? oneLine(exText(j.so_what[0])) : '（没有写）'}`);
  } else {
    lines.push(`### ${r.label} ${r.claim.statement}${r.hypothesisLink ? `  ${r.hypothesisLink}` : ''}`);
    lines.push(`- 提议的判断：${r.verdict}（AI 提议，等人拍板后才生效）`);
    if (r.adjusted) lines.push(`- 系统复核：模型提议“${j.verdict}”，${plainWords(r.adjustNote)}`);
    if (r.revisedStatement) lines.push(`- 修正后的假设：${oneLine(ex(r.revisedStatement).text)}`);
  }
  // each core assertion of the revision, checked by code against the 成立 bar; 待验证 ones are never stated as fact.
  // A question tree writes them after the 支持的证据 table, in the folded layer 3 (D-48); an older report here.
  const assertions = r.assertions ?? [];
  const assertionLines = assertions.length
    ? [
        tree ? '- 修改后的假设拆成几条，逐条对照判断标准（至少 2 个独立来源、其中至少 1 个 A/B 级）：' : '- 修正后的论断，逐条过证据门槛（至少 2 个独立来源、其中至少 1 个 A/B 级）：',
        ...assertions.map((a) => `  - ${a.key}（${a.status}：${a.basis}${a.status === '待验证' ? '；转成要问专家的问题' : ''}）：${oneLine(ex(`${a.text}${a.keys.map((k) => ` [${k}]`).join('')}`).text)}`),
      ]
    : [];
  if (!tree) lines.push(...assertionLines);

  // 支持的证据: one row per line the model wrote; the quote, grade and source go to the footnote
  lines.push('- 支持的证据：', '');
  if (j.support_lines.length) {
    lines.push('| 论断 | 关键数字 | 等级 | 出处 |', '|---|---|---|---|');
    for (const l of j.support_lines) {
      const x = ex(l);
      const { claim, markers } = splitMarkers(x.text);
      const grades = [...new Set(x.used.map((k) => r.keyed.get(k)).filter((e): e is Evidence => Boolean(e)).map(gradeOf))].join('、');
      lines.push(`| ${cell(claim)} | ${cell(keyNumbers(claim))} | ${cell(grades)} | ${markers || '—'} |`);
    }
  } else {
    lines.push('  - （无）');
  }
  lines.push('');
  if (tree && assertionLines.length) lines.push(...assertionLines, '');

  // 反证和挑战: every refute answered one by one (challenge_responses); the model's counter_lines only when there is none
  lines.push('- 反证和挑战（逐条回应）：', '');
  const answered = j.challenge_responses.filter((c) => responseKeys(c).some((k) => r.keyed.has(k)));
  if (answered.length) {
    lines.push(`| 挑战 | 回应 | ${tree ? '对判断的影响' : '结论'} | 出处 |`, '|---|---|---|---|');
    for (const c of answered) {
      // one row may answer several challenges that say the same thing: each gets its footnote
      const cites = responseKeys(c).flatMap((k) => (r.keyed.has(k) ? [notes.cite(r.keyed.get(k)!)] : [])).join('');
      const resp = splitMarkers(ex(c.response).text);
      lines.push(`| ${cell(splitMarkers(ex(c.challenge).text).claim)} | ${cell(resp.claim)}${resp.markers} | ${c.effect} | ${cites} |`);
    }
  } else {
    lines.push(...bullets(j.counter_lines.map((t) => ex(t).text)));
  }
  lines.push('');

  // Expert input is written by CODE, on its own line: a challenge or a lead from an interview, never counted as evidence.
  // One line per interview answer: judged under two sub-questions it may carry two stances; a challenge raised anywhere is a challenge.
  const byRef = new Map<string, Evidence>();
  for (const e of r.evidence.filter((x) => isExpert(x))) {
    const prev = byRef.get(e.ref);
    if (!prev || (prev.stance !== 'refutes' && e.stance === 'refutes')) byRef.set(e.ref, e);
  }
  const experts = [...byRef.values()].sort((a, b) => (a.stance === 'refutes' ? 0 : 1) - (b.stance === 'refutes' ? 0 : 1)).slice(0, 4);
  if (experts.length) {
    lines.push(
      `- 专家意见（${experts.every((e) => e.simulated) ? '模拟访谈，' : ''}只当对假设的挑战或线索，不是事实证据，不算 A/B 级来源）：`,
      ...experts.map((e) => `  - ${e.stance === 'refutes' ? '挑战' : '同向的看法（不算支持证据）'}${notes.cite(e)}：${displayExcerpt(e.quote.replace(/\*\*|__|[“”"]/g, '').replace(/^受访者[:：]\s*/, ''), 60)}`),
    );
  }
  if (!tree) lines.push(`- 推导（推断）：${oneLine(ex(j.reasoning).text)}`);
  lines.push(`- 模型知识（只是线索，不是证据）：${j.model_knowledge.length ? joinClauses(j.model_knowledge.map((t) => oneLine(ex(t).text))) : '无'}`);
  if (!tree) lines.push('- So what 的候选：', ...bullets(j.so_what.map((t) => ex(t).text)));
  // Every model-written field goes through expandCitations: a [E5] in a 缺口 line used to stay in the text and
  // block the whole report (found in M4's eval round 2).
  const unverified = assertions.filter((a) => a.status === '待验证').map((a) => `要问专家：${unverifiedAsk(a)}`);
  lines.push('- 缺口，以及要问专家的问题：', ...bullets([...j.gaps.map((g) => `缺口：${ex(g).text}`), ...j.expert_questions.map((q) => `要问专家：${ex(q).text}`), ...unverified]));
  return { md: lines.join('\n'), unknown, log: [...new Set(log)], roleLog: [...new Set(roleLog)] };
}

/** "支持 A2·B3 · 反证 2 · 专家挑战 1": what the verdict stands on, counted by code. */
function evidenceTally(r: ClaimResult): string {
  const supports = r.evidence.filter((e) => e.stance === 'supports' && !isExpert(e));
  const byGrade = (['A', 'B', 'C'] as const).map((g) => [g, new Set(supports.filter((e) => e.grade === g).map((e) => e.ref)).size] as const).filter(([, n]) => n > 0);
  const refutes = new Set(r.evidence.filter((e) => e.stance === 'refutes' && !isExpert(e)).map((e) => e.ref)).size;
  const challenges = new Set(r.evidence.filter((e) => e.stance === 'refutes' && isExpert(e)).map((e) => e.ref)).size;
  return [
    byGrade.length ? `支持 ${byGrade.map(([g, n]) => `${g} 级 ${n}`).join('、')}` : '支持 0',
    `反证 ${refutes}`,
    ...(challenges ? [`专家挑战 ${challenges}`] : []),
  ].join(' · ');
}

/** The reason after "H1 → 成立（提议）：" in the model's result line for this claim. */
function reasonFor(label: string, results: string[]): string {
  const line = results.find((l) => new RegExp(`^\\s*${label}\\s*→`).test(l));
  if (!line) return '';
  const m = /^[^：:]*[：:](.*)$/.exec(line);
  return (m ? m[1] : line).trim();
}

/** Checks a recommendation can fail on (missing pieces): written by code into the report so the self-check sees them. */
export function recommendationGaps(rec: Recommendation | undefined, keyed?: Map<string, Evidence>): string[] {
  if (!rec) return ['推荐判断整段没有写'];
  const gaps: string[] = [];
  // a simulated interview is a challenge or a lead, never ground for a recommendation (D-21: ^e3 / ^e5 cited under 收购)
  if (keyed) {
    const text = [rec.decision_answer, rec.action, rec.scale, rec.scale_basis, ...rec.metrics, ...rec.change_if, ...rec.alternatives.flatMap((a) => [a.option, a.why_not])].join('\n');
    const simulated = [...new Set([...text.matchAll(KEY_GROUP)].flatMap((m) => keysIn(m[1])))].filter((k) => {
      const e = keyed.get(k);
      return e && isExpert(e) && e.simulated;
    });
    if (simulated.length) gaps.push(`${SIMULATED_IN_RECOMMENDATION} ${simulated.map((k) => `[${k}]`).join('、')}：模拟访谈只能当挑战或线索，不能用来支撑推荐判断，换成资料证据或删掉这条引用`);
  }
  if (isResearchAction(rec.action)) gaps.push('“做什么”写的是研究动作（调研、问卷、访谈、补证据），不是对联想的业务动作；研究的下一步写在“对研究计划的影响”里，这里要给业务推荐（证据不足就给暂定的业务推荐，标推断）');
  if (!rec.decision_answer.trim()) gaps.push('没有写对项目业务决策的回答（押哪一层、怎么拿到）');
  // build / partner / buy is counted on the "换一种拿法" alternatives only: betting on another layer is not a way to get this one
  const kinds = new Set([rec.action_kind, ...rec.alternatives.filter((a) => a.dimension === 'acquire').map((a) => a.kind)]);
  if (!rec.alternatives.some((a) => a.dimension === 'layer')) gaps.push('其他选项里没有“押别的层”（决策里列出的其他层各写一项）');
  const missing = (['自研', '合作', '收购'] as const).filter((k) => !kinds.has(k));
  if (missing.length) gaps.push(`其他选项里没有覆盖“${missing.join('、')}”（自研 / 合作 / 收购这一维要列全，不适用也要写明为什么）`);
  if (rec.scale_inferred && !rec.scale_basis.trim()) gaps.push('量级标了推断，但没有写是怎么估的');
  const noReason = rec.alternatives.filter((a) => !a.why_not.trim()).map((a) => a.option);
  if (noReason.length) gaps.push(`其他选项“${noReason.join('、')}”没有写不选的理由`);
  // D-39 (sample 备注 10): "之所以不列为主路径，只能作为自研的补充" explains the conclusion by itself
  const circular = rec.alternatives.filter((a) => a.why_not.trim() && isCircularWhyNot(a.why_not)).map((a) => a.option);
  if (circular.length) gaps.push(`${CIRCULAR_WHY_NOT}“${circular.join('、')}”不选的理由只是在重复结论（"不作为主路径""只能当补充"）：要写出证据或判断`);
  return gaps;
}

/** The opening of the gap below: a repair round asks for a reason, but a rule this loose never keeps a report a draft. */
export const CIRCULAR_WHY_NOT = '其他选项';
const CONCLUSION_ONLY = /^(?:不选[，,：:、]?\s*)?(?:之所以|因为)?\s*(?:不(?:列|作|当)为?主路径|只能(?:作为|当作?)[^，。；]{0,12}(?:补充|辅助)(?:而非替代)?|不作为主要选择|作为补充保留|保留为补充)[，,。；;\s]*/;
/** The opening of the simulated-interview gap (recommendationGaps). */
const SIMULATED_IN_RECOMMENDATION = '推荐判断引用了模拟访谈';

/**
 * A gap the repair rounds ask about but that never keeps a report a draft (a loose text rule; logged when left).
 * A simulated interview in the recommendation too (the user, D-48: "这次参考模拟访谈，我不觉得是个错误"): its footnote
 * shows as usual, marked （模拟）; it is never A/B and never makes a condition 成立 (supportBar, checkCondition).
 */
export const isSoftGap = (message: string): boolean => message.includes('不选的理由只是在重复结论') || message.includes(SIMULATED_IN_RECOMMENDATION);

/** The log action for a soft gap left after the repair rounds. */
export const softGapAction = (message: string): string => (message.includes(SIMULATED_IN_RECOMMENDATION) ? 'research:simulated-in-recommendation' : 'research:soft-gap');

/** A why_not made only of "不作为主路径 / 只能当补充" phrases: no evidence, no judgment. */
export function isCircularWhyNot(whyNot: string): boolean {
  let rest = whyNot.trim();
  for (let i = 0; i < 4 && rest; i++) {
    const m = CONCLUSION_ONLY.exec(rest);
    if (!m || !m[0]) break;
    rest = rest.slice(m[0].length).trim();
  }
  return rest.length === 0;
}

const RESEARCH_STEP = /调研|问卷|访谈|研究机构|委托.{0,8}(研究|调查|调研)|补证|补充证据|收集(资料|证据|数据)|找.{0,8}(资料|证据|报告|数据)|桌面研究|案头研究/;
const BUSINESS_STEP = /推出|发布|上线|预装|定价|打包|捆绑|渠道|销售|商用化|做成|建(?:立|设)|投资|收购|自研|研发|与.{1,16}合作|联合.{0,8}(推出|开发)|试点(?:部署|上线|销售|交付)/;

/** "做什么" that is only a research step (the next research move belongs under "对研究计划的影响"). */
export function isResearchAction(action: string): boolean {
  return RESEARCH_STEP.test(action) && !BUSINESS_STEP.test(action);
}

const KIND_ORDER = ['自研', '合作', '收购', '其他'] as const;

/** The alternatives in table order: the layer choices first, then build / partner / buy. */
export function sortedAlternatives(rec: Recommendation): Recommendation['alternatives'] {
  return [...rec.alternatives].sort((a, b) => (a.dimension === b.dimension ? KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) : a.dimension === 'layer' ? -1 : 1));
}

/** "<结论>。依据：<…>": a 依据 that opens a clause (not 估算依据), what a recommendation cell breaks before. */
const BASIS = /[。；;.！!？?\s]\s*(?=依据[：:])/;

/**
 * A recommendation cell, D-48 round 2: `结论<br>依据：…`, broken before its first 依据 (`suffix`, 做什么's "（合作）",
 * goes with the conclusion). A cell without one as it was.
 */
export function withBasisBreak(text: string, suffix = ''): string {
  const m = BASIS.exec(text);
  if (!m) return `${text}${suffix}`;
  const at = m.index + m[0].length;
  return `${trimEndMark(text.slice(0, at))}${suffix}<br>${text.slice(at)}`;
}

const QUOTE_OPEN = '「“『';
const QUOTE_CLOSE = '」”』';

/**
 * "- 所以联想：" in a question tree's Summary (D-48 round 2): the first sentence of the recommendation's 对决策的回答
 * (raw, or a rendered cell), without "提议：" and, as the line already says it, a leading "联想". A 。 inside a quote
 * does not end it; the footnotes right after the end mark stay with it.
 */
export function soLenovo(decisionAnswer: string): string {
  const t = decisionAnswer.split('<br>')[0].trim().replace(/^提议[：:]\s*/, '').replace(/^(?:所以)?联想[，,：:]?\s*/, '');
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (QUOTE_OPEN.includes(ch)) depth++;
    else if (QUOTE_CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && '。！？'.includes(ch)) return t.slice(0, i + 1) + (/^(?:\[\^?[^\]\s]+\])*/.exec(t.slice(i + 1))?.[0] ?? '');
  }
  return t;
}

/** The row already says "不选，": a why_not that opens with it again (v4: "不选，不选：…") loses its own. */
const NOT_CHOSEN = /^\s*不选\s*[，,：:、]\s*/;

/** `tree`: the question-tree wording (D-39): "下面全部是 AI 的提议" said once, at the top. */
export function renderRecommendation(rec: Recommendation | undefined, ex: (t: string) => string, tree = false): string[] {
  const out = tree ? ['- AI 的推荐判断（待你拍板）：下面全部是 AI 的提议，状态只有人能改。', ''] : ['- AI 的推荐判断（提议，待你拍板）：', ''];
  if (!rec) return [...out, '  - （没有写出推荐判断）', ''];
  const scaleCited = hasEvidenceKey(rec.scale);
  const inferred = rec.scale_inferred || !scaleCited; // a scale with no evidence is an estimate, whatever the model said
  // the model sometimes opens its basis with its own label ("推断依据：…"): the row already says 估算依据
  const basis = rec.scale_basis.trim().replace(/^(?:推断|估算)?(?:依据|方法)[：:]\s*/, '');
  // the two dimensions of the decision, layer first, written by code from the model's tag
  const alternatives = sortedAlternatives(rec);
  const br = withBasisBreak;
  out.push(
    '| | 提议 |',
    '|---|---|',
    ...(rec.decision_answer.trim() ? [`| 对决策的回答 | ${br(cell(ex(rec.decision_answer)))} |`] : []),
    ...(rec.directive_response.trim() ? [`| 怎么回应高层指示 | ${br(cell(ex(rec.directive_response)))} |`] : []),
    `| 做什么 | ${br(cell(ex(rec.action)), rec.action_kind === '其他' ? '' : `（${rec.action_kind}）`)} |`,
    // D-39 用词对照表: "怎么估的（推断）：…" said straight, not "（推断；估算依据：…）"
    `| 量级 | ${br(inferred ? `${trimEndMark(cell(ex(rec.scale)))}${tree ? `。怎么估的（推断）：${cell(basis ? ex(basis) : '没有写')}` : `（推断；估算依据：${cell(basis ? ex(basis) : '没有写')}）`}` : cell(ex(rec.scale)))} |`,
    `| 看什么指标 | ${br(cell(joinClauses(rec.metrics.map(ex))))} |`,
    ...alternatives.map((a) => `| ${a.dimension === 'layer' ? '其他选项（押别的层）' : `其他选项（换一种拿法：${a.kind === '其他' ? '其他' : a.kind}）`} | ${br(`${trimEndMark(cell(ex(a.option)))}：不选，${cell(ex(a.why_not.replace(NOT_CHOSEN, '')))}`)} |`),
    `| 什么情况下要改 | ${br(cell(joinClauses(rec.change_if.map(ex))))} |`,
    '',
    ...(tree ? [] : ['以上全部是 AI 提议，状态只有人能改。', '']),
  );
  return out;
}

/** The plan claim behind a result, for its perspectives (the plan holds the sub-questions' too). */
type PerspectiveClaim = { id: string; perspective?: string[]; sub_questions?: { id: string; perspective?: string[] }[] };

/** The claim's perspective plus its sub-questions' from the plan; the claim's own when the plan is not at hand. */
function perspectivesOf(r: ClaimResult, plan: TreePlan | undefined): string[] | undefined {
  const p = plan?.claims.find((x) => x.id === r.claim.id) as PerspectiveClaim | undefined;
  if (!p) return r.claim.perspective;
  return [...(p.perspective ?? []), ...(p.sub_questions ?? []).flatMap((q) => q.perspective ?? [])];
}

/** The 访谈建议 card's lines (D-56 ⑤b), built by code from the judgments; [] when the switch is off or there is no ask. */
function interviewCardLines(facts: ReportFacts, claims: ClaimResult[], ex: (r: ClaimResult, t: string) => string): string[] {
  if (!facts.interviewCard) return [];
  const input: InterviewClaim[] = claims.map((r) => ({
    label: r.label,
    perspectives: perspectivesOf(r, facts.plan),
    expertQuestions: r.judgment.expert_questions.map((q) => ex(r, q)),
    unverified: (r.assertions ?? []).filter((a) => a.status === '待验证'),
  }));
  return renderInterviewCard(interviewAsks(input));
}

/** A report: the fixed structure of D63 §3.2 when the summary has its fields (T23), else the older one. */
export function renderReport(facts: ReportFacts, claims: ClaimResult[], summary: SummaryDraft, summaryKeyed: Map<string, Evidence>): RenderedReport {
  const v1 = renderReportV1(facts, claims, summary, summaryKeyed);
  return summary.reasons?.length ? renderReportV2(facts, claims, summary, summaryKeyed, v1) : v1;
}

function renderReportV1(facts: ReportFacts, claims: ClaimResult[], summary: SummaryDraft, summaryKeyed: Map<string, Evidence>): RenderedReport {
  const tree = facts.plan ? questionTreeOf(facts.plan) : null;
  if (tree?.format === 'question_tree') return renderTreeReport(facts, tree.roots, claims, summary, summaryKeyed);
  const unknownKeys: string[] = [];
  const sections = new Map<string, string>();
  const notes = new Footnotes();
  const exSummary = (t: string) => {
    const x = expandCitations(t, summaryKeyed, notes);
    unknownKeys.push(...x.unknown);
    return oneLine(x.text);
  };
  // Footnotes are numbered in reading order: Summary first, then the claims.
  const out: string[] = [`# ${facts.title} 调查报告 v${facts.version}`, '', '## Summary'];
  out.push(`- 要回答的问题：${oneLine(facts.question)}`);
  out.push(`- 一句话答案：${exSummary(summary.so_what)}${facts.exploratory ? '（探索性结论：研究计划批准之前跑的）' : ''}`);
  out.push('- 论点和提议的判断：', '');
  out.push('| 论点 | 提议的判断 | 理由 | 证据 |', '|---|---|---|---|');
  for (const c of claims) out.push(`| ${c.label} ${cell(c.claim.statement)} | ${c.verdict} | ${cell(exSummary(reasonFor(c.label, summary.results)))} | ${evidenceTally(c)} |`);
  out.push('');
  if (summary.workplan_impact.length) out.push('- 对研究计划的影响（详见后文）：', ...summary.workplan_impact.slice(0, 3).map((l) => `  - ${exSummary(l)}`));
  const allAssertions = claims.flatMap((c) => c.assertions ?? []);
  out.push(...renderRecommendation(summary.recommendation, (t) => exSummary(expandAssertionKeys(expandDirectiveKeys(t, facts.directives ?? [], notes), allAssertions))));
  const claimMd = claims.map((c) => {
    const { md, unknown } = renderClaimSection(c, notes);
    unknownKeys.push(...unknown);
    sections.set(c.claim.id, md);
    return md;
  });

  out.push(...rewriteChanges(facts, claims));
  // 怎么查的: three lines; the rest of the record goes to the appendix
  out.push('## 怎么查的');
  out.push(...(facts.origins?.length ? facts.origins.map(plainWords) : ['- 这次调查的出发点：计划没有关联到会议、决定或项目笔记']));
  out.push(
    `- 查了：知识库 ${facts.kbCount} 份、网上 ${facts.webCount} 份${facts.expertCount ? `、专家访谈 ${facts.expertCount} 份（模拟访谈只当挑战或线索，不算证据）` : ''}；${searchCounts(facts)}；${facts.mode === 'small' ? '试水调查' : '完整调查'}。`,
  );
  out.push('- 判断标准：至少 2 个互相独立的来源支持、其中至少 1 个是 A/B 级，并且没有没被驳倒的同等级反证，才判“成立”；有 A/B 级证据直接推翻核心前提才判“不成立”；每个论点都专门找过一轮反证。');

  out.push('', '## 逐个假设');
  for (const md of claimMd) out.push(md, '');

  out.push(IMPACT_HEADING);
  out.push(...bullets(summary.workplan_impact.map(exSummary), ''));

  const interview = interviewCardLines(facts, claims, (r, t) => {
    const x = expandCitations(t, r.keyed, notes);
    unknownKeys.push(...x.unknown);
    return x.text;
  });
  if (interview.length) out.push('', ...interview);

  out.push('', '## 附录：过程记录');
  out.push(`- 调查计划：${facts.planLink}（来自 ${facts.workplanLink}${facts.exploratory ? '；研究计划批准之前跑的，标“探索性”' : ''}）`);
  if (facts.decisions) out.push(plainWords(`- 遵循的已确认决定（沿关联找到）：${facts.decisions.length ? facts.decisions.join('；') : '无（项目里没有关联到本次调查的已确认决定）'}`));
  out.push(`- 模式：${facts.mode === 'small' ? '试水调查（1 个论点、最多 2 个子问题，联网搜 3 次、抓取 3 次）' : '完整调查'}`);
  for (const c of claims) out.push(plainWords(`- ${c.label} 的检索：${c.subNotes.map((s) => `${s.id} ${s.note}`).join('；') || '无'}`));
  out.push(...facts.counterLines.map((l) => plainWords(`- ${l}`)));
  out.push(
    plainWords(
      `- 计划之外的调整：${[
        ...facts.notExecuted.map((id) => `${id} 本次没有执行（试水调查范围）`),
        facts.droppedQuotes ? `系统核对原文时丢弃了 ${facts.droppedQuotes} 条对不上的论断` : '',
        ...facts.adjustments,
        ...facts.skipped.map((s) => `跳过：${s}`),
      ]
        .filter(Boolean)
        .join('；') || '无'}`,
    ),
  );
  if (facts.citationFit) out.push(citationFitLine(facts.citationFit));

  out.push('', FOOTNOTE_HEADING, ...(notes.size ? notes.lines() : ['（没有引用）']));
  return { body: `${out.join('\n')}\n`, sections, unknownKeys };
}

/** A top-level sub-question this run did not reach (a small run: only the first hypothesis). */
const NOT_RUN = '本次没有查（试水调查范围）';

/** The first sentence of a text (its closing mark kept). */
const firstSentence = (t: string) => (/^[^。！？!?；;]*[。！？!?；;]?/.exec(t.trim())?.[0] ?? t).trim();

/**
 * A lowest-level sub-question's answer, by code from its hypothesis' judgment (D-39 2b, no model): 成立 → "是。<假设>";
 * 需要修改 → the revision; 不成立 → "不是。<理由的第一句>"; 证据不足 → "现在还答不了，缺 <第一条缺口>".
 */
export function leafAnswer(r: ClaimResult, ex: (t: string) => string): string {
  switch (r.verdict) {
    case '成立':
      return `是。${trimEndMark(r.claim.statement)}。`;
    case '需要修改':
      return r.revisedStatement?.trim() ? `${trimEndMark(ex(r.revisedStatement))}。` : `只有一部分成立。${firstSentence(ex(r.judgment.reasoning))}`;
    case '不成立':
      return `不是。${firstSentence(ex(r.judgment.reasoning))}`;
    default:
      // "缺少预算口径" reads "缺预算口径", not "缺 缺少预算口径"
      return `现在还答不了，缺${r.judgment.gaps[0]?.trim() ? trimEndMark(ex(r.judgment.gaps[0]).trim().replace(/^(?:缺口[：:]\s*)?(?:缺少|缺乏|缺|没有|尚无|还没有)\s*/, '')) : '证据'}。`;
  }
}

/**
 * The question-tree report (D-39, C's sample D-39_报告样稿): Summary (core question, the answer assembled from the
 * top-level sub-questions' answers, the tree, each answer, why they are enough, each hypothesis' verdict, the
 * recommendation), 怎么查的, then one "## Qx" per top-level sub-question: its hypothesis (### 假设 H1) and answer
 * (### Q1 的回答), or its parts (### Q2-1 …, #### 假设 H2-1) and the assembled answer (### Q2 的回答).
 */
function renderTreeReport(facts: ReportFacts, roots: TreeRoot[], claims: ClaimResult[], summary: SummaryDraft, summaryKeyed: Map<string, Evidence>): RenderedReport {
  const unknownKeys: string[] = [];
  const sections = new Map<string, string>();
  const notes = new Footnotes();
  const answerFallbacks: string[] = [];
  const segmentLog = new Set<string>();
  const roleLog = new Set<string>();
  const logSegment: RenderLog = (m, kind) => (kind === 'role' ? roleLog : segmentLog).add(m);
  // round 5: each key's role under its hypothesis (a block both supports and refutes counts as refutes)
  const roles = evidenceRoles(claims);
  // [Q2-1①] → that condition's evidence and, 证据不足, "（靠 Q2-1 ①，待验证）" (round 4, S2)
  const conds = new Map<string, CheckedCondition>();
  for (const root of roots)
    for (const l of root.leaf ? [root.leaf] : root.children) for (const c of claims.find((x) => x.claim.id === l.claimId)?.conditions ?? []) conds.set(`${l.qid}${c.label}`, c);
  const exSummary = (t: string, asLink = false) => {
    const x = expandCitations(expandConditionRefs(t, conds, undefined, { roles, log: logSegment, asLink }), summaryKeyed, notes);
    unknownKeys.push(...x.unknown);
    return oneLine(x.text);
  };
  const resultOf = (claimId: string) => claims.find((c) => c.claim.id === claimId);
  const leavesOf = (root: TreeRoot) => (root.leaf ? [root.leaf] : root.children);
  const ran = (root: TreeRoot) => leavesOf(root).some((l) => resultOf(l.claimId));
  const answered = roots.filter(ran);
  const answerOf = (root: TreeRoot): string => {
    if (!ran(root)) return NOT_RUN;
    // an unsplit one says what its card says (D-48: the page shows it once)
    const own = root.leaf ? resultOf(root.leaf.claimId) : undefined;
    if (own && (own.judgment.answer?.trim() || answerSegmentsOf(own).length)) return cardAnswerOf(own);
    // a split one lists its parts' answers, each as its card says it (round 4: not assembled again by the model)
    const parts = root.leaf ? [] : root.children.flatMap((l) => (resultOf(l.claimId) ? [{ l, r: resultOf(l.claimId)! }] : []));
    if (parts.length && parts.every(({ r }) => answerSegmentsOf(r).length)) return `${parts.map(({ l, r }) => `${l.qid}：${trimEndMark(cardAnswerOf(r))}`).join('；')}。`;
    const written = summary.answers.find((a) => a.id.trim().toUpperCase() === root.qid)?.answer.trim();
    if (written) return exSummary(written);
    // the Summary call left it out: code writes it from the hypotheses' judgments, by the leaf rule (never left empty)
    answerFallbacks.push(root.qid);
    return leavesOf(root)
      .flatMap((l) => {
        const r = resultOf(l.claimId);
        return r ? [`${root.leaf ? '' : `${l.qid}：`}${leafAnswer(r, exSummary)}`] : [];
      })
      .join(' ');
  };
  const verdictCell = (claimId: string) => {
    const r = resultOf(claimId);
    return r ? cell(verdictWithConditions(r, exSummary)) : NOT_RUN;
  };
  // the card's answer, with the card's footnotes (D-48): the Summary table's 回答 column, and an unsplit one's answer
  const qidOf = new Map(roots.flatMap((root) => (root.leaf ? [root.leaf] : root.children).map((l) => [l.claimId, l.qid] as const)));
  const cardAnswerOf = (r: ClaimResult) => {
    const x = (t: string) => {
      const e = expandCitations(expandConditionRefs(t, conds, (q) => q === qidOf.get(r.claim.id), { roles, log: logSegment }), r.keyed, notes);
      unknownKeys.push(...e.unknown);
      return e.text;
    };
    return cardAnswer(r, x, logSegment);
  };

  const out: string[] = [`# ${facts.title} 调查报告 v${facts.version}`, '', '## Summary'];
  out.push(`- 核心问题：${oneLine(facts.question)}`);
  out.push(`- 回答（一句话）：${withEndMark(exSummary(summary.so_what, true))}（由 ${answered.map((r) => r.qid).join('、') || '（无）'} 的回答组装而成）${facts.exploratory ? '（探索性结论：研究计划批准之前跑的）' : ''}`);
  const allAssertions = claims.flatMap((c) => c.assertions ?? []);
  const recEx = (t: string) => exSummary(expandAssertionKeys(expandDirectiveKeys(t, facts.directives ?? [], notes), allAssertions, { tree: true }), true);
  // D-48 round 2: what it means for Lenovo, the recommendation's first sentence (not one more model call)
  const lenovo = soLenovo(summary.recommendation?.decision_answer ?? '');
  if (lenovo) out.push(`- 所以联想：${recEx(lenovo)}`);
  const split = trimEndMark(oneLine(summary.split_basis ?? '')).replace(/[：:]+$/, '');
  out.push(`- 问题树：${split ? `${exSummary(split)}：` : ''}核心问题 → ${roots.map((r) => `${r.qid} ${oneLine(r.question)}${r.children.length ? `（→ ${r.children.map((c) => `${c.qid} ${oneLine(c.question)}`).join('、')}）` : ''}`).join('／')}`);
  const answers = new Map(roots.map((r) => [r.qid, answerOf(r)]));
  out.push('- 各子问题的回答：', ...roots.map((r) => `  - ${r.qid} → ${answers.get(r.qid)}`));
  // the Summary call's; else the plan's own MECE check, which the owner approved
  const sufficiency = summary.sufficiency.trim() ? exSummary(summary.sufficiency) : facts.plan?.mece_check?.trim() ? `计划里的自检：${oneLine(facts.plan.mece_check)}` : '（没有写）';
  out.push(`- 为什么这几个回答足以回答核心问题：${sufficiency}`);
  // D-48: the verdict stays in column 3 (a follow-up reads cells[3]); the answer after it; the model's short name, else the statement
  out.push('- 各假设的提议判断：', '', '| 子问题 | 假设 | 提议的判断 | 回答 |', '|---|---|---|---|');
  for (const root of roots)
    for (const l of leavesOf(root)) {
      const r = resultOf(l.claimId);
      const name = r?.judgment.short_statement?.trim() || claimStatement(facts.plan, l.claimId);
      out.push(`| ${l.qid} | ${l.label} ${cell(name)} | ${verdictCell(l.claimId)} | ${r ? cell(root.leaf ? (answers.get(root.qid) ?? '') : cardAnswerOf(r)) : NOT_RUN} |`);
    }
  out.push('');
  out.push(...renderRecommendation(summary.recommendation, recEx, true));
  out.push(...rewriteChanges(facts, claims));

  out.push('## 怎么查的');
  out.push(...(facts.origins?.length ? facts.origins.map(plainWords) : ['- 这次调查的出发点：计划没有关联到会议、决定或项目笔记']));
  out.push(
    `- 查了：知识库 ${facts.kbCount} 份、网上 ${facts.webCount} 份${facts.expertCount ? `、专家访谈 ${facts.expertCount} 份（模拟访谈只当挑战或线索，不算证据）` : ''}；${searchCounts(facts)}；${facts.mode === 'small' ? '试水调查' : '完整调查'}。`,
  );
  out.push('- 判断标准：至少 2 个互相独立的来源支持、其中至少 1 个是 A/B 级，并且没有没被驳倒的同等级反证，才判“成立”；有 A/B 级证据直接推翻核心前提才判“不成立”；每个假设都专门找过一轮反证。');

  const hypothesis = (claimId: string, label: string, depth: 3 | 4, qid: string): string[] => {
    const r = resultOf(claimId);
    if (!r) return [`- 假设 ${label}：${oneLine(claimStatement(facts.plan, claimId))}（${NOT_RUN}）`];
    const { md, unknown, log, roleLog: roleDropped } = renderClaimSection(r, notes, { depth, qid, conds, roles });
    unknownKeys.push(...unknown);
    log.forEach((m) => logSegment(m));
    roleDropped.forEach((m) => logSegment(m, 'role'));
    sections.set(r.claim.id, md);
    return [md];
  };
  for (const root of roots) {
    out.push('', `## ${root.qid} ${oneLine(root.question)}`, '');
    if (root.leaf) out.push(...hypothesis(root.leaf.claimId, root.leaf.label, 3, root.qid), '');
    // each lowest-level sub-question split from it answers in its card ("- Q2-1 的回答：", D-48), the model's answer or
    // code's from the judgment (D-39 2b); a sub-question not run says so in its place
    for (const c of root.children) {
      out.push(`### ${c.qid} ${oneLine(c.question)}`, '', ...hypothesis(c.claimId, c.label, 4, c.qid), ...(resultOf(c.claimId) ? [] : [`- ${c.qid} 的回答：${NOT_RUN}`]), '');
    }
    out.push(`### ${root.qid} 的回答`, '', answers.get(root.qid) ?? NOT_RUN);
  }

  out.push('', IMPACT_HEADING);
  out.push(...bullets(summary.workplan_impact.map((t) => exSummary(t)), ''));

  const interview = interviewCardLines(facts, claims, (r, t) => {
    const x = expandCitations(expandConditionRefs(t, conds, (q) => q === qidOf.get(r.claim.id), { roles, log: logSegment }), r.keyed, notes);
    unknownKeys.push(...x.unknown);
    return x.text;
  });
  if (interview.length) out.push('', ...interview);

  out.push('', '## 附录：过程记录');
  out.push(`- 调查计划：${facts.planLink}（来自 ${facts.workplanLink}${facts.exploratory ? '；研究计划批准之前跑的，标“探索性”' : ''}）`);
  if (facts.decisions) out.push(plainWords(`- 遵循的已确认决定（沿关联找到）：${facts.decisions.length ? facts.decisions.join('；') : '无（项目里没有关联到本次调查的已确认决定）'}`));
  out.push(`- 模式：${facts.mode === 'small' ? '试水调查（按问题树的顺序只查第 1 个假设，最多 2 个要查的问题，联网搜 3 次、抓取 3 次）' : '完整调查'}`);
  for (const c of claims) out.push(plainWords(`- ${c.label} 要查的问题：${c.subNotes.map((s) => `${subLabel(facts.plan, c.claim.id, s.id)} ${s.note}`).join('；') || '无'}`));
  out.push(...facts.counterLines.map((l) => plainWords(`- ${l}`)));
  out.push(
    plainWords(
      `- 计划之外的调整：${[
        ...facts.notExecuted.map((id) => `${notRunLabel(facts.plan, id)} 本次没有查（试水调查范围）`),
        facts.droppedQuotes ? `系统核对原文时丢弃了 ${facts.droppedQuotes} 条对不上的论断` : '',
        ...facts.adjustments,
        ...facts.skipped.map((s) => `跳过：${s}`),
      ]
        .filter(Boolean)
        .join('；') || '无'}`,
    ),
  );
  if (facts.citationFit) out.push(citationFitLine(facts.citationFit));

  out.push('', FOOTNOTE_HEADING, ...(notes.size ? notes.lines() : ['（没有引用）']));
  return { body: `${out.join('\n')}\n`, sections, unknownKeys, answerFallbacks, ...(segmentLog.size ? { segmentLog: [...segmentLog] } : {}), ...(roleLog.size ? { roleLog: [...roleLog] } : {}) };
}

const claimStatement = (plan: TreePlan | undefined, claimId: string) => plan?.claims.find((c) => c.id === claimId)?.statement ?? claimId;
const subLabel = (plan: TreePlan | undefined, claimId: string, subId: string) => (plan ? subQuestionLabel(plan, claimId, subId) : subId);
/** "C2" → "H2-1", "C1-Q3" → "Q1.3": what the reader sees for a part of the plan not run. */
function notRunLabel(plan: TreePlan | undefined, id: string): string {
  if (!plan) return id;
  const sub = /^(C\d+)-Q\d+$/.exec(id);
  return sub ? subQuestionLabel(plan, sub[1], id) : hypothesisLabel(plan, id);
}

// ── 待验证 assertions in the recommendation (D-29) ──────────────────────────

/** `[H2-A2]`, `[H3-1-A3]` (a question tree's hypothesis label): an assertion the recommendation leans on. */
const ASSERTION_KEY = /[\[【]\s*(H\d+(?:-\d+)?-A\d+)\s*[\]】]/g;
/** A key with the words the model writes before it ("依赖待验证断言 [H2-A2]"), bracketed or not: all of it is replaced. */
const ASSERTION_REF = /(?:(依赖)?(?:待验证|已验证)?断言\s*)?(?:[\[【]\s*(H\d+(?:-\d+)?-A\d+)\s*[\]】]|(?<![\w\[【-])(H\d+(?:-\d+)?-A\d+)(?![\w\]】-]))/g;

/**
 * `[H3-1-A3]` → "「这笔钱更可能是从既有软件…」这条还没验证的判断（见 Q3-1）": a recommendation that leans on an
 * assertion says which one in words, and where it is (the hypothesis' sub-question; H1 in an older report). The key
 * itself stays in that hypothesis' list of assertions, not in the recommendation (报告 v3: "依赖待验证断言 [H3-1-A3]").
 */
export function expandAssertionKeys(text: string, assertions: CheckedAssertion[], opts: { tree?: boolean } = {}): string {
  if (!assertions.length) return text;
  return text.replace(ASSERTION_REF, (whole, dep: string | undefined, bracketed: string | undefined, bare: string | undefined) => {
    const a = assertions.find((x) => x.key === (bracketed ?? bare));
    if (!a) return whole;
    const t = a.text.trim().replace(/[。.]$/, '');
    const label = a.key.replace(/-A\d+$/, '');
    return `${dep ? '依赖' : ''}「${t.length > 40 ? `${t.slice(0, 40)}…` : t}」这条${a.status === '待验证' ? '还没验证' : '已经验证'}的判断（见 ${opts.tree ? `Q${label.slice(1)}` : label}）`;
  });
}

/**
 * A recommendation may lean on a 待验证 assertion, but only openly: the part that does says "推断：依赖待验证断言 …",
 * and 什么情况下要改 says what the recommendation becomes if that assertion fails.
 */
export function assertionGaps(rec: Recommendation | undefined, assertions: CheckedAssertion[]): string[] {
  if (!rec) return [];
  const unverified = assertions.filter((a) => a.status === '待验证');
  if (!unverified.length) return [];
  const parts = [rec.decision_answer, rec.directive_response, rec.action, rec.scale, rec.scale_basis, ...rec.metrics, ...rec.alternatives.flatMap((a) => [a.option, a.why_not])].join('\n');
  const changeIf = rec.change_if.join('\n');
  const gaps: string[] = [];
  for (const a of unverified) {
    const cited = [...parts.matchAll(ASSERTION_KEY)].some((m) => m[1] === a.key);
    if (!cited) continue;
    if (!/依赖待验证断言/.test(parts)) gaps.push(`推荐判断用到了待验证断言 [${a.key}]，但没有标“推断：依赖待验证断言 [${a.key}]”`);
    if (![...changeIf.matchAll(ASSERTION_KEY)].some((m) => m[1] === a.key)) gaps.push(`“什么情况下要改”里没有写待验证断言 [${a.key}] 不成立时推荐改成什么`);
  }
  return gaps;
}

// ── D-64 T23: the report's fixed structure (D63 §3.2) ───────────────────────

export const V2_HEADINGS = ['## So what', '## 为什么（三条支撑）', '## 缺乏信息、需要另外验证的问题', '## 对联想的建议', '## 附录：过程和证据'] as const;

/**
 * The gap table's rows: each key question whose claims combine (D63 §3.3) to 证据不足 or 访谈支持, with what the
 * model wrote for it (its row names the key: "K3 …"). A plan without key questions keeps the model's rows.
 */
export function keyGapRows(claims: { key?: string; verdict: Verdict }[], gaps: ReportGap[]): ReportGap[] {
  const keys = [...new Set(claims.flatMap((c) => (c.key ? [c.key] : [])))].sort();
  if (!keys.length) return gaps.filter((g) => g.question.trim());
  return keys.flatMap((k) => {
    const v = keyQuestionVerdict(claims.filter((c) => c.key === k).map((c) => c.verdict));
    if (v !== '证据不足' && v !== '访谈支持') return [];
    const g = gaps.find((x) => new RegExp(`(?:^|[^A-Za-z0-9])${k}(?![0-9])`).test(x.question));
    return [{ question: g?.question.trim() || k, missing: g?.missing.trim() || '（没有写）', how: g?.how.trim() || '（没有写）' }];
  });
}

/** A basis only interviews carry is never a fact (D63 §3.3): its label is 访谈支持 whatever the model wrote. */
export function basisKind(b: ReportReason['basis'][number], keyed: Map<string, Evidence>): BasisKind {
  const cited = b.refs.flatMap((k) => (keyed.has(k) ? [keyed.get(k)!] : []));
  const interviewOnly = cited.length ? cited.every(isExpert) : /^访谈/.test(b.source.trim());
  return interviewOnly && b.kind === '事实' ? '访谈支持' : b.kind;
}

/** The recommendations: the new list, or an older summary's single recommendation as one (D63 §3.2). */
export function recommendationsOf(s: Pick<SummaryDraft, 'recommendations' | 'recommendation'>): ReportRecommendation[] {
  if (s.recommendations?.length) return s.recommendations;
  const r = s.recommendation;
  return r ? [{ title: r.action, how: r.scale, refs: [] }] : [];
}

/** The judgments a recommendation may stand on: the hypotheses (H1, H2-1) and the key questions (K3). */
const judgmentIds = (claims: ClaimResult[]) => [...claims.map((c) => c.label), ...new Set(claims.flatMap((c) => (c.claim.key ? [c.claim.key] : [])))];

/** Step 7 (T21): in a new report every recommendation cites a judgment of it; the problems go to the Summary repair. */
export function reportV2Problems(summary: SummaryDraft, claims: ClaimResult[]): string[] {
  if (!summary.reasons?.length) return [];
  return recommendationProblems(recommendationsOf(summary), judgmentIds(claims));
}

/**
 * So what → 为什么（三条支撑）→ 缺乏信息、需要另外验证的问题 → 对联想的建议 → 附录：过程和证据. The appendix holds the
 * older report as it was (its sections are what the self-check, the follow-up and the rewrite read); footnotes go on
 * from its numbers.
 */
export function renderReportV2(facts: ReportFacts, claims: ClaimResult[], summary: SummaryDraft, keyed: Map<string, Evidence>, v1: RenderedReport): RenderedReport {
  const unknownKeys = [...v1.unknownKeys];
  const notes = new Footnotes(footnotesIn(v1.body));
  const ex = (t: string) => {
    const x = expandCitations(t, keyed, notes);
    unknownKeys.push(...x.unknown);
    return oneLine(x.text);
  };
  // 复核 P8: the reader's So what carries no sub-question tag ([Q1] marks which answer a clause came from: the appendix keeps it)
  const soWhat = summary.so_what.replace(/\s*\[Q\d+(?:-\d+)?\]/g, '');
  const out: string[] = [`# ${facts.title} 调查报告 v${facts.version}`, '', V2_HEADINGS[0], '', `${ex(soWhat)}${facts.exploratory ? '（探索性结论：研究计划批准之前跑的）' : ''}`, ''];

  out.push(V2_HEADINGS[1], '');
  (summary.reasons ?? []).slice(0, 3).forEach((r, i) => {
    out.push(`${i + 1}. ${oneLine(r.title)}`);
    for (const b of r.basis) out.push(`   - ${basisKind(b, keyed)}：${ex(`${trimEndMark(b.text)}${b.refs.map((k) => `[${k}]`).join('')}`)}${b.source.trim() ? `（${oneLine(b.source)}）` : ''}`);
  });
  out.push('');

  out.push(V2_HEADINGS[2], '');
  const rows = keyGapRows(claims.map((c) => ({ key: c.claim.key, verdict: c.verdict })), summary.gaps ?? []);
  if (rows.length) out.push('| 问题 | 公开资料缺什么 | 怎么验证 |', '|---|---|---|', ...rows.map((g) => `| ${cell(ex(g.question))} | ${cell(ex(g.missing))} | ${cell(ex(g.how))} |`));
  else out.push('- 没有：每个关键问题都有公开资料能下判断。');
  out.push('');

  out.push(V2_HEADINGS[3], '');
  recommendationsOf(summary).forEach((r, i) => out.push(`${i + 1}. ${oneLine(r.title)}${r.how.trim() ? `：${ex(r.how)}` : ''}${r.refs.length ? `（依据 ${r.refs.join('、')}）` : ''}`));
  out.push('');

  // the older report under the appendix: without its title, its footnotes merged into one list at the end
  const lines = v1.body.trimEnd().split('\n');
  const fn = lines.indexOf(FOOTNOTE_HEADING);
  const old = lines.slice(1, fn < 0 ? undefined : fn);
  const oldNotes = fn < 0 ? [] : lines.slice(fn + 1).filter((l) => FOOTNOTE_DEF.test(l));
  out.push(V2_HEADINGS[4], '', '- 下面是这次调查的完整记录：怎么查的、逐个假设的判断和证据。', ...old);
  const defs = [...oldNotes, ...notes.lines()];
  out.push('', FOOTNOTE_HEADING, ...(defs.length ? defs : ['（没有引用）']));
  return { ...v1, body: `${out.join('\n')}\n`, unknownKeys };
}
