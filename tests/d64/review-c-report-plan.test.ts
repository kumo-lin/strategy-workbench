import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { judgmentFilePath } from '@/lib/research/judgment-file';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { executeInterviewFollowUp } from '@/lib/research/interview-followup';
import { loadReportPlan } from '@/lib/research/report-plan';
import { createMockModel } from '@/lib/testing/mock-model';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from '../m2/research-fixture';
import { ROLES } from '../helpers/fixture-vault';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function report() {
  const fx = await setup({ subQuestions: 1 });
  cleanup = fx.cleanup;
  const r = await executeResearch({ ctx: fx.ctx, mode: 'full', model: scriptedModel({ summaryExtra: (k) => ({ reasons: [{ title: '采购由IT主导', basis: [{ text: '采购由 IT 部门主导', kind: '事实', source: '资料甲', refs: k ? [k] : [] }] }], gaps: [], recommendations: [{ title: '先验证', how: '先找IT部门', refs: ['H1'] }] }) }).model, webClient: fakeWeb() });
  expect(r.delivered).toBe(true);
  return { ...fx, base: await fx.vault.read(r.reportPath) };
}

describe('review C4 report-bound plans', () => {
  it.each([false, true])('ignores a newer plan (approved=%s), including a draft phase', async (approved) => {
    const fx = await report();
    const old = await fx.vault.readTyped(PLAN, 'research_plan');
    await fx.vault.write(`${RDIR}/计划 v2.md`, { frontmatter: { ...old.data, id: 'plan-r1-v2', version: 2, status: approved ? '已确认' : '探索性', approved_by_owner: approved ? 'Junior A' : null, approved_at: approved ? '2026-10-25T00:00:00Z' : null, claims: old.note.claims.map((c) => ({ ...c, statement: 'NEW PLAN MUST NOT LEAK', key: 'K4' })) }, body: '' });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
    const phaseBefore = ctx.phase;
    const planBefore = ctx.research?.plan;
    const result = await executeInterviewFollowUp({ ctx, interviews: [], model: createMockModel() });
    const next = await fx.vault.read(result.reportPath);
    expect(next.body).not.toContain('| K4 |');
    expect(next.data.research_plan).toEqual(fx.base.data.research_plan);
    expect(ctx.phase).toBe(phaseBefore);
    expect(ctx.research?.plan).toBe(planBefore);
    expect((await fx.vault.readTyped(`${RDIR}/计划 v2.md`, 'research_plan')).note.approved_at).toBe(approved ? '2026-10-25T00:00:00Z' : null);
    expect((await loadReportPlan(fx.vault, fx.base)).plan.question).toBe(old.note.question);
  });

  it.each([null, '[[计划 v99]]', '[[20_项目/Other/调查/R/计划 v1]]', '[[计划 v1#heading]]'])('rejects invalid binding %s before models and writes', async (binding) => {
    const fx = await report();
    await fx.vault.write(fx.base.path, { frontmatter: { ...fx.base.data, research_plan: binding }, body: fx.base.body }, { overwrite: true, checkLinks: false });
    const before = await fx.vault.list(RDIR);
    const write = vi.spyOn(fx.vault, 'write');
    const model = createMockModel();
    if (typeof model === 'string') throw new Error('Expected mock model object');
    const call = vi.spyOn(model, 'doGenerate');
    await expect(executeInterviewFollowUp({ ctx: fx.ctx, interviews: [], model })).rejects.toThrow(/计划/);
    expect(call).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(await fx.vault.list(RDIR)).toEqual(before);
  });

  it('rejects a mismatched stored judgment before any model call or file change', async () => {
    const fx = await report();
    const full = path.join(fx.root, judgmentFilePath(fx.base.path));
    const file = JSON.parse(await readFile(full, 'utf8'));
    file.claims[0].label = 'H99';
    await writeFile(full, JSON.stringify(file));
    const snapshot = async () => {
      const out: Record<string, string> = {};
      for (const p of (await readdir(fx.root, { recursive: true })).sort()) {
        try { out[p] = createHash('sha256').update(await readFile(path.join(fx.root, p))).digest('hex'); } catch { /* directories */ }
      }
      return out;
    };
    const before = await snapshot();
    const model = createMockModel();
    if (typeof model === 'string') throw new Error('Expected mock model object');
    const call = vi.spyOn(model, 'doGenerate');
    await expect(executeInterviewFollowUp({ ctx: fx.ctx, interviews: [], model })).rejects.toThrow(/计划/);
    expect(call).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('rejects mismatched or duplicate claim mappings and never falls back', async () => {
    const fx = await report();
    const valid = [{ claimId: 'C1', label: 'H1' }];
    expect((await loadReportPlan(fx.vault, fx.base, valid)).path).toBe(PLAN);
    for (const claims of [[{ claimId: 'C1', label: 'H2' }], [{ claimId: 'C99', label: 'H1' }], [...valid, ...valid]]) {
      await expect(loadReportPlan(fx.vault, fx.base, claims)).rejects.toThrow(/计划/);
    }
  });
});
