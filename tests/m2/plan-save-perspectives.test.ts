/**
 * Saving an edited plan keeps its perspective fields (segment-3 flaky, 2026-10-25): the plan route's body schema did
 * not list `perspective` / `perspectives_skipped`, zod dropped them, and 计划 v2 then showed every team perspective as
 * left out ("漏了：买方、竞争对手、我方自身的布局、监管、技术供给") once the page reloaded it.
 * The real segment-3 snapshot, the same steps as the page: v1 → add C2-Q3 → JSON over the wire → the route's schema → save.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPerspectives } from '@/lib/config/perspectives';
import { perspectiveGaps } from '@/lib/research/perspectives';
import { planSaveRequestSchema } from '@/lib/research/plan-request';
import { savePlanVersion } from '@/lib/research/plan-save';
import { toEditable } from '@/lib/research/plan-types';
import { createVault } from '@/lib/vault';
import { ROLES } from '../helpers/fixture-vault';

const WS = '20_项目/个人AI战略/WS-B 用户';
const RDIR = `${WS}/调查/员工自带AI的程度`;

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('POST /api/research/plan body → savePlanVersion', () => {
  it('carries perspective and perspectives_skipped into 计划 v2, so the gap hint still says only 监管', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'plan-perspectives-'));
    // the same layers as e2e/support/vault.ts LAYERS['e2e-vault-segment3']
    for (const layer of ['e2e-vault', 'e2e-vault-g1', 'e2e-vault-g1-plan', 'e2e-vault-segment3']) await cp(path.resolve('tests/fixtures', layer), dir, { recursive: true });
    const vault = createVault(dir);
    const list = await loadPerspectives(vault);
    const v1 = toEditable((await vault.readTyped(`${RDIR}/计划 v1.md`, 'research_plan')).note);
    expect(perspectiveGaps(v1, list)).toEqual(['监管']);

    // the page: a third sub-question under C2, no perspective picked for it
    const edited = {
      ...v1,
      claims: v1.claims.map((c) => (c.id === 'C2' ? { ...c, sub_questions: [...c.sub_questions, { id: 'C2-Q3', question: '员工自带的 AI 工具，有多少已经接到了工作系统？', methods: ['网络' as const] }] } : c)),
    };
    const body = planSaveRequestSchema.parse(JSON.parse(JSON.stringify({ workspacePath: WS, researchDir: RDIR, plan: edited })));
    expect(body.plan.perspectives_skipped).toEqual(v1.perspectives_skipped);
    expect(body.plan.claims[0].perspective).toEqual(['买方']);
    expect(body.plan.claims[1].sub_questions[0].perspective).toEqual(['买方']);

    const saved = await savePlanVersion({ vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorB, plan: body.plan });
    expect(saved.name).toBe('计划 v2');
    const v2 = toEditable((await vault.readTyped(saved.path, 'research_plan')).note);
    expect(v2.perspectives_skipped).toEqual(v1.perspectives_skipped);
    expect(v2.claims.map((c) => c.perspective)).toEqual(v1.claims.map((c) => c.perspective));
    expect(v2.claims[1].sub_questions.map((q) => q.perspective)).toEqual([['买方'], ['买方'], undefined]);
    expect(perspectiveGaps(v2, list)).toEqual(['监管']);
  });
});
