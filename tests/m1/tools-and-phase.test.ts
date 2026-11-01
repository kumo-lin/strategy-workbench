/** Phase gating, submit_for_review (prepare only), and logging of every call (M1 task 1.8 ① ③). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, toolNamesForPhase, ToolNotAllowedError } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { requestReview } from '@/lib/workplan/review-flow';
import { ctxFor, LOG, makeM1Vault, ROLES, stageOf, WS } from './helpers';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM1Vault());
});
afterEach(async () => cleanup());

const W1 = `${WS}/workplan v1.md`;

describe('workplan phase tool set', () => {
  it('has submit_for_review and write_draft, and none of the research or proposal tools', () => {
    const names = toolNamesForPhase('workplan');
    expect(names).toEqual(expect.arrayContaining(['ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft', 'submit_for_review']));
    for (const n of ['web_search', 'web_fetch', 'ingest_source', 'check_citations', 'propose_decision', 'propose_knowledge']) {
      expect(names).not.toContain(n);
    }
  });

  it.each(['web_search', 'web_fetch', 'ingest_source', 'propose_decision'] as const)('%s is refused in the workplan phase and the refusal is logged', async (name) => {
    const ctx = await ctxFor(vault);
    expect(ctx.phase).toBe('workplan');
    await expect(executeTool(name, { why: '试一下' }, ctx)).rejects.toBeInstanceOf(ToolNotAllowedError);
    const log = await vault.readLog(LOG);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: 'AI', action: `tool:${name}` });
    expect(log[0].change.startsWith('✗')).toBe(true);
  });
});

describe('submit_for_review only prepares', () => {
  const args = { gate: 'G1', subject: 'workplan v1', summary: '拆题逻辑', focus: ['H1 可证伪吗'], why: '准备送审' };

  it('returns the material, changes no state, and is logged', async () => {
    const ctx = await ctxFor(vault);
    const out = (await executeTool('submit_for_review', args, ctx)) as { prepared: boolean; subject: string; hypotheses: string[] };
    expect(out).toMatchObject({ prepared: true, subject: W1 });
    expect(out.hypotheses).toEqual(['20_项目/P/假设/WS-A-H1 IT 可管理性.md']);
    // nothing was sent: no stage change, no review note
    expect(await stageOf(vault)).toBe('拆题中');
    expect(await vault.exists(`${WS}/review`)).toBe(false);
    const log = await vault.readLog(LOG);
    expect(log.map((r) => r.action)).toEqual(['tool:submit_for_review']);
    expect(log[0].change).toContain('未发送');
  });

  it('refuses a workplan that links no hypothesis note', async () => {
    const { vault: v2, cleanup: c2 } = await makeM1Vault({
      [W1]: `---\nid: ws-a-wp-v1\ntype: workplan\nstatus: 进行中\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: AI\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\nversion: 1\napproved_by: null\napproved_at: null\nchanges: []\n---\n# 空的 workplan\n`,
    });
    try {
      await expect(executeTool('submit_for_review', args, await ctxFor(v2))).rejects.toThrow(/假设/);
      expect((await v2.readLog(LOG))[0].change.startsWith('✗')).toBe(true);
    } finally {
      await c2();
    }
  });

  it('refuses the wrong gate and a stale subject; any stage may submit', async () => {
    const ctx = await ctxFor(vault);
    await expect(executeTool('submit_for_review', { ...args, gate: '结论' }, ctx)).rejects.toThrow(/G1/);
    await expect(executeTool('submit_for_review', { ...args, subject: 'workplan v3' }, ctx)).rejects.toThrow(/最新版本/);
    const out = (await executeTool('submit_for_review', args, { ...ctx, workspace: { ...ctx.workspace, stage: '执行中' } })) as { prepared: boolean };
    expect(out.prepared).toBe(true);
  });

  it('refuses while an earlier request is still waiting for the reviewer', async () => {
    await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: W1, summary: '拆题逻辑', focus: ['H1 可证伪吗'] });
    await expect(executeTool('submit_for_review', args, await ctxFor(vault))).rejects.toThrow(/还在等/);
  });
});
