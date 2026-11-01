/**
 * POST /api/research/execute — start (or follow) the run of the approved plan (CONTRACTS 3-b); GET re-attaches.
 * The run is a background job (lib/research/job.ts): a dropped connection never stops it. The 9 steps are scheduled
 * by lib/research/execute.ts; this route streams its progress as a UI message stream: each tool
 * call is a `tool-*` part (rendered by the same cards as the chat), each step a `data-step` part.
 */
import { createUIMessageStreamResponse } from 'ai';
import { z } from 'zod';
import { ApprovalDenied, buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, executeFollowUp, FollowUpDenied, PlanSaveDenied } from '@/lib/research/followup';
import { assertResearchDir } from '@/lib/research/folders';
import { attachToJob, findJob, jobKey, type ResearchJob } from '@/lib/research/job';
import { openRun, startRunJob } from '@/lib/research/run-request';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const body = z.object({ workspacePath: z.string(), researchDir: z.string(), mode: z.enum(['small', 'full']).default('small'), claimIds: z.array(z.string()).optional(),
  /** 追加调查: a new sub-question under an existing claim, on top of the latest delivered report (small budget). */
  followUp: z.object({ claimId: z.string(), question: z.string().max(200), budget: z.enum(['small', 'full']).default('small') }).optional(),
});

const streamResponse = (job: ResearchJob) => createUIMessageStreamResponse({ stream: attachToJob(job) });

/** Reconnect (after a refresh or a dropped connection): the running or just-finished run from its first chunk, or 204 if there is none. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspacePath = url.searchParams.get('workspacePath') ?? '';
  const researchDir = url.searchParams.get('researchDir') ?? '';
  try {
    assertResearchDir(workspacePath, researchDir);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const job = findJob(jobKey(workspacePath, researchDir));
  return job ? streamResponse(job) : new Response(null, { status: 204 });
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  // D-64 T22 (D2): one run, internal library then the web for what has a gap; no stage that stops to ask the owner
  const { workspacePath, researchDir, mode, claimIds, followUp } = parsed.data;

  const opened = await openRun({ workspacePath, researchDir });
  if (!opened.ok) return opened.response;
  const { abort } = opened;
  let ctx = opened.ctx;
  const key = jobKey(workspacePath, researchDir);
  // A run is already going (a second click, a second tab, a retry after a dropped connection): follow it, never start another.
  const running = findJob(key);
  if (running?.status === 'running') {
    if (followUp) return Response.json({ error: '这次调查正在执行，等它结束再追加调查' }, { status: 409 });
    return streamResponse(running);
  }

  // 追加调查: the new sub-question joins the plan as a new version, approved by the owner's own click on this very action
  let subQuestionId = '';
  if (followUp) {
    try {
      const added = await addFollowUpSubQuestion({ vault: getVault(), workspacePath, researchDir, role: ctx.role, claimId: followUp.claimId, question: followUp.question });
      subQuestionId = added.subQuestionId;
      ctx = await buildToolContext({ vault: getVault(), role: ctx.role, workspacePath, track: 'research', researchDir, abortSignal: abort.signal });
    } catch (e) {
      const status = e instanceof FollowUpDenied ? 409 : e instanceof PlanSaveDenied || e instanceof ApprovalDenied ? 403 : 500;
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
    }
  }

  // The run is read to its end by the job, whether or not a request is still attached to it.
  const startedAt = Date.now();
  return startRunJob({
    key,
    ctx,
    abort,
    mode: followUp ? followUp.budget : mode,
    startedAt,
    run: async ({ emit, signal }) =>
      followUp ? executeFollowUp({ ctx, claimId: followUp.claimId, subQuestionId, emit, signal, budget: followUp.budget }) : executeResearch({ ctx, mode, claimIds, emit, signal }),
  });
}
