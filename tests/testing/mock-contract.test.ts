/** The mock model's task contract: a `任务：…` line in the system prompt picks the script; the user's words are only echoed. */
import { describe, expect, it } from 'vitest';
import { MOCK_TASKS, echoOf, taskLine, taskOf, type MockTask } from '@/lib/testing/mock-contract';
import { answerResearchStep } from '@/lib/testing/mock-research';

describe('taskLine / taskOf', () => {
  it('names each task with its exact line and round-trips every key', () => {
    expect(taskLine('workplan_cocreate')).toBe('任务：共创 workplan');
    for (const k of Object.keys(MOCK_TASKS) as MockTask[]) {
      expect(taskOf(`规则：…\n${taskLine(k)}\n更多规则`)).toBe(k);
    }
  });

  it('returns null without a task line, for an unknown label, for a longer label, and mid-sentence', () => {
    expect(taskOf('当前角色：Junior A（junior）。')).toBeNull();
    expect(taskOf('任务：你说什么')).toBeNull();
    expect(taskOf('任务：共创 workplan 草稿')).toBeNull();
    expect(taskOf('请按 任务：共创 workplan 来做')).toBeNull();
  });

  it('accepts leading spaces and a trailing 。 or space, and takes the first valid line', () => {
    expect(taskOf('  任务：拆题')).toBe('project_split');
    expect(taskOf('任务：拆题。')).toBe('project_split');
    expect(taskOf('任务：拆题   ')).toBe('project_split');
    expect(taskOf('任务：拟调查计划\n任务：拆题')).toBe('research_plan');
  });
});

describe('echoOf', () => {
  it('collapses whitespace and trims', () => {
    expect(echoOf('  企业为什么\n  会买单？ ')).toBe('企业为什么 会买单？');
  });

  it('takes the first 12 code points by default', () => {
    const thirty = '一二三四五六七八九十'.repeat(3);
    expect(echoOf(thirty)).toBe('一二三四五六七八九十一二');
    expect(echoOf('ab', 12)).toBe('ab');
    expect(echoOf('')).toBe('');
  });

  it('counts an emoji as one code point', () => {
    expect(echoOf('😀'.repeat(13))).toBe('😀'.repeat(12));
    expect(echoOf('😀一二', 2)).toBe('😀一');
  });
});

// D-64 T19: the old calls the To-Be work changes are keyed on their task line, not on Chinese sentences in the prompt.
describe('the four migrated calls answer by their task line', () => {
  it('decision_draft: the M3 draft, citing the first two citable blocks, affects WS-B', () => {
    const text = [taskLine('decision_draft'), '## 本 Workspace：WS-A 买方', '- [[资料甲#^c1]]（A 级）', '- [[资料乙#^c2]]（B 级）', '- [[20_项目/P/WS-B 用户]]（Workspace）'].join('\n');
    expect(answerResearchStep(text)).toMatchObject({
      name: 'WS-A 买方决定-先打IT管理场景',
      reasons: [{ kind: '事实', cites: ['[[资料甲#^c1]]'] }, { kind: '推断', cites: ['[[资料乙#^c2]]'] }],
      affects: ['[[20_项目/P/WS-B 用户]]'],
    });
  });
  it('summary: so_what cites the first evidence key; one result per hypothesis', () => {
    const text = [taskLine('summary'), '- H1 IT 主导 → 成立 [E3]'].join('\n');
    expect(answerResearchStep(text)).toMatchObject({ so_what: '买方的关键是 IT 可管理性 [E3]', results: ['H1 → 成立（提议）：多家独立来源支持'] });
  });
  it('citation_judge: every pair holds', () => {
    expect(answerResearchStep([taskLine('citation_judge'), '- id：p1', '- id：p2'].join('\n'))).toEqual({
      items: ['p1', 'p2'].map((id) => ({ id, fit: '撑得住', reason: '', can: '原文这一句说到的事实', cannot: '原文没有说到的范围和因果' })),
    });
  });
  it('followup: the gap round gets the support queries', () => {
    expect(answerResearchStep(taskLine('followup'))).toEqual({ kb_queries: ['IT 可管理性', 'IT 部门', '预算'], web_queries: ['企业 AI PC 采购 IT 部门', 'AI PC 企业 IT 管理'] });
  });
});
