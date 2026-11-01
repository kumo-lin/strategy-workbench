/**
 * The investigation a Workspace's flow is about (its "去确认" link), when two are equally far: S3-D48's WS-A has
 * 买方采购逻辑 and 买方采购逻辑（问题树）, both delivered; the sort kept the folder order and the button opened the old
 * one. Now: the one a decision still to confirm comes from, then the newest delivered report.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspaceFlow, pickInvestigation } from '@/lib/workflow/load';
import { createVault } from '@/lib/vault';

const P = '个人AI战略';
const WS = `20_项目/${P}/WS-A 买方`;
const D = `20_项目/${P}/决策`;
const OLD = `${D}/WS-A 买方决定-押可管管理栈不设AI溢价.md`;

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

/** S3-D48 as the demo copy builds it, with the fallback layer over it when asked (the two v10 cards). */
async function vault(o: { fallback?: boolean; withoutOld?: boolean } = {}) {
  root = await mkdtemp(path.join(tmpdir(), 'flow-inv-'));
  await cp('demo-vault/.snapshots/S3-D48', root, { recursive: true });
  if (o.fallback) await cp('demo-vault/.snapshots/fallback', root, { recursive: true });
  // S3-D48 already has the old draft swapped out (9e5473d); force keeps the test valid either way
  if (o.withoutOld) await rm(path.join(root, OLD), { force: true });
  return createVault(root);
}

describe('which investigation the flow is about', () => {
  it('S3-D48 with the v10 cards (fallback): the question tree, where the newest decision to confirm comes from', async () => {
    const flow = await loadWorkspaceFlow(await vault({ fallback: true }), P, WS);
    expect(flow.investigation).toEqual({ name: '买方采购逻辑（问题树）', state: 'reported' });
    expect(flow.facts.decisionDrafted).toBe(true);
  });

  it('the decision to confirm swapped for the v10 DeepSeek card (as C did on S3): the question tree', async () => {
    const v = await vault({ fallback: true, withoutOld: true });
    expect((await loadWorkspaceFlow(v, P, WS)).investigation?.name).toBe('买方采购逻辑（问题树）');
  });

  it('no decision to confirm: the newest delivered report (v10 of 10-26 over v4 of 10-25)', async () => {
    const v = await vault({ withoutOld: true });
    expect((await loadWorkspaceFlow(v, P, WS)).investigation?.name).toBe('买方采购逻辑（问题树）');
  });

  it('the rule on its own: the more advanced first; tied, a pending decision, then the newest report, else as listed', () => {
    const inv = (name: string, state: 'reported' | 'planning', updated = '', version = 0) => ({ name, state, latest: updated ? { updated, version } : null });
    expect(pickInvestigation([inv('a', 'planning'), inv('b', 'reported', '2026-10-25', 4)], new Map())?.name).toBe('b');
    expect(pickInvestigation([inv('a', 'reported', '2026-10-26', 10), inv('b', 'reported', '2026-10-25', 4)], new Map([['b', '2026-10-25']]))?.name).toBe('b');
    expect(pickInvestigation([inv('a', 'reported', '2026-10-26', 3), inv('b', 'reported', '2026-10-26', 10)], new Map())?.name).toBe('b');
    expect(pickInvestigation([inv('a', 'reported', '2026-10-26', 3), inv('b', 'reported', '2026-10-26', 3)], new Map())?.name).toBe('a');
    expect(pickInvestigation([], new Map())).toBeNull();
  });
});
