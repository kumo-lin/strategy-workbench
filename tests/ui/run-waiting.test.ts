/** A run that stopped for the owner's answer (内部资料清单) is "waiting", not running and not finished. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { groupRun } from '@/components/research/run-groups';
import { RunView } from '@/components/research/run-view';
import type { ResearchUIMessage } from '@/lib/research/progress';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

const step = (id: string, n: number, status: 'running' | 'done' | 'skipped' | 'waiting', title = `t${n}`) => ({
  type: 'data-step' as const,
  id,
  data: { kind: 'step' as const, id, step: n, title, status },
});

const messages = [
  {
    id: 'm1',
    role: 'assistant',
    parts: [step('s1', 1, 'done'), step('s2:confirm', 2, 'waiting', '等你确认')],
  },
] as unknown as ResearchUIMessage[];

const view = (msgs: ResearchUIMessage[], running: boolean) => {
  const { groups, steps } = groupRun(msgs);
  return html(createElement(RunView, { groups, steps, running, modeName: '试水调查', scope: '只查 H1', planName: '计划 v2', usual: '约 3–4 分钟' }));
};

describe('a run waiting for the owner', () => {
  it('the group whose latest step is waiting has status waiting', () => {
    const { groups } = groupRun(messages);
    expect(groups[1].status).toBe('waiting');
    expect(groups[0].status).toBe('done');
    expect(groups[2].status).toBe('todo');
  });

  it('a normal running run is unchanged', () => {
    const runningMessages = [
      { id: 'm2', role: 'assistant', parts: [step('s1', 1, 'done'), step('s2:ctx', 2, 'running')] },
    ] as unknown as ResearchUIMessage[];
    const out = view(runningMessages, true);
    expect(out).toContain('试水调查进行中');
    expect(out).not.toContain('等你确认内部资料够不够');
  });
});
