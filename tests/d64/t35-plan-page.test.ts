/** D-64 T35 (ui-2): the research plan page — the plan as a document, K1–K4, the changes traced to an opinion, 请 Senior 提意见. */
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { SendForOpinion } from '@/components/workspace/send-for-opinion';
import { WorkplanPanel } from '@/components/workspace/workplan-panel';
import { markPlanFinal } from '@/lib/workplan/plan-final';
import { planDocOf } from '@/lib/workplan/plan-doc';
import { treeSchema } from '@/lib/workplan/compose/types';
import type { WorkplanVersionView } from '@/lib/workplan/view';
import { ApprovalDenied } from '@/lib/harness/events';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

const hyp = (s: string) => ({ statement: s, falsifier: '看到相反的数据', conditions: ['条件'], known_by: [], to_verify: [], short: s.slice(0, 6) });
const tree = treeSchema.parse({
  core_question: '联想应在个人 AI 中占据什么战略位置？',
  decision_options: '战略定位、优先机会、资源配置',
  day1_answer: '先押跨设备的连续体验（假设）',
  split_basis: '按用户、体验、竞争拆',
  subquestions: [
    { question: '哪些用户会持续使用？', children: [{ question: '有没有高频任务？', hypothesis: hyp('有高频任务'), knockout: true, ifBad: '不按日常高频助手投入' }, { question: '谁会付费？', hypothesis: hyp('重度用户付费') }] },
    { question: '跨设备是否解决真实问题？', hypothesis: hyp('解决重复出现的问题'), knockout: true, ifBad: '跨设备不作为主打卖点' },
  ],
  key_message: 'k',
  risks: ['最可能被推翻的一点'],
  next_actions: ['n'],
});

const version = (n: number, over: Partial<WorkplanVersionView> = {}): WorkplanVersionView => ({
  version: n,
  path: `20_项目/P/WS-A/workplan v${n}.md`,
  status: '进行中',
  author: 'AI',
  created: '2026-10-27',
  approvedBy: null,
  approvedAt: null,
  body: `# workplan v${n}\n\n## 问题树与假设\n\n正文 ${n}\n`,
  changes: [],
  changedLines: [],
  beforeQuestionTree: false,
  ...over,
});

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

describe('T35 the plan as a document', () => {
  it('planDocOf: the question, the decision, the first answer, branches with their sub-questions and hypotheses, K1 and K2', () => {
    const d = planDocOf(tree);
    expect(d.keyLine).toBe('关键问题：K1 有没有高频任务？ · K2 跨设备是否解决真实问题？');
    expect(d.branches.map((b) => [b.label, b.children.length])).toEqual([
      ['Q1', 2],
      ['Q2', 1],
    ]);
    expect(d.branches[0].children[0]).toMatchObject({ label: 'Q1-1', hypothesis: '有高频任务', key: 'K1', ifBad: '不按日常高频助手投入' });
  });

  it('the panel: every text and testid of ui-2', () => {
    const v2 = version(2, {
      tree: planDocOf(tree),
      changedLines: [2],
      changes: [{ comment: '[[review/G1 2026-10-25#^m1]]', commentId: 'm1', commentText: '先看高频任务', commentAuthor: 'Senior', reviewName: 'G1 2026-10-25', intent: '先验证习惯', change: '加了 K1', traced: true }],
    });
    const out = html(createElement(WorkplanPanel, { versions: [version(1), v2] }));
    for (const t of ['研究计划 v2', 'v1 → v2 已标出修改', '要回答的问题', '要支撑的决策', '初步判断', '分支', '子问题', '初始假设（待验证）', 'Knock-out（P0）：结果不理想就会改变 2027 年产品战略', '对应意见 Senior · 2026-10-25'])
      expect(out, t).toContain(t);
    for (const id of ['plan-doc', 'plan-diff-badge', 'knockout-line', 'change-card']) expect(out, id).toContain(`data-testid="${id}"`);
    expect(out.match(/data-testid="knockout-line"/g)).toHaveLength(2);
  });

  it('a version without the tree (older) shows its text as before', () => {
    const out = html(createElement(WorkplanPanel, { versions: [version(1)] }));
    expect(out).not.toContain('data-testid="plan-doc"');
    expect(out).toContain('正文 1');
  });
});

describe('T35 the page', () => {
  it('请 Senior 提意见 (ask-senior)', () => {
    const out = html(createElement(SendForOpinion, { workspacePath: '20_项目/P/WS-A', subject: '20_项目/P/WS-A/workplan v1.md', version: 1, body: 'x', reviewer: 'Senior' }));
    expect(out).toContain('data-testid="ask-senior"');
    expect(out).toContain('请 Senior 提意见');
  });

  it('the chat says 研究计划, the plan can be said final, no 日志 tab, no stage bar', () => {
    const src = readFileSync('components/workspace/workspace-shell.tsx', 'utf8');
    expect(src).toContain('和 AI 讨论 · 研究计划');
    expect(src).toContain('<PlanFinalButton');
    expect(readFileSync('components/workspace/plan-final-button.tsx', 'utf8')).toContain('研究计划定了，往下做调查计划 →');
    expect(src).not.toContain('tab-log');
    expect(src).not.toContain('StageBar');
    expect(existsSync('components/workspace/stage-bar.tsx')).toBe(false);
  });

  it('研究计划定了: only the owner; the Workspace moves on to the investigation plan (stage 执行中)', async () => {
    const fx = await makeFixtureVault();
    cleanup = fx.cleanup;
    await expect(markPlanFinal(fx.vault, ROLES.juniorB as Role, '20_项目/P/WS-A')).rejects.toBeInstanceOf(ApprovalDenied);
    await markPlanFinal(fx.vault, ROLES.juniorA as Role, '20_项目/P/WS-A');
    expect((await fx.vault.read('20_项目/P/WS-A/workspace.md')).data.stage).toBe('执行中');
  });
});
