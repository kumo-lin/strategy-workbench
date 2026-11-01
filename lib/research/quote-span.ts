/**
 * Quotes are whole sentences, and a quote shown in a report is cut by meaning, not by character count
 * (an external reviewer's scoring of 报告 v2: "…based on a survey of IT and s…" lost the 82.9%; "…used AI tools …" lost
 * "not permitted"; an ingested claim stopped at "AI funding increasingly coming from" and lost "outside of IT").
 *
 *   - `toFullSentence`: the model picks a stretch of the page; the system stores the whole sentence around it,
 *     taken from the same page text, so it is still verbatim and still passes check_citations.
 *   - `displayExcerpt`: when a stored sentence is too long for a report line, keep the clause that carries the
 *     number (or the longest clause) and grow around it clause by clause; the cut ends are marked "…".
 *     The excerpt is a contiguous stretch of the block, so the quote check still matches it.
 */
import { normalizeForQuote } from '@/lib/vault/blocks';

/** A stored sentence longer than this stays as the model picked it (a run-on page line, not a sentence). */
export const MAX_SENTENCE_CHARS = 400;
/** A quote in a report line longer than this is shown as an excerpt. */
export const MAX_DISPLAY_CHARS = 220;

const TERMINAL = new Set(['。', '！', '？', '!', '?']);
const CLOSERS = new Set(['”', '’', '"', "'", '」', '』', ')', '）', ']', '】']);

/** A sentence ends at 。！？!? , or at a '.' that is followed by a space, a closer or the end (not 82.9). */
function endsSentence(text: string, i: number): boolean {
  const c = text[i];
  if (TERMINAL.has(c)) return true;
  if (c !== '.') return false;
  const next = text[i + 1];
  return next === undefined || /\s/.test(next) || CLOSERS.has(next);
}

/** Where `quote` sits in `content`, compared the way check_citations compares (normalizeForQuote). */
export function locateQuote(content: string, quote: string): { start: number; end: number } | null {
  const q = normalizeForQuote(quote);
  if (!q) return null;
  let norm = '';
  const rawAt: number[] = [];
  for (let i = 0; i < content.length; ) {
    const cp = content.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const n = normalizeForQuote(ch);
    for (let k = 0; k < n.length; k++) rawAt.push(i);
    norm += n;
    i += ch.length;
  }
  const at = norm.indexOf(q);
  if (at < 0) return null;
  const last = rawAt[at + q.length - 1];
  return { start: rawAt[at], end: last + String.fromCodePoint(content.codePointAt(last)!).length };
}

/** The whole sentence of `content` that contains `quote`; the quote itself when it cannot be placed or the sentence is too long. */
export function toFullSentence(content: string, quote: string): string {
  const span = locateQuote(content, quote);
  if (!span) return quote;
  let s = span.start;
  while (s > 0 && content[s - 1] !== '\n' && !endsSentence(content, s - 1)) s--;
  while (s < span.start && (/\s/.test(content[s]) || CLOSERS.has(content[s]))) s++;
  let e = span.end;
  const endedAlready = e > 0 && endsSentence(content, e - 1);
  if (!endedAlready) {
    while (e < content.length && content[e] !== '\n' && !endsSentence(content, e)) e++;
    if (e < content.length && content[e] !== '\n') e++; // the terminal itself
  }
  while (e < content.length && CLOSERS.has(content[e])) e++;
  const sentence = content.slice(s, e).replace(/\s+/g, ' ').trim();
  return sentence.length > MAX_SENTENCE_CHARS || sentence.length < quote.trim().length ? quote : sentence;
}

/** Clauses with their delimiter kept at the end (，,；;：:). */
function clausesOf(text: string): string[] {
  return text.split(/(?<=[，,；;：:])/).filter((c) => c.length > 0);
}

const score = (clause: string) => (/\d/.test(clause) ? 1000 : 0) + clause.length;

/** A report-line excerpt of a long quote: the number-bearing (else the longest) clause, grown by neighbours while it fits. */
export function displayExcerpt(quote: string, max = MAX_DISPLAY_CHARS): string {
  if (quote.length <= max) return quote;
  const cl = clausesOf(quote);
  let anchor = 0;
  for (let i = 1; i < cl.length; i++) if (score(cl[i]) > score(cl[anchor])) anchor = i;
  let from = anchor;
  let to = anchor + 1;
  const len = () => cl.slice(from, to).join('').length;
  if (len() > max) {
    // one clause is already too long: keep the stretch from a little before its first number onwards
    const c = cl[anchor];
    const digit = c.search(/\d/);
    const startAt = digit < 0 ? 0 : Math.max(0, c.lastIndexOf(' ', Math.max(0, digit - 40)) + 1);
    let piece = c.slice(startAt, startAt + max);
    const cut = piece.lastIndexOf(' ');
    if (startAt + max < c.length && cut > max * 0.6) piece = piece.slice(0, cut);
    return `${from > 0 || startAt > 0 ? '…' : ''}${piece.trim()}${startAt + piece.length < c.length || to < cl.length ? '…' : ''}`;
  }
  // grow to the right first (the predicate and its object usually follow), then to the left
  for (;;) {
    if (to < cl.length && len() + cl[to].length <= max) to++;
    else if (from > 0 && len() + cl[from - 1].length <= max) from--;
    else break;
  }
  const body = cl.slice(from, to).join('').trim().replace(/[，,；;：:]$/, '');
  return `${from > 0 ? '…' : ''}${body}${to < cl.length ? '…' : ''}`;
}
