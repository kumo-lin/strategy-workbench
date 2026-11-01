import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentWeekOf, issueTreeRows, loadProjectOverview, normalizeWeek, originOf, supportedDecision, tableCells } from '@/lib/project/overview';
import { createVault } from '@/lib/vault/vault';

const demo = createVault(path.resolve(__dirname, '../../demo-vault'));
const e2e = createVault(path.resolve(__dirname, '../fixtures/e2e-vault'));

describe('the project page reads 项目.md (step 0), display only', () => {
  it('table cells keep a wiki link alias together', () => {
    expect(tableCells('| 1 形态 | 问 | W1 | [[a/b\\|W1 形态]] | x |')).toEqual(['1 形态', '问', 'W1', '[[a/b|W1 形态]]', 'x']);
    expect(normalizeWeek('W6–W7')).toBe('W6-W7');
  });

  it('the demo project: banner facts, 5 branches, WS-A and WS-B both on branch 2, branches 3 and 5 not built yet', async () => {
    const o = await loadProjectOverview(demo, '个人AI战略');
    expect(o.hasProjectNote).toBe(true);
    expect(o.confirmed).toBe(true);
    expect(o.owner).toBe('Senior');
    expect(o.confirmedAt).toBe('2026-10-25');
    expect(o.derivedFrom).toEqual(['2026-10-16 高层周会（模拟）']);
    expect(o.coreQuestion).toContain('联想明年该怎么下注');
    expect(o.decision).toContain('押哪一层');
    expect(o.branches.map((b) => b.no)).toEqual([1, 2, 3, 4, 5]);
    expect(o.branches[1].workspaces.map((w) => [w.name, w.owner])).toEqual([['WS-A 买方', 'Junior A'], ['WS-B 用户', 'Junior B']]);
    expect(o.branches[0].workspaces.map((w) => w.name)).toEqual(['W1 形态']);
    expect(o.branches[3].workspaces.map((w) => w.name)).toEqual(['W5 联想的位置']);
    expect(o.branches[2].workspaces).toEqual([]);
    expect(o.branches[4].workspaces).toEqual([]);
    expect(o.unplaced).toEqual([]);
    expect(o.dependencies.map((d) => `${d.from}→${d.to}`)).toContain('WS-B 用户→WS-A 买方');
    expect(o.roadmap.map((r) => r.week)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5', 'W6-W7', 'W8']);
  });

  it('now = the week of the Workspaces furthest behind in the flow (WS-A is still 拆题中: W2)', async () => {
    const o = await loadProjectOverview(demo, '个人AI战略');
    expect(o.currentWeek).toBe('W2');
    expect(currentWeekOf('W3', [], [])).toBe('W3'); // 项目.md can say so itself
  });

  it('a Workspace knows its branch, week and who assigned it, and who works next to it', async () => {
    const o = await loadProjectOverview(demo, '个人AI战略');
    const origin = originOf(o, '20_项目/个人AI战略/WS-A 买方');
    expect(origin).toMatchObject({ branchNo: 2, topic: '企业愿不愿意买单', week: 'W2', assignedBy: 'Senior' });
    expect(origin.siblings.map((w) => w.name)).toEqual(['WS-B 用户']);
  });

  it('a project note without the issue-tree table (the e2e vault): its Workspaces are listed, none is lost', async () => {
    const o = await loadProjectOverview(e2e, '个人AI战略');
    expect(o.branches).toEqual([]);
    expect(o.unplaced.map((w) => w.name).sort()).toEqual(['WS-A 买方', 'WS-B 用户']);
    expect(originOf(o, '20_项目/个人AI战略/WS-A 买方').branchNo).toBeNull();
    expect(originOf(o, '20_项目/个人AI战略/WS-A 买方').assignedBy).toBeNull(); // no assigned_by in the note: "由 … 指派" is not shown, not guessed
  });

  it('parsing helpers', () => {
    expect(issueTreeRows('## 议题树（第一层）\n\n| 枝 | 要回答 | 周 | Workspace | 假设 |\n|---|---|---|---|---|\n| 1 a | b | W1 | 待建 | h |\n\n## 下一节\n| x | y | z | w |')).toEqual([['1 a', 'b', 'W1', '待建', 'h']]);
    expect(supportedDecision('**问题**：q\n**支撑的决策**：押哪一层 [[x|y]]\n')).toBe('押哪一层 y');
  });
});
