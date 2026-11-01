/** D-64 T22: when the internal library falls short the run goes to the web by itself (D2) — no stop to ask the owner. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import type { ProgressEvent } from '@/lib/research/progress';
import { writeSelection } from '@/lib/research/selection';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, scriptedModel, setup, WS } from '../m2/research-fixture';

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());
const stepsOf = (events: ProgressEvent[]) => events.filter((e) => e.kind === 'step') as Extract<ProgressEvent, { kind: 'step' }>[];

describe('T22 automatic web search', () => {
  it('1. a run checks the library, then goes to the web for the gaps on its own: no 内部资料清单.json, no waiting step', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const events: ProgressEvent[] = [];
    const web = fakeWeb();
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: web, emit: (e) => events.push(e) });
    expect(r.delivered).toBe(true);
    expect(web.fetches.length).toBeGreaterThan(0);
    expect(existsSync(path.join(fx.root, RDIR, '内部资料清单.json'))).toBe(false);
    const steps = stepsOf(events);
    expect(steps.some((s) => s.status === 'waiting')).toBe(false);
    // the internal pass is recorded for the run page: how many could be decided, how many went to the web
    expect(steps.find((s) => s.id === 's2:internal')?.detail).toMatch(/有缺口 \d+ 个，自动上网补查/);
    // the confirm step and its endpoint are gone
    expect(existsSync(path.resolve('app/api/research/continue/route.ts'))).toBe(false);
    expect(existsSync(path.resolve('app/api/research/inventory/route.ts'))).toBe(false);
  });

  it('2. 资料选择.json web: false — no web search, and the report says the owner turned it off', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    await writeSelection(fx.vault, ROLES.juniorA, WS, { excluded: [], starred: [], web: false });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR, now: () => new Date('2026-10-24T10:00:00Z') });
    const web = fakeWeb();
    const r = await executeResearch({ ctx, mode: 'small', model: scriptedModel().model, webClient: web });
    expect(web.searches).toEqual([]);
    expect(web.fetches).toEqual([]);
    expect((await fx.vault.read(r.reportPath)).body).toContain('负责人关掉了联网');
  });

  it('3. what the web search found is in the library: origin 网络, graded, and the investigation that fetched it', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const fetched = (await fx.vault.search({ types: ['source'], where: { origin: '网络' }, limit: 50 })).filter((h) => String(h.data.url).includes('-research.com'));
    expect(fetched.length).toBeGreaterThan(0);
    for (const h of fetched) {
      expect(['A', 'B', 'C']).toContain(h.data.grade);
      expect(h.data.fetched_in).toBe(RDIR);
    }
  });
});
