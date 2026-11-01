/**
 * 3.2 (5.0 run-through 3.20): a research run is a background job. A dropped connection or a refresh
 * detaches a reader and nothing else; the page re-attaches and sees the steps so far and the result.
 */
import type { UIMessageChunk } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachToJob, clearJobs, findJob, FINISHED_JOB_TTL_MS, interruptedRun, jobKey, runTag, startJob } from '@/lib/research/job';
import { ROLES } from '../helpers/fixture-vault';
import { setup, WS, RDIR } from './research-fixture';

const chunk = (id: string): UIMessageChunk => ({ type: 'data-step', id, data: { kind: 'step', id, step: 2, title: id, status: 'done' } }) as unknown as UIMessageChunk;

/** A source we feed by hand. */
function manualSource() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  const stream = new ReadableStream<UIMessageChunk>({ start: (c) => void (controller = c) });
  return { stream, push: (c: UIMessageChunk) => controller.enqueue(c), end: () => controller.close(), fail: (e: Error) => controller.error(e) };
}
async function drain(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const r = stream.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) return out;
    out.push(value);
  }
}
const ids = (cs: UIMessageChunk[]) => cs.filter((c) => c.type !== 'data-attach').map((c) => (c as { id?: string }).id);
const attachOf = (cs: UIMessageChunk[]) => (cs.find((c) => c.type === 'data-attach') as { data?: { replay: boolean }; transient?: boolean } | undefined);
const tick = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => clearJobs());

describe('job registry', () => {
  it('keeps running after the reader that started it goes away, and a later reader gets everything from the start', async () => {
    const src = manualSource();
    const job = startJob('k', src.stream, new AbortController());
    src.push(chunk('a'));
    const first = attachToJob(job).getReader();
    expect((await first.read()).value).toMatchObject({ id: 'a' });
    await first.cancel(); // the tab closed
    src.push(chunk('b'));
    await tick();
    expect(job.status).toBe('running');
    expect(job.chunks).toHaveLength(2);

    const late = drain(attachToJob(job)); // the refreshed page
    src.push(chunk('c'));
    src.end();
    expect(ids(await late)).toEqual(['a', 'b', 'c']);
    expect(job.status).toBe('done');
  });

  it('two readers at once both see everything', async () => {
    const src = manualSource();
    const job = startJob('k', src.stream, new AbortController());
    const a = drain(attachToJob(job));
    const b = drain(attachToJob(job));
    src.push(chunk('x'));
    src.push(chunk('y'));
    src.end();
    expect(ids(await a)).toEqual(['x', 'y']);
    expect(ids(await b)).toEqual(['x', 'y']);
  });

  it('an error chunk or a broken source marks the job failed, and readers still finish', async () => {
    const s1 = manualSource();
    const j1 = startJob('e1', s1.stream, new AbortController());
    s1.push({ type: 'error', errorText: 'boom' });
    s1.end();
    await drain(attachToJob(j1));
    expect(j1.status).toBe('failed');

    const s2 = manualSource();
    const j2 = startJob('e2', s2.stream, new AbortController());
    const reading = drain(attachToJob(j2));
    s2.fail(new Error('stream broke'));
    expect((await reading).filter((c) => c.type !== 'data-attach').at(-1)).toMatchObject({ type: 'error', errorText: 'stream broke' });
    expect(j2.status).toBe('failed');
  });

  it('a finished job can be attached to for a while, then it is forgotten', async () => {
    const src = manualSource();
    const job = startJob('t', src.stream, new AbortController());
    src.push(chunk('a'));
    src.end();
    expect(ids(await drain(attachToJob(job)))).toEqual(['a']);
    expect(findJob('t')).toBe(job);
    expect(findJob('t', (job.finishedAt ?? 0) + FINISHED_JOB_TTL_MS + 1)).toBeNull();
  });
});

describe('a reader is told whether it joined a run that had already ended', () => {
  it('live reader: replay false; a reader after the end: replay true; the note is transient (not part of the message)', async () => {
    const src = manualSource();
    const job = startJob('r', src.stream, new AbortController());
    src.push(chunk('a'));
    const live = drain(attachToJob(job));
    src.push(chunk('b'));
    src.end();
    expect(attachOf(await live)).toMatchObject({ data: { replay: false }, transient: true });
    const late = await drain(attachToJob(job));
    expect(attachOf(late)).toMatchObject({ data: { replay: true } });
    expect(ids(late)).toEqual(['a', 'b']);
  });
});

describe('interruptedRun (the log is what survives a restart)', () => {
  const dir = `${WS}/调查/R1`;
  const row = (action: string, time: string, researchDir = dir) => ({ action, time, reason: `x${runTag(researchDir)}` });
  it('a start with no end is an interrupted run; a done or failed after it settles it', () => {
    expect(interruptedRun([row('research:start', 't1')], dir)).toEqual({ startedAt: 't1' });
    expect(interruptedRun([row('research:start', 't1'), row('research:done', 't2')], dir)).toBeNull();
    expect(interruptedRun([row('research:start', 't1'), row('research:failed', 't2')], dir)).toBeNull();
    expect(interruptedRun([row('research:start', 't1'), row('research:done', 't2'), row('research:followup', 't3')], dir)).toEqual({ startedAt: 't3' });
  });
  it('rows of another investigation in the same workspace log do not count', () => {
    expect(interruptedRun([row('research:start', 't1', `${WS}/调查/别的调查`)], dir)).toBeNull();
    expect(interruptedRun([{ action: 'research:start', time: 't1', reason: '没有标记的旧行' }], dir)).toBeNull();
  });
  it('a run paused for the owner\'s answer is not interrupted; a continue starts one', () => {
    expect(interruptedRun([row('research:start', 't1'), row('research:awaiting-confirm', 't2')], dir)).toBeNull();
    expect(interruptedRun([row('research:start', 't1'), row('research:awaiting-confirm', 't2'), row('research:continue', 't3')], dir)).toEqual({ startedAt: 't3' });
    expect(interruptedRun([row('research:start', 't1'), row('research:awaiting-confirm', 't2'), row('research:continue', 't3'), row('research:done', 't4')], dir)).toBeNull();
  });
});

describe('POST /api/research/execute', () => {
  let cleanup: (() => Promise<void>) | null = null;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(async () => {
    vi.doUnmock('@/lib/vault');
    vi.doUnmock('@/lib/session/role');
    vi.doUnmock('@/lib/research/execute');
    vi.doUnmock('@/lib/models/provider');
    vi.doUnmock('@/lib/deepseek');
    await cleanup?.();
    cleanup = null;
  });

  /** The route over a fixture vault, with an execute we can hold open. */
  async function route() {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const executeResearch = vi.fn(async ({ emit }: { emit: (e: unknown) => void }) => {
      emit({ kind: 'step', id: 's1', step: 1, title: '拆问题', status: 'done' });
      await gate;
      emit({ kind: 'step', id: 's9', step: 9, title: '写报告', status: 'done' });
      return { delivered: true, failedChecks: [], usage: { searches: 1, fetches: 1, retries: 0 }, durationMs: 5 };
    });
    vi.doMock('@/lib/vault', async (orig) => ({ ...(await orig<object>()), getVault: () => fx.vault }));
    let role = ROLES.juniorA;
    vi.doMock('@/lib/session/role', () => ({ getCurrentRole: async () => role }));
    vi.doMock('@/lib/research/execute', async (orig) => ({ ...(await orig<object>()), executeResearch }));
    const mod = await import('@/app/api/research/execute/route');
    const jobs = await import('@/lib/research/job');
    jobs.clearJobs();
    const post = () => mod.POST(new Request('http://x/api/research/execute', { method: 'POST', body: JSON.stringify({ workspacePath: WS, researchDir: RDIR, mode: 'small' }) }));
    const get = () => mod.GET(new Request(`http://x/api/research/execute?${new URLSearchParams({ workspacePath: WS, researchDir: RDIR })}`));
    return { fx, release, executeResearch, post, get, jobs, as: (r: typeof role) => void (role = r) };
  }
  const sse = async (res: Response) => (await res.text()).split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)) as { type: string; id?: string });

  it('a dropped connection does not stop the run; a reconnect replays the steps and gets the result', async () => {
    const t = await route();
    const res = await t.post();
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read(); // the page got its first chunk …
    await reader.cancel(); // … and the connection dropped
    await tick();
    expect(t.jobs.findJob(t.jobs.jobKey(WS, RDIR))?.status).toBe('running');
    expect(t.executeResearch).toHaveBeenCalledTimes(1);

    const again = await t.get(); // the refreshed page asks for the run
    t.release();
    const chunks = await sse(again);
    expect(chunks.map((c) => c.type)).toContain('data-job');
    expect(chunks.filter((c) => c.type === 'data-step').map((c) => c.id)).toEqual(['s1', 's9']);
    expect(chunks.some((c) => c.type === 'data-result')).toBe(true);
  });

  it('a second click while it runs follows the same run instead of starting another', async () => {
    const t = await route();
    const first = await t.post();
    const second = await t.post();
    t.release();
    const [a, b] = await Promise.all([sse(first), sse(second)]);
    expect(t.executeResearch).toHaveBeenCalledTimes(1);
    expect(b.filter((c) => c.type === 'data-step').length).toBe(a.filter((c) => c.type === 'data-step').length);
  });

  it('while the owner\'s run is going, someone else\'s POST is refused (403), never attached; GET follows it', async () => {
    const t = await route();
    const first = await t.post();
    t.as(ROLES.juniorB);
    const other = await t.post();
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: expect.stringContaining('只有 Workspace 的负责人') });
    const follow = await t.get();
    expect(follow.status).toBe(200);
    t.release();
    await Promise.all([sse(first), sse(follow)]);
    expect(t.executeResearch).toHaveBeenCalledTimes(1);
  });

  it('GET with no run answers 204; a failed run is in the log as research:failed', async () => {
    const t = await route();
    expect((await t.get()).status).toBe(204);
    t.executeResearch.mockRejectedValueOnce(new Error('模型挂了'));
    const res = await t.post();
    const chunks = await sse(res);
    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    const log = await t.fx.vault.readLog(t.fx.ctx.logPath);
    expect(log.some((r) => r.action === 'research:failed' && r.reason.endsWith(runTag(RDIR)))).toBe(true);
    expect(t.jobs.findJob(jobKey(WS, RDIR))?.status).toBe('failed');
  });
  // D-64 T22: the vault-only stage, its inventory and POST /api/research/continue are gone (the run goes to the web by itself)
});
