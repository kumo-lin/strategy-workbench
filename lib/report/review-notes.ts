/**
 * A report's `review_notes` (frontmatter): what a person found checking the report by hand — a footnote that cites
 * the wrong document, two passages that disagree. Not a problem with a source (that is source_warnings). Pages show
 * them under "人工核对注": a note with footnotes beside those footnotes ("⚠ 见核对注") and in the box above Summary;
 * a note without footnotes at the top of the section `where` names (above Summary when none matches). The report
 * file is not changed. Items that do not match the schema are left out; a report without the field has none.
 */
import { reportReviewNoteSchema, type ReportReviewNote } from '@/lib/notes/schema';

export type { ReportReviewNote };

export function readReviewNotes(data: Record<string, unknown>): ReportReviewNote[] {
  const v = data.review_notes;
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    const r = reportReviewNoteSchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}

/** Footnote id (or plain-mode `[n]` number) → the notes that name it, one per line (the "⚠ 见核对注" tag's title). */
export function notedFootnotes(notes: ReportReviewNote[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of notes ?? []) for (const f of n.footnotes ?? []) m.set(f, m.has(f) ? `${m.get(f)}\n${n.note}` : n.note);
  return m;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A heading is the one a part of `where` names: the same text, or that text and then its title ("Q2-1 「可管」…", "假设 H2-1：…"). */
function names(part: string, heading: string): boolean {
  const p = norm(part);
  const h = norm(heading);
  if (!p) return false;
  return h === p || (h.startsWith(p) && /^[\s：:、，,（(]/.test(h.slice(p.length)));
}

/** The index of the heading `where` points at: its most specific part first ("推荐判断 · 量级" tries 量级, then 推荐判断). */
export function headingFor(where: string | undefined, headings: string[]): number | null {
  if (!where) return null;
  for (const part of where.split(/\s*·\s*/).reverse()) {
    const i = headings.findIndex((h) => names(part, h));
    if (i >= 0) return i;
  }
  return null;
}

/**
 * Where each note shows. `top`: the box above Summary — the notes with footnotes, and those whose `where` names no
 * heading; `at`: heading index (in `headings`' order) → the notes shown right under that heading.
 */
export function placeReviewNotes(notes: ReportReviewNote[] | undefined, headings: string[]): { top: ReportReviewNote[]; at: Map<number, ReportReviewNote[]> } {
  const top: ReportReviewNote[] = [];
  const at = new Map<number, ReportReviewNote[]>();
  for (const n of notes ?? []) {
    const i = n.footnotes?.length ? null : headingFor(n.where, headings);
    if (i === null) top.push(n);
    else at.set(i, [...(at.get(i) ?? []), n]);
  }
  return { top, at };
}
