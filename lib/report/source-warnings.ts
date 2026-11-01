/**
 * A report's `source_warnings` (frontmatter): cited sources found to be wrong after the report was written. Pages show
 * a warning box and flag the footnotes that cite them; the report file is not changed. Items that do not match the
 * schema are left out; a report without the field has none.
 */
import { sourceWarningSchema, type SourceWarning } from '@/lib/notes/schema';

export type { SourceWarning };

export function readSourceWarnings(data: Record<string, unknown>): SourceWarning[] {
  const v = data.source_warnings;
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    const r = sourceWarningSchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}

/** Footnote ids (and plain-mode `[n]` numbers) cited by a warned-about source. */
export function warnedFootnotes(warnings: SourceWarning[] | undefined): Set<string> {
  return new Set((warnings ?? []).flatMap((w) => w.footnotes));
}
