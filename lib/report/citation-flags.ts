/**
 * A report's `citation_flags` (frontmatter, D-48 round 3): footnotes the "引用对得上吗" check still judged as hung on
 * the wrong sentence after its repair (lib/research/citation-fit.ts). Pages put "⚠ 引文可能对不上" beside that
 * footnote in that sentence only (lib/report/sentence-place.ts), the reason and the quote on hover, the way number_flags are marked; the report file is
 * not changed and delivery is not held up. Items that do not match the shape are left out; a report without the field has none.
 */
import { z } from 'zod';

export const citationFlagSchema = z.object({
  /** "[^9]" as the report has it. */
  footnote: z.string(),
  /** The sentence the footnote hangs on. */
  sentence: z.string().catch(''),
  /** The footnote's quote. */
  quote: z.string().catch(''),
  reason: z.string().catch(''),
  /** The footnote's block link ("[[资料#^c1]]"): what the flag is bound to (D-48 round 4); else this version's footnote. */
  ref: z.string().optional().catch(undefined),
});
export type CitationFlag = z.infer<typeof citationFlagSchema> & { id: string };

export function readCitationFlags(data: Record<string, unknown>): CitationFlag[] {
  const v = data.citation_flags;
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    const r = citationFlagSchema.safeParse(e);
    const id = r.success ? /^\s*\[?\^?(\d+)[!~]*\]?\s*$/.exec(r.data.footnote)?.[1] : undefined;
    return r.success && id ? [{ ...r.data, id }] : [];
  });
}

/** A report's `entity_flags` (lib/research/entity-check.ts): a footnote whose source has none of its clause's names and numbers. */
export const entityFlagSchema = z.object({
  /** The footnote's block link. */
  key: z.string(),
  footnote: z.string().catch(''),
  sentence: z.string().catch(''),
  missing: z.array(z.string()).catch([]),
});
export type EntityFlagShown = z.infer<typeof entityFlagSchema>;

export function readEntityFlags(data: Record<string, unknown>): EntityFlagShown[] {
  const v = data.entity_flags;
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    const r = entityFlagSchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}

/**
 * A "⚠ 引文可能对不上" on a page (D-48 round 4, E): bound to its sentence and its evidence (the block link), placed
 * each time the page is drawn (sentence-place.ts); `id` only where a flag has no block link.
 */
export interface FootnoteMark {
  id: string;
  ref: string;
  sentence: string;
  /** What the tag is: ⚠ (missing = warn, as all marks were before), the three checks passed, or they did not. */
  kind?: 'warn' | 'ok' | 'unverified';
  /** What a hover says. */
  title: string;
}

export function footnoteMarks(citation: CitationFlag[] = [], entity: EntityFlagShown[] = [], verify: FootnoteMark[] = []): FootnoteMark[] {
  return [
    ...citation.map((f) => ({ id: f.id, ref: f.ref ?? '', sentence: f.sentence, title: [`理由：${f.reason || '（没有写）'}`, `原文：${f.quote ? `“${f.quote}”` : '（没有写）'}`].join('\n') })),
    ...entity.map((f) => ({ id: /\d+/.exec(f.footnote)?.[0] ?? '', ref: f.key, sentence: f.sentence, title: `原文里没有出现：${f.missing.join('、') || '（没有写）'}` })),
    ...verify,
  ];
}

/** "[[path/资料#^c1|别名]]" and "[[资料#^c1]]" are one block: compared by note name and block. */
export function refKey(ref: string): string {
  const m = /\[\[([^\]|#]+)#\^([A-Za-z0-9-]+)/.exec(ref);
  return m ? `${m[1].trim().split('/').pop()!.replace(/\.md$/, '')}#${m[2]}` : '';
}

/**
 * A report's `summary_flags` (M3, D-48 round 5 B): a clause of the one-line answer or of 对决策的回答 that did not pass
 * the tone or direction check against the sub-question it names ([Q3-1]), or names none. The page marks it ⚠.
 */
export const summaryFlagSchema = z.object({
  sentence: z.string(),
  q: z.string().catch(''),
  kind: z.enum(['tone', 'direction', 'untagged']).catch('untagged'),
});
export type SummaryFlag = z.infer<typeof summaryFlagSchema>;

export function readSummaryFlags(data: Record<string, unknown>): SummaryFlag[] {
  const v = data.summary_flags;
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    const r = summaryFlagSchema.safeParse(e);
    return r.success && r.data.sentence.trim() ? [r.data] : [];
  });
}

/** What a hover on a summary flag says. */
export function summaryFlagTitle(f: SummaryFlag): string {
  const q = f.q.replace(/^\[|\]$/g, '').trim() || '子问题';
  return f.kind === 'tone' ? `语气和 ${q} 的回答不一致` : f.kind === 'direction' ? `方向可能和 ${q} 的回答相反` : '没有标出来自哪个子问题';
}

