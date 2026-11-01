/**
 * A report's `citation_verify` (frontmatter, D-56 ⑦): the three-check result lib/research/citation-verify.ts wrote —
 * for each first-layer footnote, whether the entity gate and both model judges all held the clause it ends. The page
 * shows it beside that footnote in that clause: a green "✓ 依据" when all three passed, a grey
 * "相关资料（没核实能不能撑住这句话）" otherwise. The report file is not changed and nothing here decides delivery.
 * Items that do not match the shape are left out; a report without the field has none.
 */
import { z } from 'zod';
import type { FootnoteMark } from './citation-flags';

/** One footnote of the frontmatter record, as the page uses it. */
export interface VerifyItem {
  /** The digits of "[^9]". */
  id: string;
  /** The footnote's block link ("[[资料#^c1]]"). */
  ref: string;
  /** The clause the footnote ends. */
  sentence: string;
  verified: boolean;
  /** The clause's names and numbers the source did not have. */
  entityMissing: string[];
  /** "<fit>：<reason>", or 没判出来 when the first model said nothing about this pair. */
  deepseek: string;
  /** The same, for the second model. */
  kimi: string;
  /** D-64 T24: what the original can support and what it cannot (the second check's); absent in older reports. */
  can?: string;
  cannot?: string;
}

const gateSchema = z.object({
  fit: z.string().nullish().catch(null),
  reason: z.string().catch(''),
});
type Gate = z.infer<typeof gateSchema>;

const itemSchema = z.object({
  footnote: z.string().catch(''),
  ref: z.string().catch(''),
  sentence: z.string().catch(''),
  verified: z.boolean().catch(false),
  can: z.string().catch(''),
  cannot: z.string().catch(''),
  entity: z.object({ pass: z.boolean().catch(false), missing: z.array(z.string()).catch([]) }).catch({ pass: false, missing: [] }),
  deepseek: gateSchema.catch({ fit: null, reason: '' }),
  kimi: gateSchema.catch({ fit: null, reason: '' }),
});

/** What one model said about a pair: fit and reason, or 没判出来 when it said nothing. */
function gateText(gate: Gate | undefined): string {
  return gate?.fit ? `${gate.fit}：${gate.reason}` : '没判出来';
}

export function readCitationVerify(data: Record<string, unknown>): VerifyItem[] {
  const v = data.citation_verify;
  if (!v || typeof v !== 'object') return [];
  const items = (v as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((e) => {
    const r = itemSchema.safeParse(e);
    const id = r.success ? /^\s*\[?\^?(\d+)[!~]*\]?\s*$/.exec(r.data.footnote)?.[1] : undefined;
    if (!r.success || !id) return [];
    return [
      {
        id,
        ref: r.data.ref,
        sentence: r.data.sentence,
        verified: r.data.verified === true,
        entityMissing: r.data.entity.missing,
        deepseek: gateText(r.data.deepseek),
        kimi: gateText(r.data.kimi),
        can: r.data.can,
        cannot: r.data.cannot,
      },
    ];
  });
}

const OK_TITLE = '三道核对都过了：名称和数字对得上；两个模型各自判过，都认为原文撑得住这句话。';

/** The page's marks: one per item with a clause, ok when all three checks passed, unverified otherwise. */
export function verifyMarks(items: VerifyItem[]): FootnoteMark[] {
  return items.flatMap((item) => {
    if (!item.sentence.trim()) return [];
    const title = item.verified
      ? OK_TITLE
      : [
          `名称和数字：${item.entityMissing.length ? `原文里没有：${item.entityMissing.join('、')}` : '对得上'}`,
          `第一个模型：${item.deepseek}`,
          `第二个模型：${item.kimi}`,
        ].join('\n');
    return [{ id: item.id, ref: item.ref, sentence: item.sentence, kind: item.verified ? ('ok' as const) : ('unverified' as const), title }];
  });
}
