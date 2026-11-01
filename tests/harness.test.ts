import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyApprovalEvent,
  ApprovalDenied,
  buildToolContext,
  buildToolsForPhase,
  executeTool,
  PHASE_TOOLS,
  PHASES,
  resolvePhase,
  TOOL_NAMES,
  TOOL_SPECS,
  toolNamesForPhase,
  ToolNotAllowedError,
  type ToolContext,
} from '@/lib/harness';
import type { WebToolsClient } from '@/lib/deepseek/web-tools';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from './helpers/fixture-vault';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

const WS = '20_项目/P/WS-A';
const RESEARCH = `${WS}/调查/H1 采购动因`;
const NOW = () => new Date('2026-10-24T08:00:00.000Z');

const planFm = (over: Record<string, unknown> = {}) => ({
  id: 'ws-a-r1-plan-v1',
  type: 'research_plan',
  status: '进行中',
  created: '2026-10-24',
  updated: '2026-10-24',
  author: 'AI',
  derived_from: [`[[${WS}/workplan v1]]`],
  relates_to: [`[[${WS}/workspace]]`],
  version: 1,
  question: '企业为什么买？',
  purpose: '验证 H1',
  claims: [
    {
      id: 'C1',
      statement: 'IT 能管才买',
      conditions: ['采购决策由 IT 主导'],
      sub_questions: [{ id: 'C1-Q1', question: '谁决定采购？', methods: ['知识库', '网络'] }],
      counter_search: '找业务部门主导采购的案例',
    },
  ],
  approved_by_owner: null,
  approved_at: null,
  exploratory: true,
  ...over,
});

async function ctxFor(track: 'workspace' | 'research', role = ROLES.juniorA): Promise<ToolContext> {
  const ctx = await buildToolContext({ vault, role, workspacePath: WS, track, researchDir: track === 'research' ? RESEARCH : undefined, now: NOW });
  ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)
  const fakeWeb: WebToolsClient = {
    search: async () => ({ results: [{ url: 'https://x.test', title: 't', site_name: 's', summary: 'sum', rerank_score: 1, authority: 3 }] }),
    fetch: async () => ({ title: 't', content: 'c' }),
  };
  return { ...ctx, webTools: async () => fakeWeb };
}

describe('phase → tool table (§10.2)', () => {
  it('matches the PRD table exactly', () => {
    expect(PHASE_TOOLS).toEqual({
      // D-64 T20: every phase starts by reading its task context
      workplan: ['read_task_context', 'ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft', 'submit_for_review', 'frame_topic', 'compose_workplan'],
      research_plan: ['read_task_context', 'ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft'],
      research_execute: ['read_task_context', 'ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft', 'web_search', 'web_fetch', 'ingest_source', 'check_citations', 'propose_decision'],
      conclusion: ['read_task_context', 'ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft', 'check_citations', 'submit_for_review', 'propose_decision', 'propose_knowledge'],
      // D-64 T33: a new project's framing
      project_framing: ['read_task_context', 'ask_user', 'frame_topic', 'draft_contract', 'draft_issue_tree'],
      // D-64 T37: the files page's chat
      files_chat: ['read_task_context', 'vault_search', 'set_selection'],
    });
  });

  it('never exposes web tools outside research_execute', () => {
    for (const phase of PHASES) {
      const hasWeb = ['web_search', 'web_fetch', 'ingest_source'].some((t) => PHASE_TOOLS[phase].includes(t as never));
      expect(hasWeb).toBe(phase === 'research_execute');
    }
  });

  it('registers a spec for every tool name', () => {
    for (const n of TOOL_NAMES) expect(TOOL_SPECS[n].name).toBe(n);
  });

  it('passes only implemented tools of the phase to the model', async () => {
    const ctx = await ctxFor('workspace');
    expect(ctx.phase).toBe('workplan');
    expect(Object.keys(buildToolsForPhase(ctx)).sort()).toEqual(toolNamesForPhase('workplan').sort());
    expect(Object.keys(buildToolsForPhase(ctx))).not.toContain('web_search');
    // ask_user is a client tool: present, but with no execute
    expect(buildToolsForPhase(ctx).ask_user.execute).toBeUndefined();
  });
});

describe('phase resolution', () => {
  it('derives the phase from stage and plan approval only', () => {
    expect(resolvePhase({ track: 'workspace', stage: '拆题中' })).toBe('workplan');
    expect(resolvePhase({ track: 'workspace', stage: '执行中' })).toBe('workplan');
    expect(resolvePhase({ track: 'workspace', stage: '结论待审' })).toBe('conclusion');
    expect(resolvePhase({ track: 'research', plan: null })).toBe('research_plan');
    expect(resolvePhase({ track: 'research', plan: { status: '进行中', approved_by_owner: null, approved_at: null } })).toBe('research_plan');
    // status alone is not approval
    expect(resolvePhase({ track: 'research', plan: { status: '已确认', approved_by_owner: null, approved_at: null } })).toBe('research_plan');
    expect(resolvePhase({ track: 'research', plan: { status: '已确认', approved_by_owner: 'Junior A', approved_at: '2026-10-24' } })).toBe('research_execute');
  });
});

describe('executeTool guard + logging', () => {
  it('rejects research tools before the plan is approved, and logs the attempt', async () => {
    await vault.write(`${RESEARCH}/计划 v1.md`, { frontmatter: planFm(), body: '# 计划 v1\n' });
    const ctx = await ctxFor('research');
    expect(ctx.phase).toBe('research_plan');
    await expect(executeTool('web_search', { sub_question_id: 'C1-Q1', query: 'x' }, ctx)).rejects.toBeInstanceOf(ToolNotAllowedError);
    const log = await vault.readLog(ctx.logPath);
    expect(log.at(-1)).toMatchObject({ actor: 'AI', action: 'tool:web_search' });
    expect(log.at(-1)!.change).toMatch(/^✗/);
  });

  it('unlocks research tools after the owner approves, limited to plan sub-questions', async () => {
    await vault.write(`${RESEARCH}/计划 v1.md`, { frontmatter: planFm(), body: '# 计划 v1\n' });
    // AI cannot approve; a non-owner human cannot either
    await expect(
      applyApprovalEvent(vault, { type: 'research_plan.approve', actor: ROLES.juniorB, workspace: `${WS}/workspace.md`, plan: `${RESEARCH}/计划 v1.md` }),
    ).rejects.toBeInstanceOf(ApprovalDenied);
    await applyApprovalEvent(
      vault,
      { type: 'research_plan.approve', actor: ROLES.juniorA, workspace: `${WS}/workspace.md`, plan: `${RESEARCH}/计划 v1.md` },
      { now: NOW(), logPath: `${WS}/日志.md` },
    );
    const ctx = await ctxFor('research');
    expect(ctx.phase).toBe('research_execute');
    expect(Object.keys(buildToolsForPhase(ctx))).toContain('web_search');
    const out = (await executeTool('web_search', { sub_question_id: 'C1-Q1', query: 'IT 采购', why: '补缺口' }, ctx)) as { results: unknown[] };
    expect(out.results).toHaveLength(1);
    await expect(executeTool('web_search', { sub_question_id: 'C9-Q9', query: 'x' }, ctx)).rejects.toThrow(/not in the approved plan/);
    const log = await vault.readLog(ctx.logPath);
    expect(log.map((r) => r.action)).toEqual(['event:research_plan.approve', 'tool:web_search', 'tool:web_search']);
    expect(log[1].reason).toContain('补缺口');
  });

  it('runs vault tools in every phase and logs each call', async () => {
    const ctx = await ctxFor('workspace');
    const res = (await executeTool('vault_search', { query: '采购', why: '找资料' }, ctx)) as { hits: { path: string }[] };
    expect(res.hits[0].path).toBe('10_资料库/资料甲.md');
    const read = (await executeTool('vault_read', { path: '10_资料库/资料甲.md' }, ctx)) as { body: string };
    expect(read.body).toMatch(/untrusted-source-content-[0-9a-f]{16}/);
    const log = await vault.readLog(ctx.logPath);
    expect(log.map((r) => r.action)).toEqual(['tool:vault_search', 'tool:vault_read']);
  });
});

describe('write_draft', () => {
  const draftArgs = (over: Record<string, unknown> = {}) => ({
    note_type: 'hypothesis',
    name: 'WS-A-H2 预算来自 IT',
    frontmatter: {
      id: 'ws-a-h2',
      derived_from: [`[[${WS}/workplan v1]]`],
      relates_to: [`[[${WS}/workspace]]`],
      workspace: `[[${WS}/workspace]]`,
      statement: '预算来自 IT',
      verdict_proposed: null,
      verdict: '成立',
      evidence: [],
      counter_evidence: [],
    },
    body: '# H2\n',
    ...over,
  });

  it('writes a draft as AI, resetting human-only fields', async () => {
    const ctx = await ctxFor('workspace');
    const r = (await executeTool('write_draft', draftArgs(), ctx)) as { path: string };
    expect(r.path).toBe('20_项目/P/假设/WS-A-H2 预算来自 IT.md');
    const n = await vault.read(r.path);
    expect(n.note).toMatchObject({ author: 'AI', status: '进行中', verdict: null });
  });

  it('refuses types outside the phase scope and 已确认 status', async () => {
    const ctx = await ctxFor('workspace');
    await expect(executeTool('write_draft', draftArgs({ note_type: 'report', name: '报告 v1' }), ctx)).rejects.toBeInstanceOf(ToolNotAllowedError);
    await expect(executeTool('write_draft', draftArgs({ status: '已确认' }), ctx)).rejects.toThrow(/invalid arguments/);
  });

  it('refuses drafts without link fields', async () => {
    const ctx = await ctxFor('workspace');
    const args = draftArgs();
    (args.frontmatter as Record<string, unknown>).derived_from = [];
    await expect(executeTool('write_draft', args, ctx)).rejects.toMatchObject({ code: 'links_missing' });
  });

  it('marks research drafts exploratory before G1, and never overwrites an approved plan', async () => {
    const ctx = await ctxFor('research');
    const { type: _t, author: _a, status: _s, created: _c, updated: _u, ...fm } = planFm();
    await executeTool('write_draft', { note_type: 'research_plan', name: '计划 v1', frontmatter: fm, body: '# 计划\n' }, ctx);
    expect((await vault.read(`${RESEARCH}/计划 v1.md`)).note).toMatchObject({ exploratory: false, status: '进行中' });
    // owner approves; a later overwrite of v1 must fail
    await applyApprovalEvent(vault, { type: 'research_plan.approve', actor: ROLES.juniorA, workspace: `${WS}/workspace.md`, plan: `${RESEARCH}/计划 v1.md` });
    await expect(
      executeTool('write_draft', { note_type: 'research_plan', name: '计划 v1', frontmatter: fm, body: 'x' }, await ctxFor('research')),
    ).rejects.toThrow(); // phase is now research_execute: research_plan is out of scope anyway
  });
});

describe('approval events change the stage; nothing else does', () => {
  const ws = `${WS}/workspace.md`;
  const wp = `${WS}/workplan v1.md`;
  const log = `${WS}/日志.md`;

  it('a G1 request only asks the reviewer for an opinion: no stage, no flags', async () => {
    await applyApprovalEvent(vault, { type: 'review.request', actor: ROLES.juniorA, workspace: ws, gate: 'G1', subject: wp }, { now: NOW(), logPath: log });
    expect((await vault.read(ws)).note).toMatchObject({ stage: '拆题中', flags: [] });
    expect((await vault.readLog(log)).map((r) => r.action)).toContain('event:review.request');
  });

  it('a G1 request by a non-owner is denied', async () => {
    await expect(applyApprovalEvent(vault, { type: 'review.request', actor: ROLES.juniorB, workspace: ws, gate: 'G1', subject: wp })).rejects.toThrow(/owner/);
  });

  it('a G1 request is accepted at any stage', async () => {
    const n = await vault.read(ws);
    await vault.write(ws, { frontmatter: { ...n.data, stage: '执行中' }, body: n.body }, { overwrite: true });
    await applyApprovalEvent(vault, { type: 'review.request', actor: ROLES.juniorA, workspace: ws, gate: 'G1', subject: wp });
    expect((await vault.read(ws)).note).toMatchObject({ stage: '执行中', flags: [] });
  });

  it('a G1 approval only marks the workplan seen: no stage, no flags', async () => {
    await applyApprovalEvent(vault, { type: 'review.approve', actor: ROLES.senior, workspace: ws, gate: 'G1', subject: wp }, { now: NOW() });
    expect((await vault.read(ws)).note).toMatchObject({ stage: '拆题中', flags: [] });
    expect((await vault.read(wp)).note).toMatchObject({ status: '已确认', approved_by: 'Senior', approved_at: '2026-10-24T08:00:00.000Z' });
  });

  it('the owner cannot approve their own G1 request', async () => {
    await expect(applyApprovalEvent(vault, { type: 'review.approve', actor: ROLES.juniorA, workspace: ws, gate: 'G1', subject: wp })).rejects.toThrow(/reviewer/);
  });

  it('a G1 reject is an opinion: no stage change, no 返工中 flag', async () => {
    await applyApprovalEvent(vault, { type: 'review.request', actor: ROLES.juniorA, workspace: ws, gate: 'G1', subject: wp });
    await applyApprovalEvent(vault, { type: 'review.reject', actor: ROLES.senior, workspace: ws, gate: 'G1', subject: wp });
    expect((await vault.read(ws)).note).toMatchObject({ stage: '拆题中', flags: [] });
  });

  it('结论 still moves the stage: 执行中 → 结论待审 → 撰写中', async () => {
    const n = await vault.read(ws);
    await vault.write(ws, { frontmatter: { ...n.data, stage: '执行中' }, body: n.body }, { overwrite: true });
    const subject = `${WS}/报告 v1.md`;
    await applyApprovalEvent(vault, { type: 'review.request', actor: ROLES.juniorA, workspace: ws, gate: '结论', subject });
    expect((await vault.read(ws)).note).toMatchObject({ stage: '结论待审' });
    await applyApprovalEvent(vault, { type: 'review.approve', actor: ROLES.senior, workspace: ws, gate: '结论', subject });
    expect((await vault.read(ws)).note).toMatchObject({ stage: '撰写中' });
  });

  it('refuses an AI actor', async () => {
    await expect(
      applyApprovalEvent(vault, { type: 'review.request', actor: { id: 'ai', name: 'AI', kind: 'junior' }, workspace: ws, gate: 'G1', subject: wp }),
    ).rejects.toThrow(/human/);
  });

  it('write_draft cannot move the stage', async () => {
    const ctx = await ctxFor('workspace');
    await expect(
      executeTool('write_draft', { note_type: 'workspace', name: 'workspace', frontmatter: { stage: '执行中' }, body: '' }, ctx),
    ).rejects.toBeInstanceOf(ToolNotAllowedError);
    expect((await vault.read(ws)).note).toMatchObject({ stage: '拆题中' });
  });
});
