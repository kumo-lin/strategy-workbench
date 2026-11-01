import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyApprovalEvent, ApprovalDenied, planApprovalEvent, type EventState } from '@/lib/harness';
import type { ResearchPlanNote, WorkspaceNote, WorkspaceStage } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from './helpers/fixture-vault';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

const WS = '20_项目/P/WS-A';
const WS_PATH = `${WS}/workspace.md`;
const PLAN_PATH = `${WS}/调查/计划 v1.md`;
const NOW = '2026-10-24T08:00:00.000Z';

const wsFm = (stage: WorkspaceStage): WorkspaceNote => ({
  id: 'ws-a',
  type: 'workspace',
  status: '已确认',
  created: '2026-10-24',
  updated: '2026-10-24',
  author: 'Senior',
  derived_from: ['[[团队]]'],
  relates_to: ['[[团队]]'],
  week: 'W2',
  owner: 'Junior A',
  reviewer: 'Senior',
  stage,
  flags: [],
  depends_on: [],
});

const planFm = (): ResearchPlanNote => ({
  id: 'ws-a-r1-plan-v1',
  type: 'research_plan',
  status: '进行中',
  created: '2026-10-24',
  updated: '2026-10-24',
  author: 'AI',
  derived_from: [`[[${WS}/workplan v1]]`],
  relates_to: [`[[${WS_PATH}]]`],
  version: 1,
  question: '企业为什么买？',
  purpose: '验证 H1',
  claims: [
    {
      id: 'C1',
      statement: 'IT 能管才买',
      hypothesis: null,
      conditions: ['采购决策由 IT 主导'],
      sub_questions: [{ id: 'C1-Q1', question: '谁决定采购？', methods: ['知识库', '网络'] }],
      counter_search: '找业务部门主导采购的案例',
    },
  ],
  approved_by_owner: null,
  approved_at: null,
  exploratory: true,
});

const stateFor = (stage: WorkspaceStage): EventState => ({
  [WS_PATH]: wsFm(stage),
  [PLAN_PATH]: planFm(),
});

const approve = () => ({ type: 'research_plan.approve' as const, actor: ROLES.juniorA, workspace: WS_PATH, plan: PLAN_PATH });

describe('research_plan.approve starts the workspace', () => {
  it('moves 拆题中 → 执行中 and says so', () => {
    const plan = planApprovalEvent(approve(), stateFor('拆题中'), NOW);
    expect(plan).toEqual({
      ok: true,
      patches: [
        { path: PLAN_PATH, set: { status: '已确认', approved_by_owner: 'Junior A', approved_at: NOW, updated: NOW } },
        { path: WS_PATH, set: { stage: '执行中', updated: NOW } },
      ],
      summary: 'Junior A 批准调查计划 v1，开始执行',
    });
  });

  it('moves workplan待审 → 执行中 too', () => {
    const plan = planApprovalEvent(approve(), stateFor('workplan待审'), NOW);
    expect(plan.ok && plan.patches).toContainEqual({ path: WS_PATH, set: { stage: '执行中', updated: NOW } });
    expect(plan.ok && plan.summary).toBe('Junior A 批准调查计划 v1，开始执行');
  });

  it.each(['执行中', '结论待审', '撰写中', '完成'] as const)('leaves %s alone', (stage) => {
    const plan = planApprovalEvent(approve(), stateFor(stage), NOW);
    expect(plan.ok && plan.patches).toEqual([
      { path: PLAN_PATH, set: { status: '已确认', approved_by_owner: 'Junior A', approved_at: NOW, updated: NOW } },
    ]);
    expect(plan.ok && plan.patches.some((p) => 'stage' in p.set)).toBe(false);
    expect(plan.ok && plan.summary).toBe('Junior A 批准调查计划 v1');
  });

  it('unlocks the 结论 gate on a real vault', async () => {
    await vault.write(PLAN_PATH, { frontmatter: planFm(), body: '# 计划 v1\n' });
    await applyApprovalEvent(vault, approve(), { now: new Date(NOW) });
    expect((await vault.read(WS_PATH)).note).toMatchObject({ stage: '执行中' });

    await applyApprovalEvent(vault, {
      type: 'review.request',
      gate: '结论',
      subject: `${WS}/报告/报告 v1.md`,
      actor: ROLES.juniorA,
      workspace: WS_PATH,
    });
    expect((await vault.read(WS_PATH)).note).toMatchObject({ stage: '结论待审' });
  });

  it('is still denied to a non-owner', async () => {
    await expect(planApprovalEvent({ ...approve(), actor: ROLES.juniorB }, stateFor('拆题中'), NOW)).toMatchObject({ ok: false });
    await expect(
      applyApprovalEvent(vault, {
        type: 'research_plan.approve',
        actor: ROLES.juniorB,
        workspace: WS_PATH,
        plan: PLAN_PATH,
      }),
    ).rejects.toBeInstanceOf(ApprovalDenied);
  });
});
