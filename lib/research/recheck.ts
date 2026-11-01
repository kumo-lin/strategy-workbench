/**
 * D-48: the citation checks run again on a delivered report (scripts/recheck-citations.ts), for a run whose check did
 * not get through (WS-A v9: 86 footnotes in one call, cut off, skipped: no citation_flags, no ⚠ on the page).
 *
 * citation-fit on every footnote of the Summary, the recommendation and the cards, all only flagged, and entity-check.
 * What changes: frontmatter citation_flags, entity_flags, citation_fit, and the appendix line "引用核对：查了 N 个……".
 * Nothing else of the body, the footnote numbers neither. The page computes its ⚠ from the flags on every display.
 */
import type { LanguageModel } from 'ai';
import type { ToolContext } from '@/lib/harness/types';
import { getModel } from '@/lib/models/provider';
import { citationFit, citationFlagsOf } from './citation-fit';
import { summaryFlagsOf } from './conclusion';
import { entityFlagsOf } from './entity-check';
import type { Evidence } from './evidence';
import { loadEvidenceRecord, restoreEvidence } from './evidence-record';
import type { ClaimResult } from './judge';
import { readJudgmentFile } from './judgment-file';
import { llmJson } from './llm';
import { withCitationFitLine } from './report';
import type { ResearchRun } from './run';
import type { SummaryDraft } from './schemas';

export class RecheckDenied extends Error {}

export const RECHECK_NOTE = '引用核对按分批补跑，正文未改';

export interface RecheckResult {
  checked: number;
  batches: number;
  summaryFlagged: number;
  flagged: number;
  entityFlagged: number;
  seconds: number;
}

export async function recheckCitations(o: { ctx: ToolContext; reportPath: string; model?: LanguageModel }): Promise<RecheckResult> {
  const t0 = Date.now();
  const { ctx, reportPath } = o;
  const note = await ctx.vault.read(reportPath);
  if (note.data.type !== 'report') throw new RecheckDenied(`${reportPath} 不是报告`);
  if (note.data.delivery !== '已交付') throw new RecheckDenied(`${reportPath} 还没有交付：只对已交付的报告重跑核对`);
  const file = await readJudgmentFile(ctx.vault, reportPath);
  if (!file) throw new RecheckDenied(`${reportPath} 没有判断文件（.judgment.json）：先用 rewrite-report.ts --backfill-judgment 补存`);

  // the evidence as the report cites it: its record, by block link, under the keys its judgment file uses
  const evidence = await restoreEvidence(ctx.vault, await loadEvidenceRecord(ctx.vault, reportPath, note.data), reportPath);
  const byRef = new Map(evidence.map((e) => [e.ref, e]));
  const keyed = new Map<string, Evidence>(Object.entries(file.keyed).flatMap(([k, ref]) => (byRef.has(ref) ? [[k, byRef.get(ref)!] as const] : [])));
  const results = file.claims.map(
    (c) => ({ claim: { id: c.claimId, ...(c.conditions.length ? { question: c.label } : {}) }, label: c.label, judgment: c.judgment, keyed, conditions: c.conditions, verdict: c.verdict }) as unknown as ClaimResult,
  );
  const summary = { so_what: '', results: [], answers: [], sufficiency: '', workplan_impact: [], ...(file.summary ?? {}), ...(file.recommendation ? { recommendation: file.recommendation } : {}) } as SummaryDraft;

  const model = o.model ?? (await getModel({ vault: ctx.vault, role: 'execution' })).model;
  let batches = 0;
  const run: Pick<ResearchRun, 'llm' | 'log' | 'signal'> = {
    signal: undefined,
    llm: (task, p, schema, opts = {}) => {
      if (task === 'citation-fit') batches++;
      return llmJson({ model, task, system: p.system, prompt: p.prompt, schema, maxOutputTokens: opts.maxOutputTokens });
    },
    log: (action, change, reason) => ctx.vault.appendLog(ctx.logPath, { time: ctx.now().toISOString(), actor: 'AI', action, change, reason }),
  };
  // every part only flagged: the words are the delivered report's
  const fit = await citationFit(run, { results, summary }, keyed, () => true);
  const citationFlags = citationFlagsOf(fit.misfits, note.body, keyed);
  const entityFlags = await entityFlagsOf(ctx.vault, note.body, reportPath);
  // and summary_flags, by code: the one-line answer and 对决策的回答 as stored against the answers the body shows
  const summaryFlags = summaryFlagsOf(note.body, file.summary?.so_what ?? '', file.recommendation?.decision_answer ?? '', Array.isArray(note.data.summary_flags) && note.data.summary_flags.length > 0);
  // the fixes the run made are in the body: counted as they are
  const fixes = Array.isArray(note.data.citation_fixes) ? (note.data.citation_fixes as { action?: string }[]) : [];
  const counts = { checked: fit.counts.checked, replaced: fixes.filter((f) => f.action === '换编号').length, removed: fixes.filter((f) => f.action === '删脚注').length, flagged: citationFlags.length };

  const { citation_flags: _flags, entity_flags: _entities, summary_flags: _summary, ...rest } = note.data;
  void _flags;
  void _entities;
  void _summary;
  await ctx.vault.write(
    reportPath,
    {
      frontmatter: {
        ...rest,
        ...(citationFlags.length ? { citation_flags: citationFlags } : {}),
        ...(entityFlags.length ? { entity_flags: entityFlags } : {}),
        ...(summaryFlags.length ? { summary_flags: summaryFlags } : {}),
        citation_fit: counts,
        // what the 规划 checks it against: when, in how many calls, and that the body was not touched
        citation_recheck: { at: ctx.now().toISOString(), batches, note: RECHECK_NOTE },
      },
      body: counts.checked ? withCitationFitLine(note.body, counts) : note.body,
    },
    { overwrite: true },
  );
  const seconds = Math.round((Date.now() - t0) / 1000);
  await run.log('research:citation-recheck', `${reportPath.split('/').pop()}：${RECHECK_NOTE}（${batches} 批），查了 ${counts.checked} 个，标了 ${counts.flagged} 个；实体核对标了 ${entityFlags.length} 个；用了 ${seconds} 秒`, '只更新 citation_flags、entity_flags、citation_fit、citation_recheck 和附录的统计行，正文和脚注编号不动');
  await run.log('research:summary-recheck', `${reportPath.split('/').pop()}：补跑 summary_flags，正文未改：${summaryFlags.length} 条${summaryFlags.length ? `（${summaryFlags.map((f) => `${f.q || '没标子问题'} ${f.kind}`).join('、')}）` : ''}`, '一句话回答和对决策的回答照子问题的回答核对，纯代码，只标不改');
  return { checked: counts.checked, flagged: counts.flagged, entityFlagged: entityFlags.length, summaryFlagged: summaryFlags.length, batches, seconds };
}
