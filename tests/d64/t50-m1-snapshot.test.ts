/** D-64 T50: the m1-qira snapshot — the M1 topic's project, contract, workspaces, roles, models and three other projects. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModelsConfig } from '@/lib/config/models';
import { createVault } from '@/lib/vault';

const vault = createVault(path.resolve('demo-vault/.snapshots/m1-qira'));
const P = '20_项目/个人AI战略';

describe('T50 m1-qira snapshot', () => {
  it('1. 项目.md has the issue tree: A (M1–M4), B (L1–L4); M1 owned by junior-a, L2 by junior-b and waiting for M1', async () => {
    const { note } = await vault.readTyped(`${P}/项目.md`, 'project');
    const tree = note.issue_tree!;
    expect(tree.lines.map((l) => [l.id, l.title, l.owner, l.items.map((i) => i.id)])).toEqual([
      ['A', '市场如何演进', 'junior-a', ['M1', 'M2', 'M3', 'M4']],
      ['B', '联想如何选择', 'junior-b', ['L1', 'L2', 'L3', 'L4']],
    ]);
    const l2 = tree.lines[1].items.find((i) => i.id === 'L2')!;
    expect(l2.waits_for).toEqual(['M1']);
    expect(tree.lines[0].items[0].workspace).toBe('M1 用户持续使用');
  });

  it('2. 决策契约.md is a contract, status 推断, with the fields of D63 §1.1', async () => {
    const { note } = await vault.readTyped(`${P}/决策契约.md`, 'contract');
    expect(note).toMatchObject({
      status: '推断',
      question: '联想应在个人 AI 中占据什么战略位置？2027 年应优先投入哪些方向？',
      original_question: '个人 AI 市场将如何演进，对联想意味着什么？',
      decision: '战略定位、优先机会、资源配置',
      decision_owner: '智能设备业务群 · 个人 AI 战略与产品管理层',
      horizon: '2027 行动；展望 2028–2030',
      geography: '全球；中国单独分析',
      product_scope: 'PC、手机、平板、可穿戴及连接它们的个人 AI 服务',
      out_of_scope: ['企业级 AI 基础设施', '基础模型研发'],
      success: '能决定 2027 年的投入方向',
      known: ['联想 2026 年 1 月已发布 Qira'],
      bar: '关键判断至少 2 个独立来源',
      approved_by: null,
    });
  });

  it('3. the M1 and L2 workspaces exist, 拆题中, item M1 / L2', async () => {
    for (const [folder, item] of [['M1 用户持续使用', 'M1'], ['L2 凭什么赢', 'L2']]) {
      const { note } = await vault.readTyped(`${P}/${folder}/workspace.md`, 'workspace');
      expect(note).toMatchObject({ stage: '拆题中', item });
    }
  });

  it('4. 角色.md: Senior, 分析师甲, 分析师乙 with the ids senior, junior-a, junior-b', async () => {
    const roles = (await vault.read('90_配置/角色.md')).data.roles as { id: string; name: string }[];
    expect(roles.map((r) => [r.id, r.name])).toEqual([['senior', 'Senior'], ['junior-a', '分析师甲'], ['junior-b', '分析师乙']]);
  });

  it('5. 模型.md: judgment, execution and review roles; kimi-k3.1-pro-highspeed among the providers', async () => {
    const c = await loadModelsConfig(vault);
    expect(Object.keys(c.roles ?? {}).sort()).toEqual(['execution', 'judgment', 'review']);
    expect(Object.values(c.providers).map((p) => p.model)).toContain('kimi-k3.1-pro-highspeed');
    expect(c.providers[c.roles!.judgment!].model).toBe('kimi-k3.1-pro-highspeed');
  });

  it('6. three more projects: 商用 PC 换机策略 (done, a confirmed unpublished decision), AI 服务器本地部署, 东南亚中小企业渠道; all simulated', async () => {
    const names = (await vault.list('20_项目')).filter((e) => e.kind === 'dir').map((e) => e.name).sort();
    expect(names).toEqual(['AI 服务器本地部署', '东南亚中小企业渠道', '个人AI战略', '商用 PC 换机策略'].sort());
    for (const p of ['商用 PC 换机策略', 'AI 服务器本地部署', '东南亚中小企业渠道']) expect((await vault.read(`20_项目/${p}/项目.md`)).data.simulated).toBe(true);
    const decisions = (await vault.list('20_项目/商用 PC 换机策略/决策')).filter((e) => e.kind === 'file');
    expect(decisions).toHaveLength(1);
    const d = await vault.read(decisions[0].path);
    expect(d.data).toMatchObject({ status: '已确认', simulated: true });
    expect(d.data.published_by ?? null).toBeNull();
  });

  it('7. none of the S3-D48 project files', async () => {
    const all = (await vault.list(P, { recursive: true })).map((e) => e.path);
    expect(all.some((p) => /WS-A 买方|WS-B 用户|W5 联想的位置/.test(p))).toBe(false);
  });
});
