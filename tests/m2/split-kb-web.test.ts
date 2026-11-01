/**
 * M2_5b-1: the vault half and the web half of steps 2/3 and step 6 are separate functions, and the old
 * functions are their composition. Same behaviour: same evidence, same searches, same steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPageCache } from '@/lib/research/page-cache';
import type { ProgressEvent } from '@/lib/research/progress';
import { ResearchRun, type PlanClaim, type PlanSubQuestion } from '@/lib/research/run';
import { clearRunClient, startRunClient } from '@/lib/research/run-client';
import { counterKb, counterRound, counterWeb, firstRoundReserve, kbPass, phaseA, webPass } from '@/lib/research/execute';
import { RDIR, fakeWeb, scriptedModel, setup } from './research-fixture';

let extraCleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  clearPageCache();
  // ingest's link check must never hit the network in tests
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  clearRunClient(RDIR);
  for (const c of extraCleanups) await c();
  extraCleanups = [];
});

type Fixture = Awaited<ReturnType<typeof setup>>;

/** A fixture whose temp vault is removed after the test (a test may build several, to compare two runs). */
async function fixture(opts: Parameters<typeof setup>[0] = {}): Promise<Fixture> {
  const fx = await setup(opts);
  extraCleanups.push(fx.cleanup);
  return fx;
}

/** The approved plan's first claim and its first sub-question (C1-Q1: 知识库 + 网络). */
function firstClaim(fx: Fixture): { claim: PlanClaim; q: PlanSubQuestion } {
  const claim = fx.ctx.research!.plan!.claims[0];
  return { claim, q: claim.sub_questions[0] };
}

function makeRun(fx: Fixture, sm: ReturnType<typeof scriptedModel>, web: ReturnType<typeof fakeWeb>, events: ProgressEvent[] = []): ResearchRun {
  const client = startRunClient(RDIR, web, 'small');
  return new ResearchRun({ ctx: fx.ctx, mode: 'small', model: sm.model, client, emit: (e) => events.push(e), contextText: '' });
}

/** phaseA's held-fetch closure, for the tests that call kbPass + webPass themselves. */
function holdFetch(run: ResearchRun) {
  let held = true;
  const release = () => {
    if (held) run.reserve = { ...run.reserve, fetches: Math.max(0, run.reserve.fetches - 1) };
    held = false;
  };
  return release;
}

const stepsOf = (events: ProgressEvent[], id: string) => events.filter((e): e is Extract<ProgressEvent, { kind: 'step' }> => e.kind === 'step' && e.id === id);

describe('steps 2/3: the vault half alone never touches the web', () => {
  it('kbPass reads the vault, adds its evidence and emits s2 done; no search, no fetch', async () => {
    const fx = await fixture();
    const { claim, q } = firstClaim(fx);
    const web = fakeWeb();
    const sm = scriptedModel();
    const events: ProgressEvent[] = [];
    const run = makeRun(fx, sm, web, events);

    const kb = await kbPass(run, claim, q);
    expect(kb).not.toBeNull();
    expect(web.searches).toEqual([]);
    expect(web.fetches).toEqual([]);

    const evidence = run.evidenceFor(claim.id, q.id);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.round === 'kb')).toBe(true);
    expect(run.kbSources.size).toBeGreaterThan(0);
    expect(stepsOf(events, `s2:${q.id}`).at(-1)).toMatchObject({ status: 'done' });
  });

  it('kbPass then webPass = phaseA: same evidence refs and the same web searches', async () => {
    // run A: the old composition
    const fxA = await fixture();
    const a = firstClaim(fxA);
    const webA = fakeWeb();
    const runA = makeRun(fxA, scriptedModel(), webA);
    firstRoundReserve(runA, [a.q]);
    await phaseA(runA, a.claim, a.q);

    // run B: the two halves, with the same held fetch released the same way
    const fxB = await fixture();
    const b = firstClaim(fxB);
    const webB = fakeWeb();
    const runB = makeRun(fxB, scriptedModel(), webB);
    firstRoundReserve(runB, [b.q]);
    const release = holdFetch(runB);
    const kb = await kbPass(runB, b.claim, b.q);
    expect(kb).not.toBeNull();
    if (kb) await webPass(runB, b.claim, b.q, kb.qp, release);
    release();

    const refs = (run: ResearchRun, claim: PlanClaim, q: PlanSubQuestion) => run.evidenceFor(claim.id, q.id).map((e) => e.ref).sort();
    expect(refs(runB, b.claim, b.q)).toEqual(refs(runA, a.claim, a.q));
    expect(webB.searches).toEqual(webA.searches);
    expect(webB.fetches).toEqual(webA.fetches);
  });

  it('when the vault alone is enough, kbPass skips step 3 and webPass does nothing', async () => {
    const fx = await fixture({ withSourceB: true });
    const { claim, q } = firstClaim(fx);
    const web = fakeWeb({ refuting: false });
    // the vault alone decides: every vault block counts as support, two publishers, one A-grade source
    const sm = scriptedModel({ stance: () => 'supports' });
    const events: ProgressEvent[] = [];
    const run = makeRun(fx, sm, web, events);

    const kb = await kbPass(run, claim, q);
    expect(kb).not.toBeNull();
    expect(stepsOf(events, `s3:${q.id}`).at(-1)).toMatchObject({ status: 'skipped' });
    expect(run.subStates.get(q.id)!.stop).toBe('decidable');

    if (kb) await webPass(run, claim, q, kb.qp);
    expect(web.searches).toEqual([]);
    expect(web.fetches).toEqual([]);
  });
});

describe('step 6: the vault half and the web half of the counter round', () => {
  it('counterKb alone does not search; counterKb + counterWeb = counterRound', async () => {
    // the counter round's vault half alone
    const fxAlone = await fixture();
    const alone = firstClaim(fxAlone);
    const webAlone = fakeWeb();
    const runAlone = makeRun(fxAlone, scriptedModel(), webAlone);
    const aloneKb = await counterKb(runAlone, alone.claim, alone.q);
    expect(aloneKb).not.toBeNull();
    expect(webAlone.searches).toEqual([]);

    // the two halves
    const fxSplit = await fixture();
    const split = firstClaim(fxSplit);
    const webSplit = fakeWeb();
    const runSplit = makeRun(fxSplit, scriptedModel(), webSplit);
    const splitKb = await counterKb(runSplit, split.claim, split.q);
    expect(splitKb).not.toBeNull();
    await counterWeb(runSplit, split.claim, split.q, splitKb);

    // the old composition
    const fxOld = await fixture();
    const old = firstClaim(fxOld);
    const webOld = fakeWeb();
    const runOld = makeRun(fxOld, scriptedModel(), webOld);
    await counterRound(runOld, old.claim, old.q);

    expect(webSplit.searches.length).toBe(webOld.searches.length);
    // the note names the vault result and the web round by their content: identical runs, identical text
    expect(runSplit.counterNotes.get(split.claim.id)).toBe(runOld.counterNotes.get(old.claim.id));
    expect(webSplit.searches).toEqual(webOld.searches);
  });
});

describe('phaseA releases the sub-question’s reserved fetch exactly once', () => {
  /** Counts the release's one write to `run.reserve` (a second release is a no-op, `held` guards it). */
  function watchReserve(run: ResearchRun) {
    let reserve = run.reserve;
    let writes = 0;
    Object.defineProperty(run, 'reserve', {
      configurable: true,
      get: () => reserve,
      set: (v) => {
        reserve = v;
        writes += 1;
      },
    });
    return () => writes;
  }

  async function runPhaseA(setupOpts: Parameters<typeof setup>[0], script: Parameters<typeof scriptedModel>[0], arrange?: (run: ResearchRun) => void) {
    const fx = await fixture(setupOpts);
    const { claim, q } = firstClaim(fx);
    const run = makeRun(fx, scriptedModel(script), fakeWeb());
    firstRoundReserve(run, [q]);
    const writes = watchReserve(run);
    arrange?.(run);
    expect(run.reserve.fetches).toBe(1);
    await phaseA(run, claim, q);
    return { run, q, writes: writes() };
  }

  it('vault decides: released once', async () => {
    const { run, writes } = await runPhaseA({ withSourceB: true }, { stance: () => 'supports' });
    expect(run.reserve.fetches).toBe(0);
    expect(writes).toBe(1);
  });

  it('web round: released once', async () => {
    const { run, writes } = await runPhaseA({}, {});
    expect(run.reserve.fetches).toBe(0);
    expect(writes).toBe(1);
  });

  it('kbPass error: released once', async () => {
    const { run, q, writes } = await runPhaseA({}, {}, (r) => {
      vi.spyOn(r, 'planQueries').mockRejectedValue(new Error('模型挂了'));
    });
    expect(run.subStates.get(q.id)?.stop).toBe('budget_exhausted');
    expect(run.reserve.fetches).toBe(0);
    expect(writes).toBe(1);
  });
});
