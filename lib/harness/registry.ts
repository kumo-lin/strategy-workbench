/**
 * Tool registry: phase → AI SDK tool set. The ONLY way tools reach a model.
 *
 *   const tools = buildToolsForPhase(ctx);   // only ctx.phase's tools
 *   streamText({ model, tools, ... })
 *
 * Every server-side execution goes through `executeTool`, which re-checks
 * the phase (defence in depth: a tool outside the phase is rejected even if
 * someone calls it directly) and appends one row to the workspace log.
 *
 * CONTRACT (frozen after M0). Tool owners edit their file in ./tools/, not this one.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { isToolAllowed, PHASE_TOOLS, type Phase, type ToolName } from './phases';
import { askUserTool } from './tools/ask-user';
import { readTaskContextTool } from './tools/task-context';
import { checkCitationsTool } from './tools/check-citations';
import { composeWorkplanTool } from './tools/compose-workplan';
import { frameTopicTool } from './tools/frame-topic';
import { draftContractTool, draftIssueTreeTool } from './tools/project-framing';
import { setSelectionTool } from './tools/set-selection';
import { proposeDecisionTool, proposeKnowledgeTool, submitForReviewTool } from './tools/review-tools';
import { vaultListTool, vaultReadTool, vaultSearchTool } from './tools/vault-tools';
import { ingestSourceTool, webFetchTool, webSearchTool } from './tools/web-tools';
import { writeDraftTool } from './tools/write-draft';
import { ToolNotAllowedError, type ToolCallRecord, type ToolContext, type ToolSpec } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpec = ToolSpec<z.ZodObject, any>;

export const TOOL_SPECS: Record<ToolName, AnySpec> = {
  read_task_context: readTaskContextTool,
  ask_user: askUserTool,
  vault_list: vaultListTool,
  vault_read: vaultReadTool,
  vault_search: vaultSearchTool,
  write_draft: writeDraftTool,
  web_search: webSearchTool,
  web_fetch: webFetchTool,
  ingest_source: ingestSourceTool,
  check_citations: checkCitationsTool,
  submit_for_review: submitForReviewTool,
  propose_decision: proposeDecisionTool,
  propose_knowledge: proposeKnowledgeTool,
  frame_topic: frameTopicTool,
  draft_contract: draftContractTool,
  draft_issue_tree: draftIssueTreeTool,
  set_selection: setSelectionTool,
  compose_workplan: composeWorkplanTool,
};

const WHY = z.string().optional().describe('一句话：为什么要做这次调用（写进日志）');

/** The model-facing input schema: the tool's own parameters + `why`. */
export function modelInputSchema(spec: AnySpec): z.ZodObject {
  return spec.parameters.safeExtend({ why: WHY });
}

const WEB_TOOLS: readonly ToolName[] = ['web_search', 'web_fetch'];

/** Tool names actually passed to the model in `phase` (registered AND implemented); `web: false` drops the web tools (D63 §2). */
export function toolNamesForPhase(phase: Phase, opts: { web?: boolean } = {}): ToolName[] {
  return PHASE_TOOLS[phase].filter((n) => TOOL_SPECS[n].implemented && (opts.web !== false || !WEB_TOOLS.includes(n)));
}

export type ToolCallListener = (record: ToolCallRecord) => void;

function oneLine(v: unknown, max = 300): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Run one tool call under the harness rules. Throws ToolNotAllowedError when
 * the tool is not in ctx.phase. The log row is written whether it succeeds or not.
 */
export async function executeTool(
  name: ToolName,
  rawArgs: unknown,
  ctx: ToolContext,
  onRecord?: ToolCallListener,
): Promise<unknown> {
  const spec = TOOL_SPECS[name];
  const startedAt = ctx.now();
  const t0 = Date.now();
  const finish = async (rec: Omit<ToolCallRecord, 'tool' | 'phase' | 'startedAt' | 'durationMs'>) => {
    const record: ToolCallRecord = { tool: name, phase: ctx.phase, startedAt: startedAt.toISOString(), durationMs: Date.now() - t0, ...rec };
    await ctx.vault.appendLog(ctx.logPath, {
      time: record.startedAt,
      actor: 'AI',
      action: `tool:${name}`,
      change: record.ok ? record.summary : `✗ ${record.error}`,
      reason: `${record.why ?? '（未说明）'} · 阶段=${ctx.phase}`,
    });
    onRecord?.(record);
  };

  if (!spec || !isToolAllowed(ctx.phase, name) || !spec.execute || (ctx.selection?.web === false && WEB_TOOLS.includes(name))) {
    const err = new ToolNotAllowedError(name, ctx.phase, spec && !spec.execute ? `tool "${name}" has no server executor` : undefined);
    await finish({ args: rawArgs, ok: false, summary: '', error: err.message });
    throw err;
  }

  const { why, ...rest } = (rawArgs ?? {}) as Record<string, unknown>;
  const parsed = spec.parameters.safeParse(rest);
  if (!parsed.success) {
    const error = `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
    await finish({ args: rest, why: why as string | undefined, ok: false, summary: '', error });
    throw new Error(error);
  }
  try {
    const result = await spec.execute(parsed.data, ctx);
    const summary = spec.summarize ? spec.summarize(parsed.data, result) : oneLine(parsed.data);
    await finish({ args: parsed.data, why: why as string | undefined, ok: true, summary });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish({ args: parsed.data, why: why as string | undefined, ok: false, summary: '', error });
    throw e;
  }
}

/**
 * The AI SDK tool set for ctx.phase. Client tools (ask_user) are passed
 * without `execute`, so the call is streamed to the UI and the run waits for
 * the user's answer.
 */
export function buildToolsForPhase(ctx: ToolContext, onRecord?: ToolCallListener, opts: { allForSteps?: boolean } = {}): ToolSet {
  const tools: ToolSet = {};
  // D-64 T20: until the task context is read in this phase, it is the only tool. The runner builds them all
  // (allForSteps) and narrows each step itself, since the read happens inside the same request.
  const names = ctx.taskContextRead === false && !opts.allForSteps ? (['read_task_context'] as ToolName[]) : toolNamesForPhase(ctx.phase, { web: ctx.selection?.web });
  for (const name of names) {
    const spec = TOOL_SPECS[name];
    const inputSchema = modelInputSchema(spec);
    tools[name] = spec.execute
      ? tool({
          description: spec.description,
          inputSchema,
          execute: (args: unknown) => executeTool(name, args, ctx, onRecord),
        })
      : tool({ description: spec.description, inputSchema });
  }
  return tools;
}
