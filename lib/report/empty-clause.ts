/**
 * D-56 ⑦: in a report that has `citation_verify`, a footnote whose clause is empty — nothing before it but a label
 * (依据：/回答：/理由：…), a "（见 Q1 ①）" mark, a "[Q1]" tag, or nothing at all — is not drawn. What counts as a
 * clause's text is the run's text up to the footnote, back to the last sentence end (。；;！？, a cell's <br>);
 * citations and footnotes themselves contribute nothing. Pure: it reads a run and returns indexes only.
 */
import type { Inline } from '@/components/research/markdown-lite';

/** Text after the last sentence end (or <br>/newline, which a table cell's <br> becomes) starts a new clause. */
const CLAUSE_END = /[。；;！？\n]|<br\s*\/?>/gi;

/** A leading label of the clause, with its colon. */
const LEADING_LABEL = /^(?:依据|回答（一句话）|回答|理由|所以联想|So What|Q\d+(?:-\d+)? 的回答|Q\d+(?:-\d+)?\s*→)\s*[：:]?/;

/** A "（见 Q1 ①）" / "（靠 Q1 ②，待验证）" mark: it points elsewhere, it is not what the footnote backs. */
const CONDITION_MARK = /（[见靠] Q\d+(?:-\d+)*\s*[①-⑳]?(?:，待验证)?）/g;

/** A "[Q1②]" tag. */
const QUESTION_TAG = /\[Q\d+(?:-\d+)*\s*[①-⑳]?\]/g;

/** Whitespace and punctuation left over: none of it is content. */
const NOISE = /[\s，,。.；;：:、（）()]/g;

/** Whether a clause holds nothing but labels and noise. */
function isEmptyClause(text: string): boolean {
  return text.replace(LEADING_LABEL, '').replace(CONDITION_MARK, '').replace(QUESTION_TAG, '').replace(NOISE, '').length === 0;
}

/** The clause text after the last sentence end in `text`; the whole text when it holds none. */
function afterLastEnd(text: string): string {
  let last = 0;
  for (const m of text.matchAll(CLAUSE_END)) last = (m.index ?? 0) + m[0].length;
  return last ? text.slice(last) : text;
}

/** The indexes of the footnote nodes whose clause is empty, in order. */
export function emptyClauseFootnotes(inline: Inline[]): Set<number> {
  const out = new Set<number>();
  let clause = '';
  let prevFootnote = false;
  let prevEmpty = false;
  inline.forEach((node, index) => {
    if (node.kind === 'footnote') {
      // a footnote right after another one gets the same decision as that one
      if (!prevFootnote) prevEmpty = isEmptyClause(clause);
      if (prevEmpty) out.add(index);
      prevFootnote = true;
      return;
    }
    prevFootnote = false;
    switch (node.kind) {
      case 'text':
        clause += node.text;
        clause = afterLastEnd(clause);
        break;
      case 'bold':
      case 'code':
      case 'quote':
        clause += node.text;
        break;
      case 'link':
        clause += node.label;
        break;
      case 'citation':
        break;
    }
  });
  return out;
}
