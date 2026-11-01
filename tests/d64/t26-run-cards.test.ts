/** D-64 T26: the run reports each search as a card (which one, files or web, the query, how many results, one line of judgment), and the stop. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import type { ProgressEvent, SearchCardEvent } from '@/lib/research/progress';
import { fakeWeb, scriptedModel, setup } from '../m2/research-fixture';

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

async function cards(script: Parameters<typeof scriptedModel>[0] = {}) {
  const fx = await setup();
  cleanup = fx.cleanup;
  const events: ProgressEvent[] = [];
  await executeResearch({ ctx: fx.ctx, mode: 'full', model: scriptedModel(script).model, webClient: fakeWeb(), emit: (e) => events.push(e) });
  return events.filter((e): e is SearchCardEvent => e.kind === 'search-card');
}

describe('T26 search cards', () => {
  it('each search is a card: its number, files or web, the query, the result count and a judgment', async () => {
    const cs = (await cards()).filter((c) => !c.stop);
    expect(cs.some((c) => c.source === 'files')).toBe(true);
    expect(cs.some((c) => c.source === 'web')).toBe(true);
    expect(cs.map((c) => c.n)).toEqual(cs.map((_, i) => i + 1));
    for (const c of cs) {
      expect(c.query.trim()).not.toBe('');
      expect(c.results).toBeGreaterThanOrEqual(0);
      expect(c.judgment.trim()).not.toBe('');
    }
    const web = cs.find((c) => c.source === 'web')!;
    expect(web.judgment).toMatch(/条相关证据|没有新证据/);
  });

  it('when two web rounds bring nothing new, a card says the gap search stops', async () => {
    // every page irrelevant: no new evidence round after round
    const cs = await cards({ stance: () => 'irrelevant' });
    const stop = cs.filter((c) => c.stop);
    expect(stop.length).toBeGreaterThan(0);
    expect(stop[0].judgment).toBe('连续 2 轮无新证据，停止补查');
  });
});
