/** D-64 复核 A: what the analyst and the Senior read is their own language — every tool has a Chinese name, no engineering words. */
import { describe, expect, it } from 'vitest';
import { toolLabel } from '@/components/chat/chat-state';
import { TOOL_NAMES } from '@/lib/harness/phases';

describe('复核 A: the chat names every tool in Chinese', () => {
  it.each([...TOOL_NAMES])('%s', (name) => {
    expect(toolLabel(name)).not.toMatch(/[A-Za-z]/);
  });
});

describe('复核 A: a workplan file is named 研究计划 where readers see it', () => {
  it('a link to it in a report', async () => {
    const { parseInline } = await import('@/components/research/markdown-lite');
    expect(parseInline('来自 [[20_项目/P/W/workplan v2]]')).toContainEqual({ kind: 'link', label: '研究计划 v2' });
    expect(parseInline('[[20_项目/P/W/workplan v2|自定义]]')).toContainEqual({ kind: 'link', label: '自定义' });
  });
  it('the origin lines of 怎么查的', async () => {
    const { renderOriginLines } = await import('@/lib/research/origin');
    const lines = renderOriginLines([{ kind: '研究计划', name: 'workplan v2', path: '20_项目/P/W/workplan v2.md', link: '[[20_项目/P/W/workplan v2]]', quote: null, via: 'workplan v2' }] as never);
    expect(lines.join('\n').replace(/\[\[[^\]]+\]\]/g, '')).not.toMatch(/workplan/);
  });
});

it('复核 A: the link a report writes to the workplan carries the reader name', async () => {
  const { workplanLinkOf } = await import('@/lib/research/execute');
  expect(workplanLinkOf('20_项目/P/W/workplan v2.md')).toBe('[[20_项目/P/W/workplan v2|研究计划 v2]]');
});
