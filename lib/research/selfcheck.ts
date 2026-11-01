/**
 * Step 9 — the self-check before a report is delivered (PRD §6.3.1 step 9, §7 rule 13):
 *   - every [[note#^cN]] resolves to an existing block and the quote written before it
 *     matches the block (check_citations / vault.checkCitations — M0);
 *   - every block citation carries a quote at all (a bare link proves nothing);
 *   - every other [[link]] resolves;
 *   - a number without a source is flagged; inference is labelled;
 *   - the §8 structure is complete.
 * One failing item ⇒ the report is not delivered.
 */
import { normalizeForQuote } from '@/lib/vault/blocks';
import { extractWikiLinks } from '@/lib/vault/links';
import type { CitationCheck, Vault } from '@/lib/vault';
import { IMPACT_HEADING, OLD_IMPACT_HEADING } from './report-headings';
import { blankDraftBanner, conditionNote, isEditionName, isNameNumber, isOrdinal, isUnitOne, isYear, normalizeNumbers, stripUrls } from './number-check';

export type FailureCode =
  | 'note_not_found'
  | 'ambiguous'
  | 'block_not_found'
  | 'quote_mismatch'
  | 'missing_quote'
  | 'unresolved_link'
  | 'decision_without_quote'
  | 'unanswered_challenge'
  | 'unchecked_revision'
  | 'unknown_footnote'
  | 'incomplete_recommendation'
  /** D-64 T23 / T21: a recommendation of the new report cites no judgment of it. */
  | 'recommendation_without_judgment'
  | 'decision_quote_mismatch'
  | 'uncited_number'
  | 'number_not_in_quote'
  | 'inference_cited'
  | 'uncited_line'
  | 'unknown_evidence_key'
  | 'bare_evidence_key'
  | 'missing_section'
  | 'unlabeled_inference';

export interface CheckFailure {
  code: FailureCode;
  /** Human-readable, Chinese. */
  message: string;
  /** The claim the failure belongs to, when the check knows it (repair goes to that claim). */
  claimId?: string;
  /** The offending line / link, when there is one. */
  excerpt?: string;
  /** Number checks: the clause and its numbers (what number_flags records when the repair could not fix it). */
  clause?: string;
  numbers?: string[];
  /** inference_cited: the footnotes after the clause (what inference_flags records). */
  footnotes?: string[];
}

const CITE = /\[\[[^\]]+#\^[A-Za-z0-9-]+(?:\|[^\]]*)?\]\]/;

const REQUIRED_HEADINGS = ['## Summary', '## 怎么查的', '## 逐个假设', IMPACT_HEADING];
/** `- 反证` covers the old "- 反证：" and the new "- 反证和挑战（逐条回应）：". */
const REQUIRED_FIELDS = ['- 提议的判断：', '- 支持的证据：', '- 反证', '- 推导（推断）：'];

/** A question-tree report (D-39): its sub-questions are "## Q1 …" sections. */
const TREE_REPORT = /^## Q\d+ /m;
const TREE_HEADINGS = ['## Summary', '## 怎么查的', IMPACT_HEADING];
const TREE_FIELDS = ['- 提议的判断：', '- 理由：', '- So What：', '- 支持的证据：', '- 反证'];
/** What a question-tree Summary must say (D-39). */
const TREE_SUMMARY_LINES = ['- 核心问题：', '- 回答（一句话）：', '- 问题树：', '- 各子问题的回答：', '- 为什么这几个回答足以回答核心问题：'];
/** A hypothesis heading of a question-tree report: "### 假设 H1：…", "#### 假设 H2-1：…". */
const TREE_HYPOTHESIS = /^#{3,4} 假设 H\d+(?:-\d+)?[：:]/;
/** A hypothesis a small run did not reach: written by code. */
const NOT_RUN_LINE = /^\s*-\s*假设 H\d+(?:-\d+)?：.*（本次没有查（(?:试水|小)调查范围））\s*$/;

/** Lines made by the system (facts about the run) or labelled as questions / model knowledge: not claims about the world. */
const EXEMPT_LINE = /^\s*-\s*(?:要回答的问题|核心问题|问题树|回答问题所需的论点|提议的判断|系统复核|改了什么|所以联想|模型知识|缺口：|要问专家：|要问的专家[^：:]{0,4}[：:]|问专家[：:]|约访专家[：:]|调查计划|查了哪些地方|模式|追加调查（)/;

/**
 * Identifiers are not data: workstream / week / milestone codes (W3, W6–W7, S1–S4, M0), gate and
 * decision ids (G1, D-8, R4, H1, C1-Q2, P0), "Day-1", section numbers (§9.5, 第3周, 第 6 步),
 * versions (v2, v0.4), list numbering ((1), 2.) and evidence keys / block ids.
 */
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /\[\[[^\]]*\]\]/g,
  /\[\^\d+\]/g, // footnote markers
  /\bC\d+-Q\d+\b/g,
  /\bQ\d+(?:-\d+)?\.\d+\b/g, // 要查的问题 Q2-1.1 (D-39), before the generic code pattern
  /\bv\d+(?:\.\d+)*\b/gi, // before the generic code pattern: "v0.4" must go as a whole
  /\b[A-Za-z]{1,2}\d{1,2}(?:\s*[–—~\-～]\s*[A-Za-z]{0,2}\d{1,2})*\b/g, // W3, W6–W7, S1–S4, M0, G1, H1, E59, P0
  /\b[A-Za-z]{1,2}-\d{1,2}\b/g, // D-8
  /\bDay[ -]?\d+\b/gi,
  /§\s*\d+(?:\.\d+)*/g,
  /\^c\d+/g,
  /[（(]\s*\d+\s*[）)]/g, // (1) (2) list numbering
  /^\s*(?:[-*]\s+)?\d+[.、)]\s/, // "2. " at the start of a line
];

/**
 * What code writes when a recommendation leans on a 待验证 assertion (expandAssertionKeys): "「…」这条还没验证的判断（见
 * Q3-1）" (before 报告 v3: "待验证断言 H1-A4「…」"). The quote is the assertion's own text, whose numbers are checked where the
 * assertion is stated (with its citations).
 */
const ASSERTION_QUOTE = /(?:待验证|已验证)?断言\s*H\d+(?:-\d+)?-A\d+「[^」]*」|「[^」]*」这条(?:还没验证|已经验证)的判断（见 [QH]\d+(?:-\d+)?）/g;

/**
 * Digits that are not part of an identifier, a link, a name or an ordinal (the same rules as the number check:
 * isNameNumber, isOrdinal).
 * `timePoints`: a year is the proposal's own time point ("2026 年内进入商用产品线"), as in the number check (isYear);
 * only for the recommendation, where time points are proposals. In a claim about the world a year is data.
 */
interface BareNumberOptions {
  timePoints?: boolean;
  /** Years the approved plan itself states (planYears): the question's own time frame, not data from a source. */
  planYears?: ReadonlySet<string>;
}

export function hasBareNumber(line: string, opts: BareNumberOptions = {}): boolean {
  return bareNumbers(line, opts).length > 0;
}

/**
 * The years and year ranges the approved plan states, as the report shows them: the question ("- 要回答的问题："),
 * the claims (the Summary table's statement cell, the "### H1 …" headings). "2026–2027 年" in a revised hypothesis is
 * the plan's time frame (D-21-4 g), not a number that needs a source.
 */
export function planYears(body: string): Set<string> {
  const out = new Set<string>();
  let section = '';
  for (const raw of body.split('\n')) {
    if (raw.startsWith('## ')) section = raw.slice(3).trim();
    // (a question tree: the core question, the tree, the sub-questions and hypotheses as headings, the Summary table's first two cells)
    const planText =
      /^\s*-\s*(?:要回答的问题|核心问题|问题树)[：:]/.test(raw) || /^### H\d+/.test(raw) || /^#{2,3} Q\d+(?:-\d+)? /.test(raw) || TREE_HYPOTHESIS.test(raw)
        ? raw
        : section === 'Summary' && /^\|\s*H\d+\s/.test(raw)
          ? (raw.split('|')[1] ?? '')
          : section === 'Summary' && /^\|\s*Q\d+(?:-\d+)?\s*\|/.test(raw)
            ? raw.split('|').slice(1, 3).join(' ')
            : '';
    for (const m of planText.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)) out.add(m[0]);
  }
  return out;
}

/** The bare numbers themselves (hasBareNumber's rule). */
export function bareNumbers(line: string, opts: BareNumberOptions = {}): string[] {
  let stripped = stripUrls(line).replace(ASSERTION_QUOTE, ' ');
  for (const re of IDENTIFIER_PATTERNS) stripped = stripped.replace(re, ' ');
  stripped = normalizeNumbers(stripped.replace(/[（(][^）)]*[）)]/g, (m) => (/[ABC] 级/.test(m) ? '' : m)));
  const out: string[] = [];
  for (const m of stripped.matchAll(/\d+(?:\.\d+)?/g)) {
    const at = m.index ?? 0;
    const after = stripped.slice(at + m[0].length);
    if (opts.timePoints && isYear(m[0], after)) continue;
    if (opts.planYears?.has(m[0]) && isYear(m[0], after)) continue;
    if (isUnitOne(stripped.slice(0, at), m[0], after)) continue;
    if (isOrdinal(stripped.slice(0, at), m[0], after)) continue;
    if (!isNameNumber(stripped.slice(0, at), m[0], after)) out.push(m[0]);
  }
  return out;
}

export function citationFailures(results: CitationCheck[]): CheckFailure[] {
  const out: CheckFailure[] = [];
  for (const r of results) {
    if (!r.ok && r.error) {
      const msg = {
        note_not_found: '引用的资料不存在',
        ambiguous: '资料名有歧义，需要写完整路径',
        block_not_found: '引用的块不存在',
        quote_mismatch: '引号里的原文和资料里的那一块对不上',
      }[r.error];
      out.push({ code: r.error, message: `${msg}：${r.link}`, excerpt: r.quote ?? r.link });
    } else if (r.ok && !r.quote) {
      out.push({ code: 'missing_quote', message: `引用没有写出原文（引用必须是“原文” + 链接）：${r.link}`, excerpt: r.link });
    }
  }
  return out;
}

const FOOTNOTE_MARK = /\[\^(\d+)\](?!:)/g;
const FOOTNOTE_DEF_LINE = /^\[\^(\d+)\]:\s*(.*)$/;

/**
 * A decision is cited by its quote and its note: a decision note has no blocks (N1: the [W#] footnotes code writes for
 * the recommendation's directive row were flagged "没有写出原文和块链接", 2 of 4 live small runs). Its quote is
 * checked against the note by decisionFailures.
 */
const DECISION_CITE = /^“[^”]+”（决定）\[\[[^\]#|]+(?:\|[^\]]*)?\]\]\s*$/;

/** Footnote numbers whose definition carries a block citation (verified by check_citations) or a decision's quote (decisionFailures). */
function citingFootnotes(body: string): { all: Set<number>; citing: Set<number> } {
  const all = new Set<number>();
  const citing = new Set<number>();
  for (const line of body.split('\n')) {
    const m = FOOTNOTE_DEF_LINE.exec(line);
    if (!m) continue;
    all.add(Number(m[1]));
    if (CITE.test(m[2]) || DECISION_CITE.test(m[2])) citing.add(Number(m[1]));
  }
  return { all, citing };
}

/** A line is cited when it carries a block citation, or a footnote marker whose definition does. */
function isCited(line: string, citing: Set<number>): boolean {
  if (CITE.test(line)) return true;
  for (const m of line.matchAll(FOOTNOTE_MARK)) if (citing.has(Number(m[1]))) return true;
  return false;
}

/** The recommendation's 量级 row may carry an estimate without a source, if it says it is one and how it was made. */
const INFERRED_SCALE = /推断[；;，,]\s*估算依据[：:](?!\s*没有写)\S|怎么估的（推断）[：:](?!\s*没有写)\S/;

/**
 * An evidence key left bare in the text ("E7" with no brackets). Code already turns a bare key of the claim into its
 * footnote (expandCitations); what is left is a guess from a pattern (报告 v3: "E7 Frontier Suite", Microsoft's
 * edition, while this run also had an E7). Edition names are not keys (isEditionName); a key still found is flagged
 * (key_flags), never a reason to keep the report a draft, and not sent to the repair round (it could rewrite a name).
 * `issuedKeys`: the keys that existed in this run; a bare "E3" that was not one is not a key at all.
 */
export function bareKeyFailures(text: string, issuedKeys?: ReadonlySet<string>): CheckFailure[] {
  const out: CheckFailure[] = [];
  const seen = new Set<string>();
  // "[E59]" left unexpanded is the bracket check's (it blocks: that one is certain), not a bare key
  const prose = text.replace(/[\[【]\s*E\d+[^\]】\n]*[\]】]/g, (m) => ' '.repeat(m.length));
  for (const m of prose.matchAll(/(?<![A-Za-z0-9])E\d{1,3}(?![A-Za-z0-9])/g)) {
    const key = m[0];
    const at = m.index ?? 0;
    if (seen.has(key) || (issuedKeys && !issuedKeys.has(key))) continue;
    if (isEditionName(prose.slice(Math.max(0, at - 20), at), prose.slice(at + key.length, at + key.length + 20))) continue;
    seen.add(key);
    const clause = prose.slice(Math.max(0, at - 30), at + key.length + 30).replace(/\s*\n\s*/g, ' ').trim();
    out.push({ code: 'bare_evidence_key', message: `正文里直接写了 ${key}，像是没有转成脚注的证据编号：「${clause}」`, excerpt: key, clause });
  }
  return out;
}

/** Pure checks on the report text. */
/** `issuedKeys`: the evidence keys that existed in this run; a bare "E3" is only a leaked key if it was one (otherwise it may be a product name, e.g. Microsoft 365 E3). */
export function checkReportText(text: string, unknownKeys: string[] = [], issuedKeys?: ReadonlySet<string>): CheckFailure[] {
  const failures: CheckFailure[] = [];
  // a draft's code-written banner ("自检没有通过…") is not the report's text (D-21-4 g)
  const body = blankDraftBanner(text);
  const years = planYears(body);
  const isTree = TREE_REPORT.test(body);

  for (const h of isTree ? TREE_HEADINGS : REQUIRED_HEADINGS) {
    const ok = (x: string) => new RegExp(`^${x}\\s*$`, 'm').test(body);
    if (!ok(h) && !(h === IMPACT_HEADING && ok(OLD_IMPACT_HEADING))) failures.push({ code: 'missing_section', message: `缺少“${h.replace('## ', '')}”一节` });
  }
  const firstH2 = /^## (.+)$/m.exec(body)?.[1];
  // D-64 T23: a report in the fixed structure opens with So what (the older sections follow in its appendix)
  if (firstH2 && firstH2.trim() !== 'Summary' && firstH2.trim() !== 'So what') failures.push({ code: 'missing_section', message: 'Summary 必须放在最前面' });

  for (const m of body.matchAll(/[\[【]\s*E\d+[^\]】]*[\]】]/g)) failures.push({ code: 'unknown_evidence_key', message: `证据编号没有展开成引用：${m[0]}`, excerpt: m[0] });
  // A bare "E3" outside links and quotes is an evidence key the model wrote without brackets: meaningless to a reader.
  // a web address is not prose: "%E5%B7%A5" in it is not the key E5
  const prose = stripUrls(body.replace(/\[\[[^\]]*\]\]/g, '').replace(/“[^”]*”/g, ''));
  failures.push(...bareKeyFailures(prose, issuedKeys));
  for (const k of new Set(unknownKeys)) failures.push({ code: 'unknown_evidence_key', message: `引用了不存在的证据编号 [${k}]`, excerpt: k });

  const lines = body.split('\n');
  const { all: footnoteIds, citing } = citingFootnotes(body);
  for (const m of new Set([...body.matchAll(FOOTNOTE_MARK)].map((x) => Number(x[1])))) {
    if (!footnoteIds.has(m)) failures.push({ code: 'unknown_footnote', message: `角标 [^${m}] 没有对应的脚注`, excerpt: `[^${m}]` });
  }
  for (const n of footnoteIds) if (!citing.has(n)) failures.push({ code: 'missing_quote', message: `脚注 [^${n}] 没有写出原文和块链接`, excerpt: `[^${n}]` });

  let section = '';
  let hypo: { title: string; text: string[] } | null = null;
  const hypos: { title: string; text: string[] }[] = [];
  let sub: '支持' | '反证' | null = null;
  let inRecommendation = false;

  for (const raw of lines) {
    if (raw.startsWith('## ')) {
      section = raw.slice(3).trim();
      hypo = null;
      sub = null;
      inRecommendation = false;
      continue;
    }
    if (isTree ? /^#{3,6} /.test(raw) : raw.startsWith('### ')) {
      // a question tree: only "### 假设 H1：" / "#### 假设 H2-1：" open a hypothesis ("### Q2-1 …", "### Q1 的回答" do not)
      hypo = !isTree || TREE_HYPOTHESIS.test(raw) ? { title: raw.replace(/^#+\s*/, '').trim(), text: [] } : null;
      if (hypo) hypos.push(hypo);
      sub = null;
      continue;
    }
    if (raw.startsWith('#')) continue;
    hypo?.text.push(raw);
    // 怎么查的, 本版变化 and the appendix are facts written by code (counts, ids, the owner's own focus words), not claims about the world
    if (section === '怎么查的' || section.startsWith('本版变化') || section.startsWith('附录') || section === '引文出处') continue;
    if (!raw.trim()) continue;
    if (isTree && NOT_RUN_LINE.test(raw)) continue;

    if (/^- 支持的证据：/.test(raw)) sub = '支持';
    else if (/^- 反证/.test(raw)) sub = '反证';
    else if (/^- /.test(raw)) sub = null;
    if (/^- AI 的推荐判断/.test(raw)) inRecommendation = true;
    else if (/^- /.test(raw) || /^以上全部是 AI 提议/.test(raw)) inRecommendation = false;

    const isTableRow = /^\s*\|/.test(raw);
    const isTableRule = isTableRow && /^\s*\|[\s|:-]+\|\s*$/.test(raw);
    if (isTableRule) continue;
    const isHeaderRow = isTableRow && /^\|\s*(?:论断|挑战|论点)?\s*\|\s*(?:关键数字|回应|提议的判断|提议)\s*\|/.test(raw);
    // the claims table in Summary: the statement (approved plan) and the evidence tally (counted by code) are not claims; the reason is
    let checked = raw;
    if (section === 'Summary' && isTableRow && /^\|\s*H\d+\s/.test(raw)) checked = raw.split('|')[3] ?? '';
    // a question tree's: | Q2-1 | H2-1 假设 | 判断 | 回答 | — the judgment and the answer (D-48)
    if (section === 'Summary' && isTableRow && /^\|\s*Q\d+(?:-\d+)?\s*\|/.test(raw)) checked = raw.split('|').slice(3).join('|');
    // a card's ①②③ (D-48): the plan's condition and the status are not claims; the note after the status is
    checked = conditionNote(raw) ?? checked;
    if (isHeaderRow) continue;

    const isSubLine = /^\s{2,}- /.test(raw) || (isTableRow && sub !== null);
    if (isSubLine && sub && !raw.includes('（无）')) {
      const noneFound = sub === '反证' && /没有找到|未找到|没有发现/.test(raw) && !hasBareNumber(raw, { planYears: years });
      if (!isCited(raw, citing) && !noneFound) failures.push({ code: 'uncited_line', message: `${sub === '支持' ? '支持的证据' : '反证'}里有一条没有出处：${raw.trim().slice(0, 80)}`, excerpt: raw.trim() });
    }

    // 量级 marked as an estimate; 指标 / 什么情况下要改 hold proposed targets and time points ("1 周内", "多数受访者"), not facts
    const estimate = inRecommendation && isTableRow && (INFERRED_SCALE.test(raw) || /^\|\s*(看什么指标|什么情况下要改)\s*\|/.test(raw));
    const bare = bareNumbers(checked, { timePoints: inRecommendation && isTableRow, planYears: years });
    if (!isCited(checked, citing) && !isCited(raw, citing) && !EXEMPT_LINE.test(raw) && !estimate && bare.length) {
      failures.push({
        code: 'uncited_number',
        clause: checked.trim(),
        numbers: bare,
        message: inRecommendation
          ? `推荐判断里这一行有数字但没有出处：${raw.trim().slice(0, 80)}（没有证据的估算只能写在“量级”里，并标“推断”、写出估算依据）`
          : `这一行有数字但没有出处：${raw.trim().slice(0, 80)}`,
        excerpt: raw.trim(),
      });
    }
  }

  for (const h of hypos) {
    const text = h.text.join('\n');
    for (const f of isTree ? TREE_FIELDS : REQUIRED_FIELDS) {
      if (!text.includes(f)) failures.push({ code: f.includes('推导') ? 'unlabeled_inference' : 'missing_section', message: `“${h.title.slice(0, 30)}”缺少“${f.replace('- ', '').replace('：', '')}”` });
    }
  }
  if (hypos.length === 0) failures.push({ code: 'missing_section', message: isTree ? '问题树下面没有任何假设' : '“逐个假设”下没有任何假设' });
  if (isTree) failures.push(...treeReportFailures(body));
  return failures;
}

/**
 * The question tree's report checks (D-39): the Summary says the core question, the assembled answer, the tree, each
 * sub-question's answer and why they are enough; every top-level sub-question ("## Q2 …") ends with its answer
 * ("### Q2 的回答" and the answer under it); every lowest-level sub-question split from one ("### Q2-1 …") has its
 * answer line ("- Q2-1 的回答："), which code writes from its hypothesis' judgment (D-39 2b).
 */
export function treeReportFailures(body: string): CheckFailure[] {
  const out: CheckFailure[] = [];
  const lines = body.split('\n');
  const summary = (() => {
    const at = lines.findIndex((l) => l.trim() === '## Summary');
    const end = lines.findIndex((l, k) => k > at && l.startsWith('## '));
    return at < 0 ? [] : lines.slice(at, end < 0 ? lines.length : end);
  })();
  for (const label of TREE_SUMMARY_LINES) {
    const line = summary.find((l) => l.startsWith(label));
    const rest = line?.slice(label.length).trim() ?? '';
    if (!line || (label !== '- 各子问题的回答：' && (!rest || rest === '（没有写）'))) out.push({ code: 'missing_section', message: `Summary 缺少“${label.replace(/^- |：$/g, '')}”` });
  }
  lines.forEach((raw, i) => {
    // a lowest-level sub-question split from a top-level one: its answer line, written by code from its hypothesis
    const leaf = /^### (Q\d+-\d+) /.exec(raw)?.[1];
    if (leaf) {
      let stop = lines.findIndex((l, k) => k > i && /^#{2,3} /.test(l));
      if (stop < 0) stop = lines.length;
      const line = lines.slice(i + 1, stop).find((l) => l.startsWith(`- ${leaf} 的回答：`));
      if (!line?.slice(`- ${leaf} 的回答：`.length).trim()) out.push({ code: 'missing_section', message: `子问题 ${leaf} 没有回答（“- ${leaf} 的回答：”这一行）` });
      return;
    }
    const q = /^## (Q\d+) /.exec(raw)?.[1];
    if (!q) return;
    let end = lines.findIndex((l, k) => k > i && l.startsWith('## '));
    if (end < 0) end = lines.length;
    const at = lines.findIndex((l, k) => k > i && k < end && l.trim() === `### ${q} 的回答`);
    const answer = at < 0 ? '' : (lines.slice(at + 1, end).find((l) => l.trim() && !l.startsWith('#')) ?? '').trim();
    if (!answer) out.push({ code: 'missing_section', message: `子问题 ${q} 没有回答（“### ${q} 的回答”下面要写出回答）` });
  });
  return out;
}

/** Plain [[links]] (plan, workplan, hypothesis) must resolve. */
export async function linkFailures(vault: Vault, body: string, fromPath?: string): Promise<CheckFailure[]> {
  const out: CheckFailure[] = [];
  const seen = new Set<string>();
  for (const l of extractWikiLinks(body)) {
    if (l.block || seen.has(l.raw)) continue;
    seen.add(l.raw);
    const r = await vault.resolveLink(l, fromPath);
    if (!r.ok) out.push({ code: 'unresolved_link', message: `链接找不到笔记：${l.raw}`, excerpt: l.raw });
  }
  return out;
}

/**
 * A decision cited in a report is cited with its words: “quote” + [[decision]], the quote taken from the decision
 * note itself. A bare link to a decision proves nothing about what it says (5.0 run-through 3.19).
 * Block links are left to check_citations; `text` can be the whole report or only the lines written now.
 */
export async function decisionFailures(vault: Vault, text: string, fromPath?: string): Promise<CheckFailure[]> {
  const out: CheckFailure[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  for (const l of extractWikiLinks(text)) {
    const at = text.indexOf(l.raw, cursor);
    if (at >= 0) cursor = at + l.raw.length;
    if (l.block || at < 0) continue;
    const res = await vault.resolveLink(l, fromPath);
    if (!res.ok) continue;
    const note = await vault.read(res.path).catch(() => null);
    if (!note || note.data.type !== 'decision') continue;
    const before = text.slice(Math.max(0, at - 400), at);
    const qm = /(?:“([^”]+)”|"([^"]+)"|「([^」]+)」)\s*(?:[（(][^）)]*[）)])?\s*$/.exec(before);
    const quote = qm ? (qm[1] ?? qm[2] ?? qm[3]) : undefined;
    const key = `${l.raw}|${quote ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!quote) out.push({ code: 'decision_without_quote', message: `引用的决定没有写出原文（引用决定必须是“原文” + 链接）：${l.raw}`, excerpt: l.raw });
    else if (!normalizeForQuote(note.body).includes(normalizeForQuote(quote))) out.push({ code: 'decision_quote_mismatch', message: `引号里的原文和决定笔记里的内容对不上：${l.raw}`, excerpt: l.raw });
  }
  return out;
}

/**
 * Words the D-39 用词对照表 replaced (WORDING_RULES in the prompts), as the model may still write them (报告 v3: "修正论点
 * 1～4" in 对workplan的影响, "层面", "落点"). Single characters (故、即、均、尚) are left out: too common to count.
 */
export const OLD_WORDS = ['论点', '需要修正', '收窄', '推不翻', '窄版本', '压到', '切小', '撑不住', '站不住', '削弱', '门槛', '入围', '资格线', '收口', '口径', '叙事', '落点', '层面', '闭环', '方向性判断', '恰恰', '据此', '这一层', '这一环'] as const;

/**
 * The old words in a question-tree report's own prose: a log line each, never a check that keeps the report a draft.
 * Not counted: quotations and source text (“…”「…」, footnote definitions), links and addresses, the approved plan's
 * own words (headings, the core question, the tree, the hypotheses' rows), and the sections code writes from the plan
 * and the run (怎么查的, 本版变化, 附录).
 */
export function oldWordingHits(body: string): { word: string; count: number; example: string }[] {
  const hits = new Map<string, { word: string; count: number; example: string }>();
  let section = '';
  for (const raw of blankDraftBanner(body).split('\n')) {
    if (raw.startsWith('## ')) section = raw.slice(3).trim();
    if (raw.startsWith('#') || /^\[\^\d+\]:/.test(raw)) continue;
    // the plan's own words, copied by code: the core question, the tree, the hypotheses' row (sub-question, statement)
    if (/^\s*-\s*(?:核心问题|要回答的问题|问题树)[：:]/.test(raw) || /^\|\s*Q\d+(?:-\d+)?\s*\|/.test(raw)) continue;
    if (section === '怎么查的' || section.startsWith('本版变化') || section.startsWith('附录') || section === '引文出处') continue;
    const prose = stripUrls(raw.replace(/\[\[[^\]]*\]\]/g, ' ').replace(/“[^”]*”|「[^」]*」|『[^』]*』/g, ' '));
    for (const word of OLD_WORDS) {
      const n = prose.split(word).length - 1;
      if (!n) continue;
      const h = hits.get(word) ?? { word, count: 0, example: '' };
      h.count += n;
      if (!h.example) {
        const at = prose.indexOf(word);
        h.example = prose.slice(Math.max(0, at - 20), at + word.length + 20).trim();
      }
      hits.set(word, h);
    }
  }
  return [...hits.values()];
}

export function describeFailures(failures: CheckFailure[]): string[] {
  return failures.map((f) => f.message);
}

/**
 * The text rules for lines written NOW (a follow-up appends to a report that was already delivered, possibly
 * edited by hand): a number without a source, a leaked evidence key. The old text is not re-judged — only its
 * citations are re-verified (check_citations), which is cheap and absolute.
 */
/** `body`: the whole new report, so a footnote marker in a new line counts as cited when its definition carries a block citation. */
export function checkNewLines(lines: string[], issuedKeys?: ReadonlySet<string>, body = ''): CheckFailure[] {
  const out: CheckFailure[] = [];
  const years = planYears(body);
  const { all, citing } = citingFootnotes(body);
  for (const raw of lines) {
    if (!raw.trim() || raw.startsWith('#')) continue;
    for (const m of raw.matchAll(FOOTNOTE_MARK)) {
      if (!all.has(Number(m[1]))) out.push({ code: 'unknown_footnote', message: `角标 [^${m[1]}] 没有对应的脚注`, excerpt: `[^${m[1]}]` });
    }
    const bare = isCited(raw, citing) || EXEMPT_LINE.test(raw) ? [] : bareNumbers(raw, { planYears: years });
    if (bare.length) out.push({ code: 'uncited_number', message: `这一行有数字但没有出处：${raw.trim().slice(0, 80)}`, excerpt: raw.trim(), clause: raw.trim(), numbers: bare });
    const prose = stripUrls(raw.replace(/\[\[[^\]]*\]\]/g, '').replace(/“[^”]*”/g, ''));
    out.push(...bareKeyFailures(prose, issuedKeys));
    if (/[\[【]\s*E\d+[^\]】\n]*[\]】]/.test(raw)) out.push({ code: 'unknown_evidence_key', message: '证据编号没有展开成引用', excerpt: raw.trim() });
  }
  return out;
}
