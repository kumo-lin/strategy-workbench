/**
 * A report's `length_flags` (frontmatter): sentences that are still over their length limit after the rewrite
 * (D-48). Pages put "⚠ 超过 N 字" beside the sentence, the way number_flags are marked; the report file is not
 * changed and delivery is not held up. Items that do not match the shape are left out; a report without the field has none.
 */
import { z } from 'zod';

export const lengthFlagSchema = z.object({
  /** Which entry, e.g. "Q2-1 理由". */
  where: z.string(),
  /** The over-long sentence as the report has it. */
  text: z.string(),
  limit: z.number(),
  length: z.number(),
});
export type LengthFlag = z.infer<typeof lengthFlagSchema>;

export function readLengthFlags(data: Record<string, unknown>): LengthFlag[] {
  const v = data.length_flags;
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    const r = lengthFlagSchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}

/** Footnote marks, evidence ids, quote marks, (推断) and white space taken out: two renderings of one sentence compare equal. */
export function lengthKey(text: string): string {
  return text
    .replace(/\[\^?\d+[!~]*\]|\[E\d+\]/g, '')
    .replace(/[（(]推断[）)]/g, '')
    .replace(/[“”「」"'\s]/g, '');
}

/** The flag whose sentence is in `text` (the entry's own text), if any. Very short sentences never match. */
export function lengthFlagIn(text: string, flags: { key: string; flag: LengthFlag }[]): LengthFlag | null {
  if (!flags.length) return null;
  const key = lengthKey(text);
  return flags.find((f) => f.key.length >= 4 && key.includes(f.key))?.flag ?? null;
}
