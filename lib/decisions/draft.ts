/**
 * "起草决定": the Senior clicks it on a delivered report. The model writes the content
 * (prompt: lib/harness/prompts/decision.ts); the note itself is written only by the
 * `propose_decision` tool, through the harness, so the phase check, the system rules and
 * the log row apply as for every other AI write.
 */
import type { LanguageModel } from 'ai';
import { executeTool } from '@/lib/harness';
import { isToolAllowed } from '@/lib/harness/phases';
import type { ToolContext } from '@/lib/harness/types';
import { decisionPrompt, decisionRepairPrompt, DECISION_SYSTEM, type DecisionPromptInput } from '@/lib/harness/prompts/decision';
import { getModel } from '@/lib/models/provider';
import { llmJson } from '@/lib/research/llm';
import { loadSourceInfo, splitClaimText } from '@/lib/research/sources';
import { ApprovalDenied } from '@/lib/harness/events';
import { extractWikiLinks, toWikiLink } from '@/lib/vault';
import { z } from 'zod';
import { insufficientOnlyBlocks } from './check';
import { DecisionFlowError, loadDeliveredReport, type DraftModelInfo, type DraftToolContext, type ProposeDecisionResult } from './propose';
import { proposeDecisionParameters } from './schema';
import { findRelatedDecisions } from './retrieve';
import { taskLine } from '@/lib/testing/mock-contract';

const draftSchema = proposeDecisionParameters.omit({ report: true });

const noExt = (p: string) => p.replace(/\.md$/, '');
const baseName = (p: string) => noExt(p).split('/').pop() ?? p;

export async function buildPromptInput(ctx: ToolContext, reportPath: string): Promise<DecisionPromptInput> {
  const { vault } = ctx;
  const report = await loadDeliveredReport(ctx, reportPath);
  const project = await vault.read(`${ctx.projectPath}/项目.md`);
  const supports = /\*\*支撑的决策\*\*[:：]\s*(.+)/.exec(project.body)?.[1]?.trim() ?? String(project.data.core_question ?? '');

  const hypotheses: DecisionPromptInput['hypotheses'] = [];
  const seen = new Set<string>();
  for (const l of extractWikiLinks(report.body)) {
    if (l.block) continue;
    const r = await vault.resolveLink(l, report.path);
    if (!r.ok || seen.has(r.path)) continue;
    seen.add(r.path);
    const n = await vault.read(r.path);
    if (n.data.type === 'hypothesis') {
      hypotheses.push({ link: toWikiLink(noExt(r.path), { alias: baseName(r.path) }), statement: String(n.data.statement ?? ''), verdictProposed: typeof n.data.verdict_proposed === 'string' ? n.data.verdict_proposed : null });
    }
  }

  const citable: DecisionPromptInput['citable'] = [];
  const have = new Set<string>();
  const weakOnly = await insufficientOnlyBlocks(vault, report.body, report.path);
  for (const c of await vault.checkCitations(report.body, { fromPath: report.path })) {
    if (!c.ok || !c.path || !c.block || have.has(`${c.path}#${c.block}`)) continue;
    have.add(`${c.path}#${c.block}`);
    // a source the owner unticked after the report is not offered to the drafter (review of P1)
    const info = await loadSourceInfo(vault, c.path).catch(() => null);
    if (!info) continue;
    citable.push({ link: `[[${info.linkTarget}#^${c.block}]]`, grade: info.grade, origin: info.origin === '网络' ? `网络 · ${info.gradedBy} 定级` : '知识库', quote: splitClaimText(c.blockText ?? '').quote, insufficientOnly: weakOnly.has(`${c.path}#${c.block}`) });
  }

  const affectable: DecisionPromptInput['affectable'] = [{ link: toWikiLink(`${ctx.projectPath}/项目`, { alias: '项目' }), kind: '项目', label: baseName(ctx.projectPath) }];
  for (const e of await vault.list(ctx.projectPath)) {
    if (e.kind === 'dir' && (await vault.exists(`${e.path}/workspace.md`))) {
      const w = await vault.read(`${e.path}/workspace.md`);
      affectable.push({ link: toWikiLink(`${e.path}/workspace`, { alias: e.name }), kind: 'Workspace', label: `${e.name}（${String(w.data.week ?? '')}，${String(w.data.stage ?? '')}）` });
    }
  }
  for (const h of await vault.list(`${ctx.projectPath}/假设`).catch(() => [])) {
    if (h.kind === 'file') affectable.push({ link: toWikiLink(noExt(h.path), { alias: baseName(h.path) }), kind: '假设', label: '' });
  }

  const inForce = (await findRelatedDecisions(ctx)).map((d) => ({ name: d.name, decision: d.decision }));
  return {
    workspaceName: baseName(ctx.workspacePath),
    project: { name: baseName(ctx.projectPath), coreQuestion: String(project.data.core_question ?? ''), supportsDecision: supports },
    report: { path: report.path, name: baseName(report.path), body: report.body },
    hypotheses,
    citable,
    affectable,
    inForce,
  };
}

export interface DraftOptions {
  ctx: ToolContext;
  reportPath: string;
  model?: LanguageModel;
  /** Provider label / model name behind `model`, for the log and the note (default: the active provider). */
  modelInfo?: DraftModelInfo;
  signal?: AbortSignal;
  /** Extra attempts when the system rejects the draft (default 2). */
  repairs?: number;
}

export async function draftDecision(opts: DraftOptions): Promise<ProposeDecisionResult> {
  const { ctx } = opts;
  if (ctx.role.kind !== 'senior') throw new ApprovalDenied(`只有 Senior 可以起草决定（现在是 ${ctx.role.name}）`);
  // Fail before the model call: the harness would refuse the write anyway (phase gate).
  if (!isToolAllowed(ctx.phase, 'propose_decision')) throw new DecisionFlowError('这次调查的计划还没有批准（调查工具没有开放），现在不能起草决定');
  const input = await buildPromptInput(ctx, opts.reportPath);
  let model = opts.model;
  let modelInfo = opts.modelInfo;
  if (!model) {
    const resolved = await getModel({ vault: ctx.vault });
    model = resolved.model;
    modelInfo ??= { providerId: resolved.providerId, label: resolved.provider.label, model: resolved.provider.model };
  }
  const draftCtx: DraftToolContext = modelInfo ? { ...ctx, draftModel: modelInfo } : ctx;
  const base = decisionPrompt(input);

  let prompt = base;
  let lastError = '';
  for (let attempt = 0; attempt <= (opts.repairs ?? 2); attempt++) {
    const draft: z.infer<typeof draftSchema> = await llmJson({ model, task: 'decision', system: `${DECISION_SYSTEM}\n${taskLine('decision_draft')}`, prompt, schema: draftSchema, signal: opts.signal });
    try {
      return (await executeTool('propose_decision', { ...draft, report: input.report.path, why: '起草决定：Senior 在报告页点了"起草决定"' }, draftCtx)) as ProposeDecisionResult;
    } catch (e) {
      if (!(e instanceof DecisionFlowError)) throw e;
      lastError = e.message;
      prompt = decisionRepairPrompt(base, JSON.stringify(draft), lastError);
    }
  }
  throw new DecisionFlowError(`AI 起草的决定没有通过系统检查：${lastError}`);
}
