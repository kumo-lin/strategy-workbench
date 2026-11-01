/**
 * Q-F (D-36): a number in a cited sentence must be in the original it cites. FACT measured team v3 at 52.8% strict
 * support against its stored blocks: [^4] wrote "CIO 12%、CTO 25%" over a block that only says "72%". check_citations
 * only proves the quote is verbatim; this check proves the sentence's numbers are in it. Deterministic, no model.
 *
 * What is a number here: digits (Arabic, full- or half-width) — percentages, amounts, multiples, counts, decimals.
 * Not checked:
 *   - years: a 4-digit 1900–2099 not followed by a unit or count word (2026, 2026–2027, 2026 年); dates (10 月 16 日,
 *     2026-10-16);
 *   - identifiers: digits joined to Latin letters (H1, E12, C2-Q5, v3, D-20, 3Q26, ISO27001, and the question tree's
 *     H2-1, Q3-2, Q2-1.1), a bare integer right after
 *     a Latin word (Windows 11, Microsoft 365), footnote markers, [[links]], §9.5, 第 3 段, list numbering (1);
 *   - text in quotation marks (“…” 「…」 『…』): it is the source's own words; what code writes about the evidence
 *     gate or a grade ("（已验证：2 个独立来源，最高 B 级）", "（C 级，网络）");
 *   - Chinese numerals (三成、两位数): not digits, out of reach of a deterministic check.
 * Which quote a number answers to: the footnote group that ends its clause (text since the last 。！？； or the previous
 * footnote group); in a table row, a cell without footnotes answers to the row's 出处 cell. Lines that hold no claims
 * (怎么查的, 本版变化, the appendix, 引文出处; the targets in 看什么指标 / 什么情况下要改) are not checked.
 * A card's ①②③ lines (D-48) are the plan's conditions and a status, written by code: only the note after the status
 * is checked. 改了什么 is not checked.
 * Comparison is by value, after normalising width, thousands separators and units (72% = 72 percent, 3000 万 = 30 million,
 * 1,223 = 1223); a quote's number rounded to the sentence's precision also counts (30.2 → 30).
 */
export interface NumberToken {
  raw: string;
  value: number;
  /** value × its unit (万 1e4, million 1e6 …); = value without a unit. */
  scaled: number;
}

export interface NumberMismatch {
  /** `## ` section it sits in. */
  section: string;
  /** `### H2 …` / `#### 假设 H2-1：…` hypothesis label, when inside a hypothesis' section. */
  claim: string | null;
  /** 1-based line in the body. */
  line: number;
  /** The clause the number is in. */
  text: string;
  number: string;
  /** Footnote ids the clause cites. */
  footnotes: string[];
}

/**
 * Web addresses out, before any check that reads keys or numbers in the text (WS-A full run: "%E6%96%BD%E5%B7%A5" in
 * a skipped page's address, in 怎么查的, read as the leaked evidence keys E5–E8; "8081", "404" in "…:8081/…" are not
 * data either). An address runs from http(s):// to the first space, non-ASCII character (the report's "：请求失败",
 * "；", "）") or closing bracket / quote.
 */
export const stripUrls = (s: string): string => s.replace(/https?:\/\/[^\s\u0080-￿<>"'\])]+/g, ' ');

/**
 * "Microsoft 365 E3", "M365 E5", "E7 Frontier Suite" (WS-A full run 报告 v3, H3-1's evidence table): an edition's
 * name, not an evidence key written without brackets. `before` / `after`: the text around the "E7".
 */
export const isEditionName = (before: string, after: string): boolean =>
  /(?:365|Microsoft|M365|O365|Office|Copilot|Windows|Azure|Dynamics|Entra|Intune)\s*$/i.test(before) || /^\s*[A-Za-z]{2,}/.test(after);

const FULL = '０１２３４５６７８９';
/** Full-width digits and signs to ASCII; thousands separators out of digit groups. */
export function normalizeNumbers(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String(FULL.indexOf(c)))
    .replace(/％/g, '%')
    .replace(/．/g, '.')
    .replace(/(\d)[,，](?=\d{3}(?!\d))/g, '$1');
}

const UNITS: [RegExp, number][] = [
  [/^万亿/, 1e12],
  [/^亿/, 1e8],
  [/^万/, 1e4],
  [/^千/, 1e3],
  [/^百万/, 1e6],
  [/^(?:trillion|tn)\b/i, 1e12],
  [/^(?:billion|bn)\b/i, 1e9],
  [/^B(?![A-Za-z])/, 1e9],
  [/^million\b/i, 1e6],
  [/^M(?![A-Za-z])/, 1e6],
  [/^(?:thousand)\b/i, 1e3],
  [/^[kK](?![A-Za-z])/, 1e3],
];
const COUNT_WORD = /^\s*(?:%|万|亿|千|百万|元|美元|欧元|家|人|个|名|台|次|倍|份|条|项|款|位|亿美元|万美元|percent|million|billion)/i;

/**
 * Digits that belong to a name, not a quantity (shared with the self-check's bare-number rule, selfcheck.ts):
 *   - joined to letters: H1, 3Q26, ISO27001, GPT4 (an "x" after is a multiplier: 3x)
 *   - an integer right after a Latin word, with no unit or count word after it: a product / version name
 *     (Windows 11, Microsoft 365, Agent 365, Fortune 500). "Copilot 3 个功能" is a count: 个 follows.
 */
export function isNameNumber(before: string, raw: string, after: string): boolean {
  if (/[A-Za-z]$/.test(before) || /[A-Za-z]-$/.test(before)) return true;
  // the rest of a question-tree label (D-39): the "1" of H2-1 / Q3-1, the "1.1" of Q2-1.1, the "2" of H2-1-A2's H2-1
  if (/[A-Za-z]\d+(?:[-.]\d+)*[-.]$/.test(before)) return true;
  const unit = UNITS.some(([re]) => re.test(after.trimStart()));
  if (!unit && /^[A-Za-z]/.test(after) && !/^(?:x|X)(?![A-Za-z])/.test(after)) return true;
  return !unit && /[A-Za-z][A-Za-z0-9+]*\s+$/.test(before) && !raw.includes('.') && !/^\s*x\b/.test(after) && !COUNT_WORD.test(after);
}

/**
 * Digits that number the report's own parts, not quantities (shared with the self-check's bare-number rule):
 *   - after a label: 论点 1, 假设 2, 子问题 3, 挑战 1、2 ("假设 3 个用户" is a count: 个 follows)
 *   - 第 N + 条/层/步/轮/…: 第 2 层, 第 1–2 步
 * (H1-A2 and the like are joined to letters: isNameNumber.)
 */
const ORDINAL_LABEL = /(?:论点|假设|子问题|问题|挑战|断言|方案|选项|阶段|步骤|情景|场景|路径|附录)\s*(?:\d+\s*(?:、|，|,|和|与|及|\/|–|—|-|~|～|至|到)\s*)*$/;
const ORDINAL_UNIT = /^\s*(?:条|层|步|轮|版|章|节|部分|点|项|段|阶段|周|期|批|个步骤|条规则)/;
export function isOrdinal(before: string, raw: string, after: string): boolean {
  if (raw.includes('.')) return false;
  // "问题 30 多家" is a count: an approximation word or a count word follows
  if (ORDINAL_LABEL.test(before) && !COUNT_WORD.test(after) && !/^\s*(?:多|余|来|几)/.test(after) && !UNITS.some(([re]) => re.test(after.trimStart()))) return true;
  return /第\s*(?:\d+\s*(?:、|，|,|和|与|及|–|—|-|~|～|至|到)\s*)*$/.test(before) && ORDINAL_UNIT.test(after.replace(/^\s*(?:(?:、|，|,|和|与|及|–|—|-|~|～|至|到)\s*\d+\s*)*/, ''));
}

/**
 * "每投入 1 美元" (the source: "for every dollar invested"): a 1 after 每 and before a unit or count word is the unit
 * itself, not a quantity.
 */
export function isUnitOne(before: string, raw: string, after: string): boolean {
  return raw === '1' && /每\s*(?:投入|花|花费|支出|付出|使用|部署|采购)?\s*$/.test(before) && (COUNT_WORD.test(after) || /^\s*(?:块|英镑|日元|小时|天|周|月|年|台设备|个用户|名用户|用户|席位|美金)/.test(after));
}

/**
 * What code writes at the top of a draft: "> ⚠ 自检没有通过，这份报告**没有交付**…" and its "> - …" list. A later
 * check of the draft (a page showing it, a re-check) must not read it as the report's text. Blanked, not removed, so
 * line numbers stay (the page marks flags by line).
 */
export function blankDraftBanner(body: string): string {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => /^> ⚠ 自检没有通过，这份报告\*\*没有交付\*\*/.test(l));
  if (at < 0) return body;
  for (let k = at; k < lines.length && /^>/.test(lines[k]); k++) lines[k] = '';
  return lines.join('\n');
}

/**
 * A row that answers a challenge: a 挑战 | 回应 table row, or a follow-up's "- 挑战[^n] → 假设要改：回应" line. The response may
 * repeat the challenge (its numbers, its words) and lean on any footnote of the row (the challenge's 出处 too).
 */
export interface ChallengeRow {
  challenge: string;
  response: string;
  /** Every footnote id on the line. */
  footnotes: string[];
}

const RESPONSE_HEAD = (raw: string) => /^\|\s*挑战\s*\|\s*回应\s*\|/.test(raw.trim()) || /^\s*- 逐条回应挑战：/.test(raw);
// the effect words: today's (D-39) and an older report's
const LISTED_RESPONSE = /^(.*?)→\s*(?:推翻了假设|假设要改|不影响判断|推翻|推不翻|收窄)[：:](.*)$/;

/** The challenge rows of a body, by 0-based line index (the scan responseProblems and numberMismatches share). */
export function challengeRows(lines: string[]): Map<number, ChallengeRow> {
  const out = new Map<number, ChallengeRow>();
  let inResponses = false;
  lines.forEach((raw, i) => {
    if (raw.startsWith('#')) {
      inResponses = false;
      return;
    }
    if (RESPONSE_HEAD(raw)) {
      inResponses = true;
      return;
    }
    const footnotes = [...new Set([...raw.matchAll(/\[\^(\d+)\]/g)].map((m) => m[1]))];
    const listed = inResponses && /^\s{4,}- /.test(raw) ? LISTED_RESPONSE.exec(raw.replace(/^\s*-\s*/, '')) : null;
    if (listed) {
      out.set(i, { challenge: listed[1], response: listed[2], footnotes });
      return;
    }
    if (!/^\s*\|/.test(raw)) {
      if (raw.trim()) inResponses = false;
      return;
    }
    if (!inResponses || /^\s*\|[\s|:-]+\|\s*$/.test(raw)) return;
    const cells = raw.trim().replace(/^\||\|$/g, '').split('|');
    out.set(i, { challenge: cells[0] ?? '', response: cells[1] ?? '', footnotes });
  });
  return out;
}

/** The hypothesis a heading opens: "### H2 …" (an older report), "### 假设 H1：…" / "#### 假设 H2-1：…" (a question tree). */
export function hypothesisOfHeading(raw: string): string | null {
  return /^###\s+(H\d+)\b/.exec(raw)?.[1] ?? /^#{3,4}\s+假设\s+(H\d+(?:-\d+)?)[：:\s]/.exec(raw)?.[1] ?? null;
}

/** A condition line of a hypothesis card (D-48): "  - ① <the plan's condition, word for word> → 不成立：（系统复核：…）<note>[^7]". */
const CONDITION_LINE = /^\s+-\s*[①-⑳]\s.*?\s→\s(?:成立|不成立|证据不足)(?:[：:]\s*(?:（系统复核：[^）]*）)?)?/;

/**
 * The part of a condition line that is a claim: the model's note after the status, with its footnotes ("" when there
 * is none); null when `raw` is not a condition line. The condition (the approved plan's words), the status and the
 * "（系统复核：…）" before the note are written by code.
 */
export function conditionNote(raw: string): string | null {
  const m = CONDITION_LINE.exec(raw);
  return m ? raw.slice(m[0].length) : null;
}

/** A year (1900–2099) with no unit or count word after it: a time point, not a quantity ("2000 名员工" is a quantity). */
export function isYear(raw: string, after: string): boolean {
  return /^(?:19|20)\d{2}$/.test(raw) && !COUNT_WORD.test(after);
}

/** The numbers of a text, identifiers / years / dates / quotations left out (see the rules above). */
export function numbersIn(input: string): NumberToken[] {
  let s = normalizeNumbers(stripUrls(input));
  s = s
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\^\d+\]/g, ' ')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』/g, ' ')
    // what code writes about the evidence gate: "（已验证：2 个独立来源，最高 B 级）", "（C 级，网络 · AI 定级）"
    .replace(/[（(](?:已验证|待验证)[：:][^）)]*[）)]/g, ' ')
    .replace(/[（(][ABC] 级[，,][^）)]*[）)]/g, ' ')
    .replace(/§\s*\d+(?:\.\d+)*/g, ' ')
    .replace(/第\s*\d+(?:\s*[、，,和与及–—~～至到-]\s*\d+)*/g, ' ') // 第 3, 第 1–2 (isOrdinal is the self-check's narrower rule)
    .replace(/[（(]\s*\d+\s*[）)]/g, ' ')
    .replace(/^\s*(?:[-*]\s+)?\d+[.、)]\s/, ' ')
    .replace(/\d{4}-\d{1,2}(?:-\d{1,2})?/g, ' ')
    .replace(/\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/g, ' ');
  const out: NumberToken[] = [];
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const at = m.index ?? 0;
    const before = s.slice(0, at);
    const after = s.slice(at + m[0].length);
    // part of a longer token: "1.5" seen from its "5"
    if (/[\d.]$/.test(before) && /\d\.?$/.test(before)) continue;
    // digits joined to letters / a hyphenated code, or a product / version name (Windows 11, Agent 365)
    if (isNameNumber(before, m[1], after)) continue;
    if (isUnitOne(before, m[1], after)) continue;
    if (isOrdinal(before, m[1], after)) continue;
    const unit = UNITS.find(([re]) => re.test(after.trimStart()));
    // a year, unless a unit or count word follows
    if (isYear(m[1], after)) continue;
    const value = Number(m[1]);
    out.push({ raw: m[1] + (after.match(/^\s*(?:%|万亿|亿|万|千|倍|percent|million|billion|bn|[kKMB](?![A-Za-z])|x(?![A-Za-z]))/i)?.[0].trim() ?? ''), value, scaled: value * (unit?.[1] ?? 1) });
  }
  return out;
}

const decimals = (n: number) => (String(n).split('.')[1] ?? '').length;
const roundTo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Is the sentence's number in the quote (by value or scaled value; the quote's rounded to the sentence's precision). */
export function numberInQuote(t: NumberToken, quote: NumberToken[]): boolean {
  const d = decimals(t.value);
  return quote.some((q) => q.value === t.value || q.scaled === t.scaled || roundTo(q.value, d) === t.value || (t.scaled !== t.value && roundTo(q.scaled / (t.scaled / t.value), d) === t.value));
}

const MARKER_GROUP = /(?:[（(]\s*)?\[\^\d+\](?:\s*[、，,]?\s*\[\^\d+\])*(?:\s*[）)])?/g;
const ids = (group: string) => [...group.matchAll(/\[\^(\d+)\]/g)].map((m) => m[1]);
/** The clauses of a text that end in a footnote group, each with its footnotes. */
export function citedClauses(text: string): { text: string; footnotes: string[] }[] {
  const out: { text: string; footnotes: string[] }[] = [];
  let prev = 0;
  for (const m of text.matchAll(MARKER_GROUP)) {
    const at = m.index ?? 0;
    // the sentence the group ends (its own closing 。 does not start a new, empty one)
    const chunk = text.slice(prev, at).replace(/[。！？；;\s]+$/, '');
    const cut = Math.max(...['。', '！', '？', '；', ';'].map((p) => chunk.lastIndexOf(p)));
    out.push({ text: chunk.slice(cut + 1).trim(), footnotes: ids(m[0]) });
    prev = at + m[0].length;
  }
  return out;
}

const SKIP_SECTION = /^(?:怎么查的|本版变化|附录|引文出处)/;
const TARGET_ROW = /^\|\s*(?:看什么指标|什么情况下要改)\s*\|/;
const EXEMPT_LINE = /^\s*-\s*(?:要回答的问题|提议的判断|v\d+ 的提议判断|系统复核|改了什么|所以联想|模型知识|缺口|要问专家|仍要问专家|追加调查（)/;

/**
 * Every number of `body` that is not in the original its clause cites. `quotes`: footnote id → the cited block's
 * original sentence (use the full block text, not the footnote's shortened display).
 */
export function numberMismatches(body: string, quotes: ReadonlyMap<string, string>): NumberMismatch[] {
  const out: NumberMismatch[] = [];
  const quoteNums = new Map<string, NumberToken[]>();
  const numsOf = (id: string) => {
    if (!quoteNums.has(id)) quoteNums.set(id, numbersInQuote(quotes.get(id) ?? ''));
    return quoteNums.get(id)!;
  };
  let section = '';
  let claim: string | null = null;
  const lines = blankDraftBanner(body).split('\n');
  const rows = challengeRows(lines);
  lines.forEach((raw, i) => {
    if (raw.startsWith('## ')) {
      section = raw.slice(3).trim();
      claim = null;
      return;
    }
    if (/^#{3,6} /.test(raw)) {
      claim = hypothesisOfHeading(raw);
      return;
    }
    if (SKIP_SECTION.test(section) || /^\[\^\d+\]:/.test(raw) || EXEMPT_LINE.test(raw) || TARGET_ROW.test(raw.trim()) || !/\[\^\d+\]/.test(raw)) return;
    // a response may repeat its challenge's numbers, and lean on any footnote of the row (the challenge's 出处 too)
    const row = rows.get(i);
    const rowPool = row ? [...row.footnotes.flatMap(numsOf), ...numbersInQuote(row.challenge.replace(/\[\^\d+\]/g, ' '))] : [];
    const check = (text: string, footnotes: string[]) => {
      if (!footnotes.length) return;
      const pool = [...footnotes.flatMap(numsOf), ...rowPool];
      for (const t of numbersIn(text)) {
        if (numberInQuote(t, pool) || out.some((m) => m.line === i + 1 && m.number === t.raw && m.footnotes.join() === footnotes.join())) continue;
        out.push({ section, claim, line: i + 1, text, number: t.raw, footnotes });
      }
    };
    if (/^\s*\|/.test(raw)) {
      if (/^\s*\|[\s|:-]+\|\s*$/.test(raw)) return;
      const cells = raw.trim().replace(/^\||\|$/g, '').split('|');
      // the Summary claims table: only 理由 is a claim (the statement is the plan's, the tally is counted by code)
      const last = cells[cells.length - 1].trim();
      const rowSource = /^(?:\s*\[\^\d+\]\s*)+$/.test(last) ? ids(last) : [];
      // (a question tree's table: | Q2-1 | H2-1 假设 | 判断 | 回答 | — the judgment, whose revision the author wrote, and the answer)
      const tree = /^\s*Q\d+(?:-\d+)?\s*$/.test(cells[0]);
      const checked = section === 'Summary' && (/^\s*H\d+\s/.test(cells[0]) || tree) ? (tree ? cells.slice(2) : [cells[2] ?? '']) : rowSource.length ? cells.slice(0, -1) : cells;
      for (const cell of checked) {
        const clauses = citedClauses(cell);
        if (clauses.length) for (const c of clauses) check(c.text, c.footnotes);
        else check(cell, rowSource);
      }
      return;
    }
    for (const c of citedClauses(conditionNote(raw) ?? raw)) check(c.text, c.footnotes);
  });
  return out;
}

/** "for every dollar", "per user", "each seat", "每台": the source says one unit, the report may write "1 美元". */
const ONE_UNIT = /\b(?:every|each|per|a|an)\s+(?:single\s+)?(?:dollar|euro|pound|yuan|rmb|user|seat|employee|worker|device|pc|hour|day|week|month|year)s?\b|每(?:一)?(?:美元|元|欧元|台|个|位|名|人|席位|用户|小时|天|周|月|年)/i;

/** A quote's numbers: everything with digits counts (it is the source's text: no identifier is left out but links). */
export function numbersInQuote(quote: string): NumberToken[] {
  const s = normalizeNumbers(quote.replace(/\[\[[^\]]*\]\]/g, ' '));
  const one = ONE_UNIT.test(s) ? [{ raw: '1', value: 1, scaled: 1 }] : [];
  const digits = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].flatMap((m) => {
    const at = m.index ?? 0;
    if (/\d\.?$/.test(s.slice(0, at))) return [];
    const after = s.slice(at + m[0].length).trimStart();
    const unit = UNITS.find(([re]) => re.test(after));
    const value = Number(m[1]);
    return [{ raw: m[1], value, scaled: value * (unit?.[1] ?? 1) }];
  });
  return [...one, ...digits];
}

// ── 回应 cells (Q-F item 2) ───────────────────────────────────────────────
//
// FACT: team v3's "不支持" sat in the 回应 column of the challenge tables: the footnote hung after the author's own
// inference ("把论点压到窄版本[^1]"), so the source only backed the challenge, never the inference. A response says
// what the source says (footnote right after that half), then "推断：" and the inference, without a footnote.

/** Words that make a clause the author's inference about the claim, not what a source says. */
const INFERENCE = /所以|因此|足以|不足以|压到|收窄|推翻|推不翻|削弱|意味着|论点|假设要改|不影响判断|只在.{1,20}成立/;

export interface ResponseProblem {
  line: number;
  claim: string | null;
  text: string;
  kind: 'inference_cited' | 'quote_not_in_source';
  footnotes: string[];
  /** For quote_not_in_source: the quoted words. */
  quoted?: string;
}

/** Of those, the ones a source can say itself: "…, meaning there isn't a shadow" is retold "因此没有影子 AI". */
const CONSEQUENCE = /^(?:所以|因此|意味着)$/;
const SOURCE_CONSEQUENCE = /\b(?:meaning|means that|therefore|thus|hence|consequently|as a result|which is why)\b|所以|因此|意味着|从而/i;

/**
 * Whether a cited clause is the author's own inference (M1's acceptance run 1 was kept a draft by a source's own
 * "meaning"). An inference word does not count when it is in quotation marks (someone else's words), when the
 * response retells the challenge the row answers (the word with two characters on each side is in the challenge: the
 * bare word is not enough, "修正后的论点应写成…" answering "论点假设的…" is still the author's), or, for a consequence
 * word, when the original the clause cites states a consequence itself. A 推断 label outside quotation marks always counts.
 */
function isAuthorInference(text: string, challenge: string, source: string): boolean {
  const own = text.replace(/[“「『][^”」』]*[”」』]/g, ' ');
  if (/推断/.test(own)) return true;
  const said = squash(challenge);
  return [...own.matchAll(new RegExp(INFERENCE.source, 'g'))].some((m) => {
    const at = m.index ?? 0;
    const retold = said.includes(squash(own.slice(Math.max(0, at - 2), at + m[0].length + 2)));
    return !retold && !(CONSEQUENCE.test(m[0]) && SOURCE_CONSEQUENCE.test(source));
  });
}

const squash = (s: string) => s.replace(/[\s，。、；：:,.;"'“”「」『』（）()]/g, '').toLowerCase();

/**
 * In the 回应 column of each 挑战 | 回应 table: a clause that ends in a footnote must not be the author's inference
 * (an inference word, or a 推断 label, before the footnote), and words it puts in quotation marks must be in the
 * original it cites.
 */
export function responseProblems(body: string, quotes: ReadonlyMap<string, string>): ResponseProblem[] {
  const out: ResponseProblem[] = [];
  const lines = blankDraftBanner(body).split('\n');
  const rows = challengeRows(lines);
  const claimAt: (string | null)[] = [];
  let claim: string | null = null;
  lines.forEach((raw) => {
    if (raw.startsWith('#')) claim = hypothesisOfHeading(raw) ?? (/^#{2,6} /.test(raw) ? null : claim);
    claimAt.push(claim);
  });
  // one problem per clause: an inference that carries a footnote; else words in quotation marks that are neither in
  // the originals of the row's footnotes nor in the challenge it answers (D-21-4 g: 「部分」 was the challenge's word)
  for (const [i, row] of rows) {
    const rowText = squash([...row.footnotes.map((f) => quotes.get(f) ?? ''), row.challenge.replace(/\[\^\d+\]/g, ' ')].join(' '));
    for (const c of citedClauses(row.response)) {
      const original = c.footnotes.map((f) => quotes.get(f) ?? '').join(' ');
      if (isAuthorInference(c.text, row.challenge, original)) {
        out.push({ line: i + 1, claim: claimAt[i], text: c.text, kind: 'inference_cited', footnotes: c.footnotes });
        continue;
      }
      const source = squash(original);
      const quoted = [...c.text.matchAll(/[“「『]([^”」』]{2,})[”」』]/g)].find((m) => !source.includes(squash(m[1])) && !rowText.includes(squash(m[1])));
      if (quoted) out.push({ line: i + 1, claim: claimAt[i], text: c.text, kind: 'quote_not_in_source', footnotes: c.footnotes, quoted: quoted[1] });
    }
  }
  return out;
}

/** The original sentence of a stored claim block (`「原文」— 位置：…` → 原文; an interview paragraph without emphasis). */
export function blockQuote(blockText: string): string {
  const t = blockText.replace(/\*\*|__/g, '').replace(/^\s*-\s*/, '').trim();
  return /^「([\s\S]*)」\s*[—–-]+\s*位置[:：]/.exec(t)?.[1].trim() ?? t;
}

/** Footnote id → its definition text, from `[^n]: …` lines. */
export function footnoteDefs(body: string): Map<string, string> {
  return new Map([...body.matchAll(/^\[\^(\d+)\]:\s*(.*)$/gm)].map((m) => [m[1], m[2]]));
}

/** One line for a reader: "H1 · 12%、25% 不在 [^4] 的原文里". */
export function describeMismatch(m: NumberMismatch): string {
  return `${m.claim ? `${m.claim} · ` : m.section ? `${m.section} · ` : ''}「${m.text.slice(0, 60)}」里的 ${m.number} 不在 ${m.footnotes.map((f) => `[^${f}]`).join('')} 的原文里`;
}

/** A marker group that may already carry display flags (`[^3!]`, `[^3~]`). */
const FLAGGED_GROUP = /(?:[（(]\s*)?\[\^\d+[!~]*\](?:\s*[、，,]?\s*\[\^\d+[!~]*\])*(?:\s*[）)])?/g;

/**
 * Display only (the report file is never changed): the body with the footnote markers of each flagged clause written
 * `[^n!]` (a number not in the original: "⚠ 数字未在引文中出现") or `[^n~]` (a footnote after an inference: "⚠ 推论挂了脚注").
 * The markers are the group right after the clause; a table cell without its own markers is flagged on the row's 出处 cell.
 */
function markFootnotes(body: string, clauses: { line: number; text: string; footnotes: string[] }[], flag: '!' | '~'): string {
  const lines = body.split('\n');
  for (const m of clauses) {
    const line = lines[m.line - 1];
    if (line === undefined) continue;
    const from = Math.max(0, m.text ? line.indexOf(m.text) : 0);
    let group: RegExpExecArray | null = null;
    for (const g of line.matchAll(FLAGGED_GROUP)) {
      if ((g.index ?? 0) >= from + Math.max(0, m.text.length - 1)) {
        group = g;
        break;
      }
    }
    if (!group) continue;
    const at = group.index ?? 0;
    const marked = group[0].replace(/\[\^(\d+)([!~]*)\]/g, (x, n: string, flags: string) => (m.footnotes.includes(n) && !flags.includes(flag) ? `[^${n}${flags}${flag}]` : x));
    lines[m.line - 1] = `${line.slice(0, at)}${marked}${line.slice(at + group[0].length)}`;
  }
  return lines.join('\n');
}

export const markNumberFlags = (body: string, mismatches: NumberMismatch[]): string => markFootnotes(body, mismatches, '!');

/** inference_cited flags (ResponseProblem of that kind), marked `[^n~]`. */
export const markInferenceFlags = (body: string, problems: ResponseProblem[]): string => markFootnotes(body, problems.filter((p) => p.kind === 'inference_cited'), '~');

/** A clause of the recommendation table with a number and no evidence footnote (D-48 round 5 A). */
export interface NumberNeedsEvidence {
  /** The row: "做什么", "对决策的回答" … */
  where: string;
  /** The clause as the report has it (since the last footnote group or 。；). */
  sentence: string;
  numbers: string[];
}

/**
 * Numbers in the recommendation table that no [E#] footnote covers (D-48 round 5 A): a clause that only says
 * "（见 Q2-1 ②）" points at a card, it cites nothing, and a number in it would read as one of unknown source. A number
 * is covered when its clause (since the last 。；！？, line break or footnote group) ends in a footnote group.
 * Not checked: 看什么指标 / 什么情况下要改 (targets and time points, as the other checks) and a 量级 marked as an
 * estimate ("怎么估的（推断）" / "（推断；估算依据：…）"). Marks only: the page puts ⚠ there, the report is not changed.
 */
export function numbersNeedingEvidence(body: string): NumberNeedsEvidence[] {
  const out: NumberNeedsEvidence[] = [];
  let inRec = false;
  for (const raw of body.split('\n')) {
    if (/^- AI 的推荐判断/.test(raw)) inRec = true;
    else if (inRec && !/^\s*\|/.test(raw) && raw.trim()) inRec = false;
    if (!inRec || !/^\s*\|/.test(raw) || /^\s*\|[\s|:-]+\|\s*$/.test(raw) || TARGET_ROW.test(raw.trim())) continue;
    const [label = '', ...rest] = raw.trim().replace(/^\||\|$/g, '').split('|');
    const where = label.trim();
    if (!where) continue;
    const cellText = rest.join('|');
    // a 量级 marked as an estimate needs no source (D-21-4 f), its basis included
    if (/怎么估的（推断）|（推断；估算依据/.test(cellText)) continue;
    for (const sentence of cellText.split(/<br\s*\/?>|[。；;！？!?]/)) {
      const groups = [...sentence.matchAll(MARKER_GROUP)];
      const tail = groups.length ? sentence.slice((groups.at(-1)!.index ?? 0) + groups.at(-1)![0].length) : sentence;
      const numbers = numbersIn(tail).map((t) => t.raw);
      const text = tail.replace(/^[，,、\s]+/, '').trim();
      if (numbers.length && text) out.push({ where, sentence: text, numbers });
    }
  }
  return out;
}
