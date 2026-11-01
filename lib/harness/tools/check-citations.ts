/**
 * check_citations — the self-check before a report is delivered (PRD §6.3.1
 * step 9, §7 rule 13, §9.7): every [[note#^cN]] must point at an existing
 * block, and a quote “…” written right before a link must match that block.
 */
import { z } from 'zod';
import type { CitationCheck } from '@/lib/vault';
import type { ToolSpec } from '../types';

export const checkCitationsParameters = z
  .object({
    path: z.string().optional().describe('Vault-relative path of a draft to check (e.g. the report).'),
    text: z.string().optional().describe('Or: markdown text to check directly.'),
  })
  .refine((a) => Boolean(a.path || a.text), { message: 'give path or text' });

export interface CheckCitationsResult {
  ok: boolean;
  total: number;
  failed: CitationCheck[];
}

export const checkCitationsTool: ToolSpec<typeof checkCitationsParameters, CheckCitationsResult> = {
  name: 'check_citations',
  description:
    'Verify every [[note#^cN]] citation: the block exists, and a “quote” placed right before the link matches the original text. Fix every failure before delivering.',
  parameters: checkCitationsParameters,
  owner: 'M0',
  implemented: true,
  async execute({ path, text }, ctx) {
    const content = text ?? (await ctx.vault.read(path!)).body;
    const results = await ctx.vault.checkCitations(content, { fromPath: path });
    const failed = results.filter((r) => !r.ok);
    return { ok: failed.length === 0, total: results.length, failed };
  },
  summarize: (a, r) => `自检引用 ${a.path ?? '(文本)'}：${r ? `${r.total - r.failed.length}/${r.total} 通过` : ''}`,
};
