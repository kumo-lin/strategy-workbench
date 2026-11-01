/**
 * What every route that starts a research run shares (M2_5b-3): the path check, the context, the approved-plan
 * gate, the owner check, and the job + stream writer. `/execute` and `/continue` differ only in their body and in
 * what the run does; the vault-only stage (`stage: 'internal'`) runs through the same writer.
 */
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk, type UIMessageStreamWriter } from 'ai';
import { buildToolContext } from '@/lib/harness';
import type { ToolContext } from '@/lib/harness/types';
import { RESEARCH_LIMITS, type ResearchMode } from '@/lib/research/constants';
import { BadResearchPath, assertResearchDir } from '@/lib/research/folders';
import { attachToJob, runTag, startJob, type ResearchJob } from '@/lib/research/job';
import type { Emit, ProgressEvent, ResearchUIMessage } from '@/lib/research/progress';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export type OpenRun = { ok: true; ctx: ToolContext; abort: AbortController } | { ok: false; response: Response };

/** The checks before a run may start, in the order the execute route has always done them. */
export async function openRun(o: { workspacePath: string; researchDir: string }): Promise<OpenRun> {
  const abort = new AbortController();
  let ctx: ToolContext;
  try {
    assertResearchDir(o.workspacePath, o.researchDir);
    ctx = await buildToolContext({ vault: getVault(), role: await getCurrentRole(), workspacePath: o.workspacePath, track: 'research', researchDir: o.researchDir, abortSignal: abort.signal });
  } catch (e) {
    return { ok: false, response: Response.json({ error: e instanceof BadResearchPath ? e.message : e instanceof Error ? e.message : String(e) }, { status: 400 }) };
  }
  // The gate: no approved plan, no run. (executeResearch repeats it.)
  if (ctx.phase !== 'research_execute') return { ok: false, response: Response.json({ error: '调查计划还没有批准：批准之前调查工具不可用' }, { status: 409 }) };
  // Only the owner starts a run, even while one is going (anyone may follow it with GET): checked before attaching.
  if (ctx.role.name !== ctx.workspace.owner) return { ok: false, response: Response.json({ error: `只有 Workspace 的负责人（${ctx.workspace.owner}）可以开始调查` }, { status: 403 }) };
  return { ok: true, ctx, abort };
}

export interface StartRunOptions {
  key: string;
  ctx: ToolContext;
  abort: AbortController;
  /** `data-job`'s mode and the limits written with `data-result`. */
  mode: ResearchMode;
  startedAt?: number;
  prefix?: UIMessageChunk[];
  onEnd?: (job: ResearchJob) => Promise<void> | void;
  /** The run: writes its progress through `emit`/`writer` and returns the `data-result` payload. */
  run: (o: { emit: Emit; signal: AbortSignal; writer: UIMessageStreamWriter<ResearchUIMessage> }) => Promise<object>;
}

/** Starts `run` as the background job for `key` and returns the page's stream to it. */
export function startRunJob(o: StartRunOptions): Response {
  const startedAt = o.startedAt ?? Date.now();
  const source = createUIMessageStream<ResearchUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageMetadata: { phase: o.ctx.phase } });
      writer.write({ type: 'data-job', id: 'job', data: { startedAt, mode: o.mode } });
      const emit: Emit = (e: ProgressEvent) => {
        if (e.kind === 'step') writer.write({ type: 'data-step', id: e.id, data: e });
        else if (e.kind === 'search-card') writer.write({ type: 'data-card', id: `card-${e.n}${e.stop ? `-stop-${e.subQuestion}` : ''}`, data: e });
        else if (e.kind === 'tool-start') writer.write({ type: 'tool-input-available', toolCallId: e.id, toolName: e.tool, input: e.input });
        else if (e.ok) writer.write({ type: 'tool-output-available', toolCallId: e.id, output: e.output });
        else writer.write({ type: 'tool-output-error', toolCallId: e.id, errorText: e.error ?? 'error' });
      };
      try {
        const result = await o.run({ emit, signal: o.abort.signal, writer });
        writer.write({ type: 'data-result', id: 'result', data: { ...result, limits: JSON.parse(JSON.stringify(RESEARCH_LIMITS[o.mode])) } });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // the log must not end on research:start: the page reads it to tell a run that died from one that is still going
        await o.ctx.vault.appendLog(o.ctx.logPath, { time: o.ctx.now().toISOString(), actor: 'AI', action: 'research:failed', change: `调查没有跑完：${message.slice(0, 200)}`, reason: `执行出错${runTag(o.ctx.research?.dir ?? '')}` }).catch(() => {});
        writer.write({ type: 'error', errorText: message });
      }
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
  });
  return createUIMessageStreamResponse({ stream: attachToJob(startJob(o.key, source, o.abort, startedAt, { prefix: o.prefix, onEnd: o.onEnd })) });
}
