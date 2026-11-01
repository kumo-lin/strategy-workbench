/**
 * The web tools (search / fetch / ingest) depend ONLY on the owner's approval of
 * the research plan — never on G1 or the Workspace `stage` (D-56 5a: G1 asks for
 * an opinion and blocks nothing).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildToolContext, isPlanApproved, toolNamesForPhase } from '@/lib/harness';
import { WORKSPACE_STAGES, type WorkspaceStage } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { parseMarkdown } from '@/lib/vault/frontmatter';
import { decideReview, requestReview } from '@/lib/workplan/review-flow';
import { makeM1Vault, ROLES, WS, WS_NOTE } from './helpers';

const RDIR = `${WS}/调查/R1`;
const PLAN = `${RDIR}/计划 v1.md`;
const WORKPLAN = `${WS}/workplan v1.md`;
const WEB_TOOLS = ['web_search', 'web_fetch', 'ingest_source'] as const;

const planNote = (approved: boolean) => `---
id: plan-r1-v1
type: research_plan
status: ${approved ? '已确认' : '探索性'}
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[${WS}/workplan v1|workplan v1]]"]
relates_to: ["[[${WS}/workspace|WS-A]]"]
version: 1
question: "企业为什么为员工的 AI PC 买单？"
purpose: "决定 WS-A 先验证哪个买方场景"
claims:
  - id: C1
    statement: "IT 可管理性决定企业是否采购 AI PC"
    hypothesis: null
    conditions: ["采购由 IT 牵头"]
    sub_questions:
      - { id: C1-Q1, question: "企业采购时 IT 部门的角色？", methods: [知识库, 网络] }
    counter_search: "找 IT 不是决策方的证据"
approved_by_owner: ${approved ? '"Junior A"' : 'null'}
approved_at: ${approved ? '"2026-10-24T09:00:00Z"' : 'null'}
exploratory: true
---
# R1 调查计划 v1
`;

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM1Vault({ [PLAN]: planNote(false) }));
});
afterEach(async () => cleanup());

async function setStage(stage: WorkspaceStage): Promise<void> {
  const ws = await vault.read(WS_NOTE);
  await vault.write(WS_NOTE, { frontmatter: { ...ws.data, stage }, body: ws.body }, { overwrite: true });
}

async function setPlanApproved(approved: boolean): Promise<void> {
  const { data, body } = parseMarkdown(planNote(approved));
  await vault.write(PLAN, { frontmatter: data, body }, { overwrite: true });
}

async function researchCtx() {
  return buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR, now: () => new Date('2026-10-24T10:00:00Z') });
}

describe('the web tools only follow the research plan approval', () => {
  it.each(WORKSPACE_STAGES)('stage %s: an unapproved plan keeps them locked', async (stage) => {
    await setStage(stage);
    const ctx = await researchCtx();
    expect(ctx.phase).toBe('research_plan');
    const names = toolNamesForPhase(ctx.phase);
    for (const name of WEB_TOOLS) expect(names).not.toContain(name);
  });

  it.each(WORKSPACE_STAGES)('stage %s: an owner-approved plan unlocks them', async (stage) => {
    await setStage(stage);
    await setPlanApproved(true);
    const ctx = await researchCtx();
    expect(ctx.phase).toBe('research_execute');
    const names = toolNamesForPhase(ctx.phase);
    for (const name of WEB_TOOLS) expect(names).toContain(name);
  });
});

describe('G1 does not unlock the web tools', () => {
  it('a pending G1 request changes nothing', async () => {
    await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: WORKPLAN, summary: '拆题逻辑', focus: [] });
    const ctx = await researchCtx();
    expect(ctx.phase).toBe('research_plan');
    for (const name of WEB_TOOLS) expect(toolNamesForPhase(ctx.phase)).not.toContain(name);
  });

  it('an answered G1 request changes nothing either', async () => {
    const { reviewPath } = await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: WORKPLAN, summary: '拆题逻辑', focus: [] });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve' });
    const ctx = await researchCtx();
    expect(ctx.phase).toBe('research_plan');
    for (const name of WEB_TOOLS) expect(toolNamesForPhase(ctx.phase)).not.toContain(name);
  });
});

describe('the workspace track', () => {
  it.each(WORKSPACE_STAGES)('stage %s: never has the web tools', async (stage) => {
    await setStage(stage);
    const ctx = await buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS, track: 'workspace' });
    for (const name of WEB_TOOLS) expect(toolNamesForPhase(ctx.phase)).not.toContain(name);
  });
});

describe('isPlanApproved', () => {
  const approved = { status: '已确认' as const, approved_by_owner: 'Junior A', approved_at: '2026-10-24T09:00:00Z' };

  it('needs the owner and the time, not just 已确认', () => {
    expect(isPlanApproved({ ...approved, approved_by_owner: null })).toBe(false);
    expect(isPlanApproved({ ...approved, approved_at: null })).toBe(false);
    expect(isPlanApproved({ ...approved, status: '进行中' })).toBe(false);
    expect(isPlanApproved(approved)).toBe(true);
  });
});
