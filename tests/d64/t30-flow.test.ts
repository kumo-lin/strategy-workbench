/** D-64 T30: the step bar has 7 steps (验收清单 §0); asking the Senior for an opinion is not one of them. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlowBar } from '@/components/workflow/flow-bar';
import { nextStepFor } from '@/lib/workflow/next-step';
import { computeFlow, FLOW_STEPS, stepStatus, type FlowFacts } from '@/lib/workflow/steps';

const facts = (over: Partial<FlowFacts> = {}): FlowFacts => ({
  projectConfirmed: true,
  projectOwner: 'Senior',
  owner: '分析师甲',
  reviewer: 'Senior',
  stage: '拆题中',
  g1: 'none',
  unhandledComments: 0,
  research: 'none',
  decisionDrafted: false,
  decisionConfirmed: false,
  next: { workspace: 'L2 凭什么赢', owner: '分析师乙' },
  ...over,
});
const at = (over: Partial<FlowFacts>) => computeFlow(facts(over));

describe('T30 seven steps', () => {
  it('the names', () => {
    expect(FLOW_STEPS.map((s) => s.name)).toEqual(['研究计划', '调查计划', '调查与报告', '访谈建议', '追加分析', '提交确认', '存入项目文件']);
  });

  it('plan not final → 1; the plan said final or an investigation plan exists → 2', () => {
    expect(at({}).current).toBe(1);
    expect(at({ g1: 'pending', stage: 'workplan待审' }).current).toBe(1); // asking for an opinion does not move the line
    expect(at({ stage: '执行中' }).current).toBe(2); // 研究计划定了，往下做调查计划
    expect(at({ research: 'planning' }).current).toBe(2);
    expect(at({ research: 'approved' })).toMatchObject({ current: 2, who: '分析师甲' });
  });

  it('running or reported → 3; delivered with gaps → 4; interview hits → 5; submitted → 6; confirmed → 7', () => {
    expect(at({ research: 'running' })).toMatchObject({ current: 3, who: 'AI' });
    expect(at({ research: 'reported' })).toMatchObject({ current: 3, who: '分析师甲' });
    expect(at({ research: 'reported', reportGaps: true })).toMatchObject({ current: 4, who: '分析师甲' });
    expect(at({ research: 'reported', reportGaps: true, interviewHits: true })).toMatchObject({ current: 5, who: '分析师甲' });
    expect(at({ research: 'reported', interviewHits: true, reportReview: 'open' })).toMatchObject({ current: 6, who: 'Senior' });
    expect(at({ research: 'reported', stage: '结论待审' }).current).toBe(6);
    expect(at({ research: 'reported', reportReview: 'confirmed', stage: '撰写中' }).current).toBe(7);
    expect(at({ research: 'reported', decisionConfirmed: true }).current).toBe(7);
  });

  it('the opinion is not a step: it only shows in the first cell', () => {
    expect(at({ g1: 'pending' }).cellWho[0]).toBe('已发给 Senior 征求意见（不挡你）');
    expect(at({ g1: 'approved' }).cellWho[0]).toBe('Senior 已回复');
  });

  it('the bar: 7 cells with data-step and data-status, data-current', () => {
    const s = at({ research: 'reported', reportGaps: true });
    const out = renderToString(createElement(FlowBar, { state: s })).replace(/<!-- -->/g, '');
    expect([...out.matchAll(/data-step="(\d)"/g)].map((m) => m[1])).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(out).toContain('data-current="4"');
    for (const n of FLOW_STEPS) expect(out).toContain(n.name);
    expect(out).not.toContain('征求意见');
    expect([1, 2, 3, 4, 5].map((n) => stepStatus(s, n))).toEqual(['done', 'done', 'done', 'current', 'todo']);
  });

  it('the next-step sentence follows the new numbers', () => {
    const next = (over: Partial<FlowFacts>, actor: string) => {
      const f = facts(over);
      return nextStepFor({ facts: f, state: computeFlow(f), actor: { name: actor }, unhandled: 0, base: '/workspace/p/w', investigation: 'inv' });
    };
    expect(next({}, '分析师甲')).toMatchObject({ step: 1, turn: 'mine', action: { event: 'cocreate' } });
    // 复核 P7: once a version is written the step is about moving on, not about answering the opening questions
    expect(next({ workplanWritten: true }, '分析师甲')).toMatchObject({ step: 1, turn: 'mine', text: expect.stringContaining('研究计划写好了'), action: { kind: 'link', label: '研究计划定了，往下做调查计划' } });
    expect(next({ workplanWritten: true }, '分析师甲').text).not.toContain('3 个问题');
    expect(next({ research: 'reported', reportGaps: true }, '分析师甲')).toMatchObject({ step: 4, turn: 'mine', text: expect.stringContaining('访谈建议') });
    expect(next({ research: 'reported', interviewHits: true }, '分析师甲')).toMatchObject({ step: 5, text: expect.stringContaining('提交给 Senior 确认') });
    expect(next({ research: 'reported', reportReview: 'open' }, 'Senior')).toMatchObject({ step: 6, turn: 'mine', action: { label: '去确认' } });
    expect(next({ research: 'reported', decisionConfirmed: true }, 'Senior')).toMatchObject({ step: 7, turn: 'done' });
  });
});
