/**
 * Senior's comments live in the body of a `review/<关卡> <日期>.md` note, one
 * per line, ending in a block marker `^mN` (docs/CONTRACTS.md §2.5):
 *
 *   - （Senior）[关于：Q2-1] 这里的假设没说明和决策的关系 ^m1
 *
 * Pure string helpers; no filesystem access.
 */

export interface ReviewComment {
  /** Block id, `m1`. */
  id: string;
  n: number;
  /** Role name that wrote it; '' when the line has no `（作者）` prefix. */
  author: string;
  /** What the comment is about (a section of the workplan), if given. */
  target?: string;
  text: string;
}

const COMMENT_LINE_RE = /^- (?:（([^）]+)）)?(?:\[关于：([^\]]+)\])?\s*(.*?)\s+\^m(\d+)\s*$/;

export const COMMENT_HEADING = '## Comment';

/** All comment lines of a review body, in order. Lines that are not comments are ignored. */
export function parseComments(body: string): ReviewComment[] {
  const out: ReviewComment[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = COMMENT_LINE_RE.exec(line);
    if (!m) continue;
    const n = Number(m[4]);
    out.push({ id: `m${n}`, n, author: m[1] ?? '', ...(m[2] ? { target: m[2] } : {}), text: m[3] });
  }
  return out;
}

export function nextCommentNumber(body: string): number {
  return parseComments(body).reduce((max, c) => Math.max(max, c.n), 0) + 1;
}

/** One line, no markers or newlines the parser could trip on. */
export function sanitizeCommentText(text: string): string {
  return text
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/\s+\^[A-Za-z0-9-]+\s*$/, '')
    .trim();
}

export function formatCommentLine(c: { n: number; author: string; text: string; target?: string }): string {
  const target = c.target ? `[关于：${c.target.replace(/[\]\r\n]/g, ' ').trim()}] ` : '';
  return `- （${c.author}）${target}${sanitizeCommentText(c.text)} ^m${c.n}`;
}

/** Add one comment line at the end of the body, under a `## Comment` heading (created if missing). */
export function appendCommentLine(body: string, line: string): string {
  const trimmed = body.replace(/\s+$/, '');
  const hasHeading = new RegExp(`^${COMMENT_HEADING}\\s*$`, 'm').test(trimmed);
  return `${trimmed}${hasHeading ? '\n' : `\n\n${COMMENT_HEADING}\n\n`}${line}\n`;
}

/** `[[20_项目/…/review/G1 2026-10-24#^m1]]` — what `workplan.changes[].comment` stores. */
export function commentLink(reviewPath: string, id: string): string {
  return `[[${reviewPath.replace(/\.md$/, '')}#^${id}]]`;
}

/** What a comment can be "about": the headings of the workplan, two to four levels deep (a question-tree workplan has `#### Q2-1`). */
export function commentTargets(workplanBody: string): string[] {
  return (workplanBody.match(/^#{2,4}\s+.+$/gm) ?? []).map((h) => h.replace(/^#+\s+/, '').trim());
}
