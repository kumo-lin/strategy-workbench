/**
 * A run: the library first, then the web for each sub-question with a gap. D-64 T22 (D2) removed the stop after the
 * vault (内部资料清单 and the owner's answer); what is left of that here is that a run goes on to the web by itself and
 * writes no inventory file. (The removed tests: the stop, waiting step 6, enough / not enough, a stale inventory.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { clearRunClient } from '@/lib/research/run-client';
import { RDIR, fakeWeb, scriptedModel, setup } from './research-fixture';

let cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  clearPageCache();
  // ingest's link check must never hit the network in tests
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  clearRunClient(RDIR);
  for (const c of cleanups) await c();
  cleanups = [];
});

type Fixture = Awaited<ReturnType<typeof setup>>;

async function fixture(opts: Parameters<typeof setup>[0] = {}): Promise<Fixture> {
  const fx = await setup(opts);
  cleanups.push(fx.cleanup);
  return fx;
}


/** A fake web that records when each search starts and ends, so overlapping rounds can be told from serial ones. */
function timedWeb() {
  const web = fakeWeb();
  const spans: { start: number; end: number }[] = [];
  const search = web.search;
  web.search = async (req, signal) => {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 25));
    try {
      return await search(req, signal);
    } finally {
      spans.push({ start, end: Date.now() });
    }
  };
  return { web, spans };
}

describe('a run goes on to the web by itself', () => {
  it('the two first web rounds of a claim’s sub-questions overlap in time', async () => {
    const fx = await fixture({ subQuestions: 2 });
    const { web, spans } = timedWeb();

    await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: web });

    expect(spans.length).toBeGreaterThanOrEqual(2);
    const firstTwo = [...spans].sort((a, b) => a.start - b.start).slice(0, 2);
    expect(firstTwo[1].start).toBeLessThan(firstTwo[0].end);
  });

  it('executeResearch delivers and writes no inventory file', async () => {
    const fx = await fixture();
    const result = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel({ inventQuote: true }).model, webClient: fakeWeb() });

    expect(result.delivered).toBe(true);
    expect(await fx.vault.exists(`${RDIR}/内部资料清单.json`)).toBe(false);
  });
});
