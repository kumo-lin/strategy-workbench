/**
 * Where a flagged sentence stands in a run of rendered text (a paragraph, a list item, a table cell), so a page can
 * put its mark at that sentence and not at the whole entry (D-48: citation_flags beside the footnote in that
 * sentence, length_flags beside each over-long item of a cell). Compared the way length_flags are (lengthKey):
 * footnote marks, evidence ids, quote marks, (推断), white space, a cell's `<br>` and `**` taken out; the sentence's
 * own end mark too (the report joins list items with "；" where the flag says "。"); condition and sub-question marks too.
 */

import { refKey } from './citation-flags';

/** A run of rendered text: text, or a footnote marker (by id). */
export type Part = { text: string } | { footnote: string };

// and what code writes for a condition or a sub-question: [Q1②] / [Q1 ②] / [Q3-1] as the model wrote them (a flag's
// text), "（见 Q2-1 ②，待验证）" / "（靠 Q1 ②，待验证）" / "（还缺证据）" as the report shows them (M1 验收 3: a length flag
// with [Q1②] in it matched nothing)
const DROPPED = /\[\^?\d+[!~]*\]|\[E\d+\]|[（(]推断[）)]|<br\s*\/?>|\*\*|\[Q\d+(?:-\d+)*\s*[①-⑳]?\]|（[见靠] Q\d+(?:-\d+)*\s*[①-⑳]?(?:，待验证)?）|（还缺证据）/g;
const DROPPED_CHAR = /[“”「」"'\s]/;
const END_MARKS = /[。；;，,！!？?：:]+$/;

/** The compared characters of `text`, each with its index in `text`. */
export function keyed(text: string): { key: string; at: number[] } {
  const drop = new Array<boolean>(text.length).fill(false);
  for (const m of text.matchAll(DROPPED)) for (let i = m.index; i < m.index + m[0].length; i++) drop[i] = true;
  let key = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (drop[i] || DROPPED_CHAR.test(text[i])) continue;
    key += text[i];
    at.push(i);
  }
  return { key, at };
}

/** A flagged sentence as compared: its end mark off. Very short ones never match. */
export const sentenceKey = (sentence: string) => keyed(sentence).key.replace(END_MARKS, '');

/** The run keyed: its text, and where each part starts in it. */
function runKey(parts: Part[]) {
  let key = '';
  const starts: number[] = [];
  const ats: number[][] = [];
  for (const p of parts) {
    starts.push(key.length);
    const k = 'text' in p ? keyed(p.text) : { key: '', at: [] };
    key += k.key;
    ats.push(k.at);
  }
  return { key, starts, ats };
}

function spans(key: string, sentence: string): { start: number; end: number }[] {
  const s = sentenceKey(sentence);
  if (s.length < 4) return [];
  const out: { start: number; end: number }[] = [];
  for (let i = key.indexOf(s); i >= 0; i = key.indexOf(s, i + 1)) out.push({ start: i, end: i + s.length });
  return out;
}

/**
 * For each footnote part, the flags that are it: its sentence is where the footnote stands (the footnote inside the
 * sentence or right after it), and it is the same evidence — the block link (`refOf`: the footnote's, as this version
 * numbers it; D-48 round 4: never by the footnote number alone), else, for a flag without one, the same footnote.
 * The same footnote elsewhere is not.
 */
export function footnoteFlags<F extends { id: string; sentence: string; ref?: string }>(parts: Part[], flags: F[], refOf: (id: string) => string = () => ''): Map<number, F[]> {
  const out = new Map<number, F[]>();
  if (!flags.length) return out;
  const { key, starts } = runKey(parts);
  const found = flags.map((f) => ({ f, ref: f.ref ? refKey(f.ref) : '', spans: spans(key, f.sentence) }));
  parts.forEach((p, i) => {
    if (!('footnote' in p)) return;
    const mine = refKey(refOf(p.footnote));
    const hits = found.filter(({ f, ref, spans }) => (ref ? ref === mine : f.id === p.footnote) && spans.some((s) => s.start <= starts[i] && starts[i] <= s.end)).map((h) => h.f);
    if (hits.length) out.set(i, hits);
  });
  return out;
}

/**
 * Where each sentence in the run ends: the part and the index in its text right after the sentence's last character
 * (each sentence's first place; one not in the run, none). The mark goes there, after any footnotes that follow.
 */
export function sentenceEnds<F>(parts: Part[], flags: { sentence: string; flag: F }[]): { part: number; offset: number; flag: F }[] {
  const { key, starts, ats } = runKey(parts);
  const out: { part: number; offset: number; flag: F }[] = [];
  for (const { sentence, flag } of flags) {
    const [s] = spans(key, sentence);
    if (!s) continue;
    const last = s.end - 1;
    let part = starts.length - 1;
    while (part > 0 && (starts[part] > last || ats[part].length === 0)) part--;
    out.push({ part, offset: ats[part][last - starts[part]] + 1, flag });
  }
  return out;
}
