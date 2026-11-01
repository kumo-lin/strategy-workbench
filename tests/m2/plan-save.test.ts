/** 2.2 server side: saving an edited plan = a new unapproved version, which re-locks the research tools. */
import { afterEach, describe, expect, it } from 'vitest';
import { applyApprovalEvent, buildToolContext } from '@/lib/harness';
import { assertResearchDir, assertWorkspacePath, BadResearchPath, createResearchDir } from '@/lib/research/folders';
import { PlanSaveDenied, savePlanVersion } from '@/lib/research/plan-save';
import { toEditable } from '@/lib/research/plan-types';
import { ROLES } from '../helpers/fixture-vault';
import { PLAN, RDIR, setup, WS } from './research-fixture';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('savePlanVersion', () => {
  it('writes 计划 v2 by the owner, unapproved, and the research tools lock again until re-approval', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    expect(fx.ctx.phase).toBe('research_execute');
    const plan = toEditable(fx.ctx.research!.plan!);
    plan.claims[0].sub_questions[0].question = '改过的问法：谁最终拍板？';
    const saved = await savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan });
    expect(saved).toMatchObject({ name: '计划 v2', version: 2 });
    const note = await fx.vault.readTyped(saved.path, 'research_plan');
    expect(note.note).toMatchObject({ author: 'Junior A', version: 2, approved_by_owner: null, approved_at: null, exploratory: false, status: '进行中' });
    expect(note.note.claims[0].sub_questions[0].question).toBe('改过的问法：谁最终拍板？');
    // v1 is untouched and the latest plan is now unapproved
    expect((await fx.vault.read(PLAN)).data.status).toBe('已确认');
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
    expect(ctx.phase).toBe('research_plan');
    // the owner approves v2 → unlocked again
    await applyApprovalEvent(fx.vault, { type: 'research_plan.approve', actor: ROLES.juniorA, workspace: `${WS}/workspace.md`, plan: saved.path }, { logPath: `${WS}/日志.md` });
    const ctx2 = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
    expect(ctx2.phase).toBe('research_execute');
    expect((await fx.vault.readLog(`${WS}/日志.md`)).some((r) => r.action === 'write:计划 v2')).toBe(true);
  });

  it('a quote shortened with an ellipsis is marked 『…』, not passed on as a verbatim quote; the re-rendered plan is citation-checked', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const plan = toEditable(fx.ctx.research!.plan!);
    plan.claims[0].conditions = ['采购由 IT 牵头：「IT 可管理性 … 首要考量。」[[资料甲#^c1]]'];
    const saved = await savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan });
    const body = (await fx.vault.read(saved.path)).body;
    expect(body).toContain('『IT 可管理性 … 首要考量。』[[资料甲#^c1]]');
    expect(body).not.toContain('「IT 可管理性');
    expect((await fx.vault.checkCitations(body)).every((c) => c.ok)).toBe(true);
    // dates are the calendar day, not a UTC instant
    expect(String((await fx.vault.read(saved.path)).data.updated)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a quote that is not in its block (no ellipsis) stops the save: no 计划 v2 is written', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const plan = toEditable(fx.ctx.research!.plan!);
    plan.claims[0].conditions = ['采购由 IT 牵头：「员工自己决定一切」[[资料甲#^c1]]'];
    await expect(savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan })).rejects.toThrow(/引用没通过检查/);
    expect(await fx.vault.exists(`${RDIR}/计划 v2.md`)).toBe(false);
  });

  it('only the workspace owner may edit', async () => {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    const plan = toEditable(fx.ctx.research!.plan!);
    await expect(savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorB, plan })).rejects.toBeInstanceOf(PlanSaveDenied);
    await expect(savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.senior, plan })).rejects.toBeInstanceOf(PlanSaveDenied);
  });
});

describe('research folders', () => {
  it('rejects paths that leave the workspace / wikilink-hostile names', () => {
    expect(() => assertWorkspacePath('20_项目/P/WS-A')).not.toThrow();
    for (const bad of ['../x', '20_项目/P', '20_项目/P/../WS-A', '10_资料库/x/y', '20_项目/P/WS-A/调查']) expect(() => assertWorkspacePath(bad)).toThrow(BadResearchPath);
    expect(() => assertResearchDir(WS, `${WS}/调查/R1`)).not.toThrow();
    for (const bad of [`${WS}/调查/..`, `${WS}/调查/a/b`, `${WS}/review/R1`, '20_项目/P/WS-B/调查/R1']) expect(() => assertResearchDir(WS, bad)).toThrow(BadResearchPath);
  });

  it('createResearchDir sanitises and de-duplicates the name', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const a = await createResearchDir(fx.vault, WS, 'IT [可管理性] #1 / 调查');
    expect(a).toBe(`${WS}/调查/IT 可管理性 1 调查`);
    const b = await createResearchDir(fx.vault, WS, 'IT [可管理性] #1 / 调查');
    expect(b).toBe(`${WS}/调查/IT 可管理性 1 调查 2`);
    await expect(createResearchDir(fx.vault, WS, ' / ')).rejects.toBeInstanceOf(BadResearchPath);
  });
});
