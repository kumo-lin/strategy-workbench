/** M3 3.2a/3.2b: propose_decision is available while researching, always drafts 推断, and every reason carries the report's block citations. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, PHASE_TOOLS, ToolNotAllowedError, toolNamesForPhase } from '@/lib/harness';
import { checkDecisionBody, insufficientOnlyBlocks, reasonItems } from '@/lib/decisions/check';
import type { ToolContext } from '@/lib/harness/types';
import type { Vault } from '@/lib/vault';
import { planNote } from '../m2/research-fixture';
import { ctxFor, DECISIONS, GOOD_DRAFT, makeM3Vault, REPORT, reportWithInsufficient, ROLES, WS_A } from './fixture';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM3Vault());
});
afterEach(async () => cleanup());

const draftPath = `${DECISIONS}/${GOOD_DRAFT.name}.md`;
const propose = (ctx: ToolContext, args: Record<string, unknown> = {}) => executeTool('propose_decision', { ...GOOD_DRAFT, report: REPORT, why: '起草', ...args }, ctx);

describe('3.2a: phase table', () => {
  it('research_execute has propose_decision; workplan and research_plan do not', () => {
    expect(PHASE_TOOLS.research_execute).toContain('propose_decision');
    expect(PHASE_TOOLS.workplan).not.toContain('propose_decision');
    expect(PHASE_TOOLS.research_plan).not.toContain('propose_decision');
    expect(toolNamesForPhase('research_execute')).toContain('propose_decision');
    expect(toolNamesForPhase('research_plan')).not.toContain('propose_decision');
  });

  it('is refused (and logged) before the plan is approved', async () => {
    const { vault: v2, cleanup: c2 } = await makeM3Vault({ [`${WS_A}/调查/R1/计划 v1.md`]: planNote({ approved: false }) });
    try {
      const ctx = await ctxFor(v2, ROLES.senior);
      expect(ctx.phase).toBe('research_plan');
      await expect(propose(ctx)).rejects.toBeInstanceOf(ToolNotAllowedError);
      expect((await v2.readLog(ctx.logPath)).at(-1)?.change).toMatch(/^✗/);
    } finally {
      await c2();
    }
  });
});

describe('3.2b: propose_decision', () => {
  it('writes a 推断 draft by AI with empty decided_by, linked to the report, workspace, project and hypothesis', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    expect(ctx.phase).toBe('research_execute');
    const r = (await propose(ctx)) as { path: string; reasons: number };
    expect(r.path).toBe(draftPath);
    const n = await vault.read(draftPath);
    expect(n.issues).toEqual([]);
    expect(n.data).toMatchObject({ type: 'decision', status: '推断', author: 'AI', decided_by: null });
    expect(n.data.derived_from).toEqual(['[[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]']);
    expect(n.data.trigger).toBe('[[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]');
    expect(n.data.relates_to).toEqual(
      expect.arrayContaining(['[[20_项目/P/WS-A/workspace|WS-A]]', '[[20_项目/P/项目|项目]]', '[[20_项目/P/假设/WS-A-H1 IT 可管理|WS-A-H1 IT 可管理]]']),
    );
    expect(n.data.affects).toEqual(['[[20_项目/P/WS-B/workspace|WS-B]]']);
    const log = await vault.readLog(ctx.logPath);
    expect(log.at(-1)).toMatchObject({ actor: 'AI', action: 'tool:propose_decision' });
  });

  it('every reason has a block citation with the quote copied from the source, and the whole note passes checkCitations', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    await propose(ctx);
    const body = (await vault.read(draftPath)).body;
    const reasons = reasonItems(body);
    expect(reasons).toHaveLength(2);
    for (const r of reasons) expect(r).toMatch(/“[^”]+”（B 级，[^）]+）\[\[资料甲#\^c\d\]\]/);
    expect(reasons[0]).toContain('“IT 可管理性是企业采购 AI PC 的首要考量。”');
    const checks = await vault.checkCitations(body, { fromPath: draftPath });
    expect(checks.length).toBeGreaterThanOrEqual(3);
    expect(checks.every((c) => c.ok && c.quote)).toBe(true);
    expect((await checkDecisionBody(vault, { decisionPath: draftPath, reportPath: REPORT, body })).ok).toBe(true);
  });

  it('refuses a block the report does not cite (a decision cannot say more than its report)', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    const bad = { ...GOOD_DRAFT, reasons: [{ kind: '事实', text: '段落论断', cites: ['[[资料甲#^c3]]'] }] };
    await expect(propose(ctx, bad)).rejects.toThrow(/报告里没有引用过/);
    expect(await vault.exists(draftPath)).toBe(false);
    const row = (await vault.readLog(ctx.logPath)).at(-1)!;
    expect(row.change.startsWith('✗')).toBe(true);
  });

  it('refuses a block that does not exist, a reason without citations and an unresolvable affects link', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    await expect(propose(ctx, { reasons: [{ kind: '事实', text: 'x', cites: ['[[资料甲#^c99]]'] }] })).rejects.toThrow(/对不上/);
    await expect(propose(ctx, { reasons: [{ kind: '事实', text: 'x', cites: [] }] })).rejects.toThrow(/invalid arguments/);
    await expect(propose(ctx, { affects: ['[[不存在的笔记]]'] })).rejects.toThrow(/找不到/);
    expect(await vault.exists(draftPath)).toBe(false);
  });

  it('block links in counter / gaps must be blocks the report cites too; reason text may not carry links', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    await expect(propose(ctx, { counter: ['另一说法 [[资料甲#^c3]]'] })).rejects.toThrow(/「反证」里的引用.*不是报告引用过的块/);
    await expect(propose(ctx, { reasons: [{ kind: '事实', text: '见 [[资料甲#^c1]]', cites: ['[[资料甲#^c1]]'] }] })).rejects.toThrow(/放进 cites/);
    await expect(propose(ctx, { counter: ['报告的反证 [[资料甲#^c2]] 分量低'] })).resolves.toBeTruthy();
  });

  it('a claim the report judged 证据不足 cannot be the only ground of a reason (console ⑤)', async () => {
    const { vault: v2, cleanup: c2 } = await makeM3Vault({ [REPORT]: reportWithInsufficient() });
    try {
      const weak = await insufficientOnlyBlocks(v2, (await v2.read(REPORT)).body, REPORT);
      expect([...weak]).toEqual(['10_资料库/资料甲.md#c3']);
      const ctx = await ctxFor(v2, ROLES.senior);
      const only = { reasons: [{ kind: '推断', text: '预算归 IT', cites: ['[[资料甲#^c3]]'] }] };
      await expect(propose(ctx, only)).rejects.toThrow(/证据不足.*只能写进"还缺什么"/);
      // as a gap it is fine, and next to firm evidence it is fine too
      await expect(propose(ctx, { gaps: ['预算口径未知 [[资料甲#^c3]]'] })).resolves.toBeTruthy();
      await expect(propose(ctx, { reasons: [{ kind: '推断', text: 'IT 管采购也管预算', cites: ['[[资料甲#^c1]]', '[[资料甲#^c3]]'] }] })).resolves.toBeTruthy();
    } finally {
      await c2();
    }
  });

  it('"affects" may only point at a project, Workspace or hypothesis', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    await expect(propose(ctx, { affects: ['[[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]'] })).rejects.toThrow(/只能指向 Workspace、假设或项目/);
  });

  it('only a Senior can request it, and only for a delivered report in this workspace', async () => {
    await expect(propose(await ctxFor(vault, ROLES.juniorA))).rejects.toThrow(/只有 Senior/);
    const ctx = await ctxFor(vault, ROLES.senior);
    await expect(propose(ctx, { report: '20_项目/P/WS-B/调查/R1/报告 v1.md' })).rejects.toThrow(/本 Workspace/);
    await vault.write(REPORT, { frontmatter: { ...(await vault.read(REPORT)).data, delivery: '草稿' }, body: (await vault.read(REPORT)).body }, { overwrite: true });
    await expect(propose(ctx)).rejects.toThrow(/还没有交付/);
  });

  it('re-drafting replaces a 推断 draft but never overwrites a confirmed decision', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    await propose(ctx);
    expect(((await propose(ctx)) as { replaced: boolean }).replaced).toBe(true);
    const n = await vault.read(draftPath);
    await vault.write(draftPath, { frontmatter: { ...n.data, status: '已确认', decided_by: 'Senior' }, body: n.body }, { overwrite: true });
    await expect(propose(ctx)).rejects.toThrow(/不能覆盖/);
  });

  it('checkDecisionBody catches an edit that drops a citation, breaks a quote or adds a block the report never cited', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    await propose(ctx);
    const body = (await vault.read(draftPath)).body;
    const uncited = (await checkDecisionBody(vault, { decisionPath: draftPath, reportPath: REPORT, body: body.replace(/^- \*\*推断\*\*：.*$/m, '- **推断**：没有引用的一条') })).problems;
    expect(uncited.join('；')).toMatch(/没有报告里的块引用/);
    const mismatch = (await checkDecisionBody(vault, { decisionPath: draftPath, reportPath: REPORT, body: body.replace('“IT 可管理性是企业采购 AI PC 的首要考量。”', '“编造的原文”') })).problems;
    expect(mismatch.join('；')).toMatch(/对不上/);
    const extra = (await checkDecisionBody(vault, { decisionPath: draftPath, reportPath: REPORT, body: body.replace(/\[\[资料甲#\^c2\]\]/, '[[资料甲#^c3]]') })).problems;
    expect(extra.join('；')).toMatch(/报告里没有引用过|对不上/);
  });
});
