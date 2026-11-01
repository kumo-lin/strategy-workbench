/** D-64 T54: the M1 script of the mock model — M1 content in the m1-qira vault, the old answers elsewhere. */
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVault, type Vault } from '@/lib/vault';
import { taskLine } from '@/lib/testing/mock-contract';
import { makeFixtureVault } from '../helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));

const { answerResearchStep } = await import('@/lib/testing/mock-research');
const { nextStep } = await import('@/lib/testing/mock-agent');
const { createMockWebClient } = await import('@/lib/testing/mock-web');

const m1 = createVault(path.resolve('demo-vault/.snapshots/m1-qira'));
let plain: { vault: Vault; cleanup: () => Promise<void> };
beforeAll(async () => {
  plain = await makeFixtureVault();
});
afterAll(async () => plain.cleanup());

type Tree = { subquestions: { question: string; children: { question: string; knockout?: boolean; key?: string; ifBad?: string }[] }[] };
const decisionPrompt = (ws: string) => [taskLine('decision_draft'), `## 本 Workspace：${ws}`, '- [[资料甲#^c1]]（A 级）', '- [[资料乙#^c2]]（B 级）', '- [[20_项目/个人AI战略/L2 凭什么赢/workspace|L2 凭什么赢]]（Workspace）'].join('\n');
const summaryPrompt = [taskLine('summary'), '- H1 跨设备有持续增量 → 证据不足 [E3]'].join('\n');

describe('T54 in the m1-qira vault', () => {
  beforeEach(() => {
    mocked.vault = m1;
  });

  it('workplan_tree: 4 branches (需求, 采用, 留存, 深化), 12 sub-questions, K1–K4 marked with what changes if bad', () => {
    const tree = answerResearchStep(`${taskLine('workplan_tree')}\n要回答的问题：哪些用户会持续使用？`) as Tree;
    expect(tree.subquestions.map((b) => b.question.slice(0, 4))).toEqual(['M1.1', 'M1.2', 'M1.3', 'M1.4']);
    const leaves = tree.subquestions.flatMap((b) => b.children);
    expect(leaves).toHaveLength(12);
    expect(leaves.every((l) => l.question.endsWith('？'))).toBe(true);
    const ko = leaves.filter((l) => l.knockout);
    expect(ko.map((l) => l.key)).toEqual(['K1', 'K2', 'K3', 'K4']);
    expect(ko.every((l) => l.ifBad)).toBe(true);
    expect(leaves[0].question).toBe('哪些用户群的未满足需求最强？');
  });

  it('workplan_judgment names K1 to K4', () => {
    expect(answerResearchStep(`${taskLine('workplan_judgment')}\n## 决策契约`)).toContain('K1 到 K4');
  });

  it('the investigation plan (agent, write_draft): K3 with H1, H2, H3', async () => {
    const step = await nextStep({ system: 'Workspace：20_项目/个人AI战略/M1 用户持续使用。', lastUser: '拟调查计划', calls: ['ask_user', 'ask_user', 'ask_user'], results: [], tools: ['ask_user', 'write_draft'] });
    const input = (step as { call: { toolName: string; input: { frontmatter: { claims: { key: string; statement: string }[] } } } }).call;
    expect(input.toolName).toBe('write_draft');
    expect(input.input.frontmatter.claims.filter((c) => c.key === 'K3').map((c) => [c.key, c.statement.slice(0, 2)])).toEqual([['K3', 'H1'], ['K3', 'H2'], ['K3', 'H3']]);
  });

  it('summary: So what, three reasons, gaps K2 and K3', () => {
    const s = answerResearchStep(summaryPrompt) as { so_what: string; reasons: { title: string }[]; gaps: { question: string }[] };
    // T55: one sentence of at most 50 characters (the product's rule); v6's longer sample is reason ① plus this
    expect(s.so_what).toContain('联想应先找出会持续使用的任务，再决定跨设备投入，不把它当成所有用户的卖点');
    expect(s.reasons.map((r) => r.title)).toEqual(['用的人多，天天用的人少', 'Qira 布局到位，价值未证明', '用户要帮忙，不要失控']);
    expect(s.gaps.map((g) => g.question.slice(0, 2))).toEqual(['K2', 'K3']);
  });

  it('decision_draft: the three fields of the document', () => {
    expect(answerResearchStep(decisionPrompt('M1 用户持续使用'))).toMatchObject({
      decision: expect.stringContaining('跨设备功能先按用户和场景区分对待'),
      reason: expect.stringContaining('公开证据只证明 AI 采用广泛'),
      scope: '在拿到跨设备留存数据前有效；数据出来后由项目负责人复审。',
      affects: ['[[20_项目/个人AI战略/L2 凭什么赢/workspace|L2 凭什么赢]]'],
    });
  });

  it('web: each query of the claim table finds its own page — S10 and S12 fetched with their text, Pew already in the vault, anything else nothing', async () => {
    const web = createMockWebClient();
    const urls = async (query: string) => (await web.search({ query })).results.map((r) => r.url);
    expect(await urls('AI users switching primary AI tool')).toEqual(['https://www.reconanalytics.com/ai-tool-switching/']);
    const gartner = await urls('consumers let AI make purchase decisions survey');
    expect(gartner).toEqual(['https://www.gartner.com/en/newsroom/press-releases/2026-05-27-gartner-survey-finds-consumers-want-ai-shopping-help-but-not-ai-purchase-decisions']);
    expect((await web.fetch({ url: gartner[0] })).content).toContain('topped out at 11%');
    expect(await urls('cross-device continuity retention study')).toEqual(['https://www.pewresearch.org/internet/2026/06/17/how-opinions-and-use-of-ai-differ-by-age/']);
    expect(await urls('跨设备 留存')).toEqual([]);
  });
});

describe('T54 elsewhere: the old answers (regression)', () => {
  beforeEach(() => {
    mocked.vault = plain.vault;
  });

  it('summary, decision, tree and web are the old script', async () => {
    expect((answerResearchStep(summaryPrompt) as { so_what: string }).so_what).toBe('买方的关键是 IT 可管理性 [E3]');
    expect(answerResearchStep(decisionPrompt('WS-A 买方'))).toMatchObject({ name: 'WS-A 买方决定-先打IT管理场景' });
    expect((answerResearchStep(`${taskLine('workplan_tree')}\n要回答的问题：企业买单吗？`) as Tree).subquestions).toHaveLength(3);
    const { results } = await createMockWebClient().search({ query: 'cross-device continuity retention study' });
    expect(results.every((r) => r.url.includes('.mock-web.test'))).toBe(true);
  });
});
