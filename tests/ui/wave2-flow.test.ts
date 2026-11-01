/** Wave 2 of the UI/UX rework: the next-step sentence, the run grouped by step (the 7-step line itself: tests/d64/t30-flow.test.ts). */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { groupRun } from '@/components/research/run-groups';
import { RunView } from '@/components/research/run-view';
import { isDecisionRead, toolSentence, toolTags } from '@/components/chat/chat-state';
import { NextStepBar } from '@/components/workflow/next-step-bar';
import { nextStepFor } from '@/lib/workflow/next-step';
import { computeFlow, type FlowFacts } from '@/lib/workflow/steps';
import type { ResearchUIMessage } from '@/lib/research/progress';

vi.mock('next/navigation', () => ({ usePathname: () => '/workspace/p/w' }));

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

const facts = (over: Partial<FlowFacts> = {}): FlowFacts => ({
  projectConfirmed: true,
  projectOwner: 'Senior',
  owner: 'Junior A',
  reviewer: 'Senior',
  stage: '拆题中',
  g1: 'none',
  unhandledComments: 0,
  research: 'none',
  decisionDrafted: false,
  decisionConfirmed: false,
  next: { workspace: 'WS-B 用户', owner: 'Junior B' },
  ...over,
});

describe('the next-step sentence: whose turn, and the one button', () => {
  const next = (over: Partial<FlowFacts>, actor: string, unhandled = 0) => {
    const f = facts(over);
    return nextStepFor({ facts: f, state: computeFlow(f), actor: { name: actor }, unhandled, base: '/workspace/p/w', investigation: 'inv' });
  };
  it('step 1: the owner gets 开始共创, others wait', () => {
    expect(next({}, 'Junior A')).toMatchObject({ turn: 'mine', action: { kind: 'event', event: 'cocreate' } });
    expect(next({}, 'Senior')).toMatchObject({ turn: 'waiting' });
    expect(next({}, 'Senior').action).toBeUndefined();
  });
  it('the owner sent the plan for an opinion: still step 1 (D-64 T30), the aside says the opinion does not block', () => {
    const n = next({ g1: 'pending' }, 'Junior A');
    expect(n).toMatchObject({ step: 1, turn: 'mine' });
    expect(n.aside?.text).toContain('已发给 Senior 征求意见');
    expect(n.aside?.action).toBeUndefined();
  });
  it('the reviewer is asked for an opinion: waiting on Junior A, with 去看', () => {
    const n = next({ g1: 'pending' }, 'Senior');
    expect(n.turn).toBe('waiting');
    expect(n.aside).toMatchObject({ action: { kind: 'link', href: '/workspace/p/w/review', label: '去看' } });
    expect(n.aside?.text).toContain('来征求你的意见');
  });
  it('comments came back: the aside offers 和 AI 一起解读 (#16)', () => {
    const n = next({ g1: 'approved', unhandledComments: 2 }, 'Junior A', 2);
    expect(n.aside?.action).toMatchObject({ kind: 'event', event: 'interpret', label: '和 AI 一起解读' });
    expect(n.aside?.text).toContain('回复了 2 条意见');
  });
  it('approved with nothing to change: a note, no button', () => {
    const n = next({ g1: 'approved' }, 'Junior A');
    expect(n.step).toBe(1);
    expect(n.aside?.text).toContain('看过了，没有要改的');
  });
  it('no aside for anyone else, or once the line is done', () => {
    expect(next({ g1: 'pending' }, 'Junior B').aside).toBeUndefined();
    expect(next({ g1: 'approved', research: 'reported', decisionDrafted: true, decisionConfirmed: true }, 'Senior').aside).toBeUndefined();
  });
  it('step 3 while the AI runs: everybody waits, the link goes to the run', () => {
    const n = next({ g1: 'approved', research: 'running' }, 'Junior A');
    expect(n.turn).toBe('waiting');
    expect(n.action).toMatchObject({ href: '/workspace/p/w/research/inv' });
  });
  it('step 7 says who works next and that they will find the decision', () => {
    const n = next({ g1: 'approved', research: 'reported', decisionDrafted: true, decisionConfirmed: true }, 'Senior');
    expect(n).toMatchObject({ step: 7, turn: 'done' });
    expect(n.text).toContain('WS-B 用户（Junior B）的下一次调查会检索到它');
  });
});

describe('the next-step bar renders the opinion aside', () => {
  const next = (over: Partial<FlowFacts>, actor: string, unhandled = 0) => {
    const f = facts(over);
    return nextStepFor({ facts: f, state: computeFlow(f), actor: { name: actor }, unhandled, base: '/workspace/p/w', investigation: 'inv' });
  };
  it('the reviewer gets a second, muted line with 去看', () => {
    const out = html(createElement(NextStepBar, { next: next({ g1: 'pending' }, 'Senior'), base: '/workspace/p/w' }));
    expect(out).toContain('data-testid="next-step-aside"');
    expect(out).toContain('来征求你的意见');
    expect(out).toContain('href="/workspace/p/w/review"');
  });
  it('without an aside there is no second line', () => {
    const out = html(createElement(NextStepBar, { next: next({}, 'Junior A'), base: '/workspace/p/w' }));
    expect(out).not.toContain('next-step-aside');
  });
});

describe('tool cards say it in one sentence', () => {
  const read = { path: '20_项目/P/决策/WS-A 买方决定-先打IT管理场景.md', why: '沿 relates_to 找到已确认的决定「先打IT管理场景」（项目），这次调查要遵循它' };
  it('the reason of the run is the sentence; a decision read is tagged', () => {
    expect(toolSentence('vault_read', read)).toContain('这次调查要遵循它');
    expect(toolTags('vault_read', read)).toEqual(['已确认的决定']);
    expect(isDecisionRead('vault_read', read)).toBe(true);
    expect(isDecisionRead('vault_search', read)).toBe(false);
  });
  it('without a reason: the main argument; meetings are 高层指示, the team library 团队知识', () => {
    expect(toolSentence('web_search', { query: 'AI PC 采购' })).toBe('AI PC 采购');
    expect(toolTags('vault_search', { dir: '20_项目/P/会议', query: '' })).toEqual(['高层指示']);
    expect(toolTags('vault_search', { dir: '00_团队知识', query: '' })).toEqual(['团队知识']);
    expect(toolTags('web_fetch', { url: 'https://x' })).toEqual([]);
  });
});

describe('the run, grouped by step', () => {
  const step = (id: string, n: number, status: 'running' | 'done' | 'skipped', title = `t${n}`, detail?: string) => ({ type: 'data-step' as const, id, data: { kind: 'step' as const, id, step: n, title, status, detail } });
  const tool = (id: string, name: string, input: unknown) => ({ type: `tool-${name}`, toolCallId: id, state: 'output-available', input, output: {} });
  const msgs = [
    {
      id: 'm1',
      role: 'assistant',
      parts: [
        step('s1', 1, 'done'),
        step('s2:ctx', 2, 'running'),
        tool('c1', 'vault_search', { dir: '00_团队知识', why: '查团队知识' }),
        tool('c2', 'vault_read', { path: '20_项目/P/决策/D.md', why: '沿 relates_to 找到已确认的决定「D」' }),
        step('s3:Q1', 3, 'running', '查网上 · Q1'),
        tool('c3', 'web_search', { query: 'q', why: '搜' }),
      ],
    },
  ] as unknown as ResearchUIMessage[];
  it('cards go under the step that was running; a decision read goes under step 2 and is counted', () => {
    const { groups } = groupRun(msgs);
    expect(groups).toHaveLength(9);
    expect(groups[1].tools.map((t) => t.name)).toEqual(['vault_search', 'vault_read']);
    expect(groups[1].decisionReads).toBe(1);
    expect(groups[2].tools.map((t) => t.name)).toEqual(['web_search']);
    expect(groups.map((g) => g.status)).toEqual(['done', 'running', 'running', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
  });
  it('the view: header with the clock, nine segments, "用到了已确认的决定 ×1" on step 2 (open), the other steps folded', () => {
    const { groups, steps } = groupRun(msgs);
    const out = html(createElement(RunView, { groups, steps, running: true, elapsedSec: 102, modeName: '试水调查', scope: '只查 H1', planName: '计划 v2', usual: '约 3–4 分钟' }));
    expect(out).toContain('试水调查进行中 · 只查 H1 · 按 计划 v2 · 已用 1:42 · 通常约 3–4 分钟');
    expect((out.match(/data-testid="run-segment"/g) ?? []).length).toBe(9);
    expect(out).toContain('用到了已确认的决定 ×1');
    expect(out).toContain('其中 1 条是已确认的决定');
    expect(out).toMatch(/data-step="2"[^>]*open=""|open=""[^>]*data-step="2"/);
    expect(out).not.toMatch(/data-step="3"[^>]*open=""|open=""[^>]*data-step="3"/);
    expect(out).toContain('正在做：查网上 · Q1');
  });
  it('no steps yet: a hint', () => {
    expect(html(createElement(RunView, { groups: groupRun([]).groups, steps: [], running: false, modeName: 'x', scope: 'y', planName: 'z', usual: 'u' }))).toContain('还没有开始');
  });
});
