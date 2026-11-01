/** D-64 T10: the schema changes of docs/CONTRACT-CHANGE-D63.md §1 (written before the code). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFixtureVault } from '../helpers/fixture-vault';
import { assertAiWritable } from '@/lib/harness/guards';
import { loadModelsConfig } from '@/lib/config/models';
import { researchClaimSchema, verdictSchema } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

const common = (id: string, type: string, author = 'AI', status = '推断') => ({
  id,
  type,
  status,
  created: '2026-10-27',
  updated: '2026-10-27',
  author,
  derived_from: ['[[项目]]'],
  relates_to: ['[[项目]]'],
});

const CONTRACT = {
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
};

const ISSUE_TREE = {
  question: '联想应在个人 AI 中占据什么战略位置？',
  lines: [
    {
      id: 'A',
      title: '市场如何演进',
      question: '什么决定竞争成败？',
      owner: 'junior-a',
      items: [{ id: 'M1', title: '哪些用户会持续使用', workspace: 'M1 用户持续使用', waits_for: [] }],
    },
    {
      id: 'B',
      title: '联想如何选择',
      question: '联想凭什么赢？',
      owner: 'junior-b',
      items: [{ id: 'L2', title: '凭什么赢', workspace: null, waits_for: ['M1'] }],
    },
  ],
};

describe('T10 schema', () => {
  it('1. a contract note is written and read back with all the §1.1 fields', async () => {
    const fm = { ...common('contract-p', 'contract'), ...CONTRACT, approved_by: null, approved_at: null };
    assertAiWritable(fm);
    await vault.write('20_项目/P/决策契约.md', { frontmatter: fm, body: '# 决策契约\n' });
    const back = await vault.readTyped('20_项目/P/决策契约.md', 'contract');
    expect(back.note).toMatchObject(CONTRACT);
  });

  it('2. an AI write of a contract with approved_by is refused', () => {
    expect(() => assertAiWritable({ ...common('contract-p', 'contract'), ...CONTRACT, approved_by: 'Senior' })).toThrow(/approved_by/);
  });

  it('3. a project with issue_tree and no roadmap is written; the old shape still reads', async () => {
    const fm = { ...common('proj-q', 'project', 'Senior', '已确认'), owner: 'Senior', sponsor: 'VP', core_question: '问题？', issue_tree: ISSUE_TREE };
    await vault.write('20_项目/Q/项目.md', { frontmatter: fm, body: '# Q\n' });
    const back = await vault.readTyped('20_项目/Q/项目.md', 'project');
    expect(back.note.issue_tree).toEqual(ISSUE_TREE);
    const old = await vault.readTyped('20_项目/P/项目.md', 'project');
    expect(old.note.roadmap).toEqual([{ week: 'W2', topic: '买单', workspaces: [] }]);
  });

  it('4. a workspace with item and no week is written', async () => {
    const fm = { ...common('ws-m1', 'workspace', 'Senior', '已确认'), item: 'M1', owner: 'Junior A', reviewer: 'Senior', stage: '拆题中', flags: [], depends_on: [] };
    await vault.write('20_项目/P/M1/workspace.md', { frontmatter: fm, body: '# M1\n' });
    expect((await vault.readTyped('20_项目/P/M1/workspace.md', 'workspace')).note.item).toBe('M1');
  });

  it('5. 访谈支持 is a verdict', () => {
    expect(verdictSchema.parse('访谈支持')).toBe('访谈支持');
  });

  it('6. a meeting of kind 访谈 is written; an old meeting without kind reads as 会议', async () => {
    const base = { ...common('iv-1', 'meeting', 'Junior A', '已确认'), date: '2026-10-27', attendees: ['分析师甲'], simulated: true, decisions: [] };
    await vault.write('20_项目/P/访谈/重度用户.md', { frontmatter: { ...base, kind: '访谈' }, body: '# 访谈\n' });
    expect((await vault.readTyped('20_项目/P/访谈/重度用户.md', 'meeting')).note.kind).toBe('访谈');
    await vault.write('20_项目/P/会议/方向会.md', { frontmatter: { ...base, id: 'mt-1' }, body: '# 会\n' });
    expect((await vault.readTyped('20_项目/P/会议/方向会.md', 'meeting')).note.kind).toBe('会议');
  });

  it('7. an AI write with published_by is refused', () => {
    expect(() => assertAiWritable({ ...common('rep', 'report'), published_by: 'Senior' })).toThrow(/published_by/);
    expect(() => assertAiWritable({ ...common('rep', 'report'), published_at: '2026-10-27' })).toThrow(/published_at/);
  });

  it('8. a source with fetched_in is written', async () => {
    const fm = {
      ...common('src-web', 'source'),
      url: 'https://example.com/x',
      publisher: '示例',
      published: '2026-05-01',
      retrieved: '2026-10-27',
      origin: '网络',
      grade: 'B',
      graded_by: 'AI',
      authority: 3,
      link_checked: true,
      fetched_in: '20_项目/P/WS-A/调查/跨设备',
    };
    await vault.write('10_资料库/网页乙.md', { frontmatter: fm, body: '# 网页乙\n' });
    expect((await vault.readTyped('10_资料库/网页乙.md', 'source')).note.fetched_in).toBe('20_项目/P/WS-A/调查/跨设备');
  });

  it('9. a research_plan claim keeps key and if_bad', () => {
    const claim = researchClaimSchema.parse({
      id: 'C1',
      statement: '跨设备是持续使用的主因',
      conditions: ['用户在多台设备上用同一助手'],
      sub_questions: [{ id: 'C1-Q1', question: '多设备用户占比？', methods: ['网络'] }],
      counter_search: '找单设备高留存的反例',
      key: 'K3',
      if_bad: '不再把跨设备作为 2027 主打',
    });
    expect(claim.key).toBe('K3');
    expect(claim.if_bad).toBe('不再把跨设备作为 2027 主打');
  });

  it('10. 模型.md may name a review role', async () => {
    const { FIXTURE } = await import('../helpers/fixture-vault');
    const text = FIXTURE['90_配置/模型.md'].replace('web_tools:', 'roles: { review: beta }\nweb_tools:');
    const v = await makeFixtureVault({ '90_配置/模型.md': text });
    try {
      expect((await loadModelsConfig(v.vault)).roles?.review).toBe('beta');
    } finally {
      await v.cleanup();
    }
  });
});
