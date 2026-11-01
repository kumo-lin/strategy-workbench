/**
 * A research run is a background job, not a part of one HTTP request (5.0 run-through 3.20: a dropped
 * connection killed the run half way). The route starts the job; any request may attach to it, get the
 * chunks so far, and follow it live. Closing a tab or refreshing the page detaches a reader and nothing else.
 *
 * The job lives in this server process (the registry sits on globalThis so dev-mode reloads keep it); what
 * outlives the process is the vault: the plan, the log rows (research:start / research:done / research:failed)
 * and the report. `interruptedRun` reads the log to tell a run that died with the server.
 */
import type { UIMessageChunk } from 'ai';

/** How long a finished job can still be attached to (a refresh right after the end still shows the steps). */
export const FINISHED_JOB_TTL_MS = 10 * 60_000;

export interface ResearchJob {
  key: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  chunks: UIMessageChunk[];
  abort: AbortController;
  listeners: Set<() => void>;
}

const registry = (): Map<string, ResearchJob> => {
  const g = globalThis as { __researchJobs?: Map<string, ResearchJob> };
  return (g.__researchJobs ??= new Map());
};

export const jobKey = (workspacePath: string, researchDir: string) => `${workspacePath}\n${researchDir}`;

/** The job for this investigation if one is running, or finished less than FINISHED_JOB_TTL_MS ago. */
export function findJob(key: string, now = Date.now()): ResearchJob | null {
  const job = registry().get(key);
  if (!job) return null;
  if (job.status !== 'running' && job.finishedAt !== null && now - job.finishedAt > FINISHED_JOB_TTL_MS) {
    registry().delete(key);
    return null;
  }
  return job;
}

export const isRunning = (key: string) => findJob(key)?.status === 'running';

/** Starts `source` as a job: it is read to the end whether or not anybody is attached. */
export function startJob(key: string, source: ReadableStream<UIMessageChunk>, abort: AbortController, now = Date.now(), opts?: { prefix?: UIMessageChunk[]; onEnd?: (job: ResearchJob) => Promise<void> | void }): ResearchJob {
  const job: ResearchJob = { key, status: 'running', startedAt: now, finishedAt: null, chunks: [...(opts?.prefix ?? [])], abort, listeners: new Set() };
  registry().set(key, job);
  const notify = () => job.listeners.forEach((l) => l());
  void (async () => {
    const reader = source.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        job.chunks.push(value);
        if (value.type === 'error') job.status = 'failed';
        notify();
      }
    } catch (e) {
      job.chunks.push({ type: 'error', errorText: e instanceof Error ? e.message : String(e) });
      job.status = 'failed';
    } finally {
      // saved while the job still counts as running: a follow-up request (the owner's "continue") is refused until the
      // save is done, so it can never read a stage that was not stored yet
      try {
        await opts?.onEnd?.(job);
      } catch {
        /* a failed save must never fail the run */
      }
      if (job.status === 'running') job.status = 'done';
      job.finishedAt = Date.now();
      notify();
    }
  })();
  return job;
}

/** What a later stage can put before its own stream, without terminating the combined run early. */
export function replayableChunks(chunks: UIMessageChunk[]): UIMessageChunk[] {
  return chunks.filter((chunk) => !['finish', 'abort', 'data-result', 'data-attach', 'error'].includes(chunk.type));
}

/** A stream of the job from its first chunk: what happened so far, then what happens next, closing when it ends. */
export function attachToJob(job: ResearchJob): ReadableStream<UIMessageChunk> {
  let sent = 0;
  let wake: (() => void) | null = null;
  const poke = () => wake?.();
  // Whether this reader joined a run that had already ended (a replay): the page must not act as if it just finished.
  const replay = job.status !== 'running';
  let told = false;
  return new ReadableStream<UIMessageChunk>({
    start() {
      job.listeners.add(poke);
    },
    async pull(controller) {
      for (;;) {
        if (sent > 0 && !told) {
          told = true;
          controller.enqueue({ type: 'data-attach', data: { replay }, transient: true } as UIMessageChunk);
          return;
        }
        if (sent < job.chunks.length) {
          controller.enqueue(job.chunks[sent++]);
          return;
        }
        if (job.status !== 'running') {
          job.listeners.delete(poke);
          controller.close();
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    },
    // a reader that goes away (closed tab, refresh) only detaches itself
    cancel() {
      job.listeners.delete(poke);
    },
  });
}

/** Test hook. */
export function clearJobs() {
  registry().clear();
}

export interface LogRowLike {
  action: string;
  time: string;
  reason?: string;
}

/** Appended to the reason of the log rows that start or end a run: the workspace log is shared by all its investigations. */
export const runTag = (researchDir: string) => ` · 调查：${researchDir.split('/').pop()}`;
export const RUN_LOG_ACTIONS = ['research:start', 'research:followup', 'research:done', 'research:failed', 'research:awaiting-confirm', 'research:continue'];

/**
 * The log says a run started and nothing ended it (no research:done / research:failed / research:awaiting-confirm
 * after the last research:start or research:continue): the process died under it. Only meaningful when no job is
 * running in this process. A run paused for the owner's answer is not an interrupted one.
 */
export function interruptedRun(rows: LogRowLike[], researchDir: string): { startedAt: string } | null {
  let startedAt: string | null = null;
  for (const r of rows) {
    if (!(r.reason ?? '').endsWith(runTag(researchDir))) continue;
    if (r.action === 'research:start' || r.action === 'research:followup' || r.action === 'research:continue') startedAt = r.time;
    else if (startedAt && (r.action === 'research:done' || r.action === 'research:failed' || r.action === 'research:awaiting-confirm')) startedAt = null;
  }
  return startedAt ? { startedAt } : null;
}
