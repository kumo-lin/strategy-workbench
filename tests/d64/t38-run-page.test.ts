/** D-64 T38 (ui-3b): the run page lists every step and the search-and-judgment cards (T26 events). */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { groupRun } from '@/components/research/run-groups';
import { RunView } from '@/components/research/run-view';
import type { ResearchUIMessage, SearchCardEvent } from '@/lib/research/progress';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const card = (over: Partial<SearchCardEvent>): SearchCardEvent => ({ kind: 'search-card', n: 1, source: 'files', subQuestion: 'C1-Q1', query: '跨设备 留存', results: 2, judgment: '找到 2 份相关资料，读原文判断', ...over });
const messages = [
  {
    id: 'm',
    role: 'assistant',
    parts: [
      { type: 'data-step', id: 's0', data: { kind: 'step', id: 's0', step: 1, title: '读取决策契约、研究计划和 Senior 意见', status: 'done' } },
      { type: 'data-card', id: 'card-1', data: card({}) },
      { type: 'data-card', id: 'card-2', data: card({ n: 2, source: 'web', results: 6, judgment: '读了 2 页，没有新证据' }) },
      { type: 'data-card', id: 'card-2', data: card({ n: 2, source: 'web', results: 6, judgment: '读了 2 页，没有新证据' }) },
      { type: 'data-card', id: 'card-3-stop-C1-Q1', data: card({ n: 3, source: 'web', query: '', results: 0, judgment: '连续 2 轮无新证据，停止补查', stop: true }) },
    ],
  },
] as unknown as ResearchUIMessage[];

describe('T38 run page', () => {
  it('groupRun collects the cards in order, once each', () => {
    expect(groupRun(messages).cards.map((c) => [c.n, c.source, c.stop ?? false])).toEqual([
      [1, 'files', false],
      [2, 'web', false],
      [3, 'web', true],
    ]);
  });

  it('every text and testid of ui-3b: the first step reads the task context, a card says the search stopped', () => {
    const { groups, steps, cards } = groupRun(messages);
    const out = html(createElement(RunView, { groups, steps, cards, running: false, modeName: '完整调查', scope: '查全部假设', planName: '计划 v1', usual: '' }));
    for (const t of ['执行', '每一步都留痕，可点开', '检索与判断卡片', '读取决策契约、研究计划和 Senior 意见', '连续 2 轮无新证据']) expect(out, t).toContain(t);
    for (const id of ['run-steps', 'run-step']) expect(out).toContain(`data-testid="${id}"`);
    expect([...out.matchAll(/data-testid="search-card" data-source="(\w+)"/g)].map((m) => m[1])).toEqual(['files', 'web', 'web']);
    expect(out).toContain('第 1 次检索');
    expect(out).toContain('跨设备 留存');
    expect(out).not.toContain('等你确认');
  });
});
