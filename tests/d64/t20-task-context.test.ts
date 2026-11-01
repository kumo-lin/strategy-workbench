/** D-64 T20: before anything else in a phase, the AI reads its task context (read_task_context); code enforces it. */
import { afterEach, describe, expect, it } from 'vitest';
import { buildToolContext, buildToolsForPhase, executeTool, type ToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { writeSelection } from '@/lib/research/selection';
import type { ProgressEvent } from '@/lib/research/progress';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, scriptedModel, setup, WS } from '../m2/research-fixture';

const CONTRACT = `---
id: contract-p
type: contract
status: 已确认
created: "2026-10-27"
updated: "2026-10-27"
author: AI
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
question: 企业为什么买 AI PC？
decision: 先打哪个买方场景
decision_owner: 战略部
horizon: "2027"
geography: 全球
product_scope: AI PC
out_of_scope: [服务器]
success: 能定先打哪个场景
known: [联想已发布 Qira]
bar: 关键判断至少 2 个独立来源
approved_by: Senior
approved_at: "2026-10-27"
---
# 决策契约
`;
const REVIEW = `---
id: rev-g1
type: review
status: 已确认
created: "2026-10-27"
updated: "2026-10-27"
author: Junior A
derived_from: ["[[20_项目/P/WS-A/workplan v1|workplan v1]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
requester: Junior A
reviewer: Senior
result: 通过
gate: G1
---
# G1

## Comment

- （Senior）先看 IT 管理场景 ^m1
`;

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

async function fixture() {
  const fx = await setup({ meeting: true });
  cleanup = fx.cleanup;
  await fx.vault.write('20_项目/P/决策契约.md', { frontmatter: (await import('@/lib/vault/frontmatter')).parseMarkdown(CONTRACT).data, body: '# 决策契约\n' }, { checkLinks: false });
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(`${fx.root}/${WS}/review`, { recursive: true });
  await writeFile(`${fx.root}/${WS}/review/G1 2026-10-27.md`, REVIEW);
  return fx;
}
const workspaceCtx = (vault: ToolContext['vault']) => buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS, track: 'workspace' });
const names = (ctx: ToolContext) => Object.keys(buildToolsForPhase(ctx)).sort();

describe('T20 read_task_context', () => {
  it('1. returns the contract, the plan, the opinions, the decisions, the reports and the selection', async () => {
    const fx = await fixture();
    await writeSelection(fx.vault, ROLES.juniorA, WS, { excluded: [], starred: ['10_资料库/资料甲.md'], web: true });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
    const out = (await executeTool('read_task_context', {}, ctx)) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['contract', 'decisions', 'opinions', 'plan', 'reports', 'selection']);
    expect(out.contract).toMatchObject({ question: '企业为什么买 AI PC？', status: '已确认' });
    expect(out.plan).toMatchObject({ workplan: expect.stringContaining('workplan v1'), research: expect.stringContaining('计划 v1') });
    expect(out.opinions).toEqual([expect.objectContaining({ text: '先看 IT 管理场景' })]);
    expect(out.selection).toMatchObject({ starred: ['10_资料库/资料甲.md'], web: true });
  });

  it('2–3. before the first call of a phase only read_task_context is offered; after it, every tool', async () => {
    const fx = await fixture();
    const ctx = await workspaceCtx(fx.vault);
    expect(names(ctx)).toEqual(['read_task_context']);
    await executeTool('read_task_context', {}, ctx);
    expect(names(ctx)).toContain('vault_search');
    expect(names(ctx)).toContain('read_task_context');
    // a new request reads the log: the same phase does not ask again
    expect(names(await workspaceCtx(fx.vault))).toContain('write_draft');
  });

  it('4. when the phase changes (the plan approved: research_plan → research_execute) it must read again', async () => {
    const fx = await fixture();
    const planCtx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
    expect(planCtx.phase).toBe('research_execute'); // the fixture's plan is approved
    await executeTool('read_task_context', {}, planCtx);
    expect(names(await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR }))).toContain('web_search');
    // the workspace track is another phase (workplan): read again there
    expect(names(await workspaceCtx(fx.vault))).toEqual(['read_task_context']);
  });

  it('5. the orchestrated run starts by loading the task context, with its step event', async () => {
    const fx = await fixture();
    const events: ProgressEvent[] = [];
    await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb(), emit: (e) => events.push(e) });
    const steps = events.filter((e) => e.kind === 'step') as Extract<ProgressEvent, { kind: 'step' }>[];
    expect(steps[0].title).toBe('读取决策契约、研究计划和 Senior 意见');
    const log = await fx.vault.readLog(`${WS}/日志.md`);
    const first = log.findIndex((e) => e.action === 'tool:read_task_context');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(log.findIndex((e) => e.action.startsWith('tool:') && e.action !== 'tool:read_task_context')).toBeGreaterThan(first);
  });
});

describe('T20 on the research track before a plan exists', () => {
  it('one read is enough for the investigation, even with no plan yet (the log line names the folder)', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const { unlink } = await import('node:fs/promises');
    await unlink(`${fx.root}/${RDIR}/计划 v1.md`);
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
    expect(ctx.phase).toBe('research_plan');
    expect(ctx.taskContextRead).toBe(false);
    await executeTool('read_task_context', {}, ctx);
    expect((await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR })).taskContextRead).toBe(true);
    // another investigation of the same Workspace reads again
    expect((await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: `${WS}/调查/R2` })).taskContextRead).toBe(false);
  });
});
