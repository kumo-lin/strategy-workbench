/** The workplan panel shows the legacy note above the body only when the view says so. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkplanPanel } from '@/components/workspace/workplan-panel';
import type { WorkplanVersionView } from '@/lib/workplan/view';

const version = (beforeQuestionTree: boolean): WorkplanVersionView => ({
  version: 1,
  path: '20_项目/P/WS-A/workplan v1.md',
  status: '进行中',
  author: 'AI',
  created: '2026-10-25',
  approvedBy: null,
  approvedAt: null,
  body: '# WS-A workplan v1\n\n## 论点与假设\n- 论点 1\n',
  changes: [],
  changedLines: [],
  beforeQuestionTree,
});

describe('WorkplanPanel', () => {
  it('shows 这是改成问题树之前的版本 when the version predates the tree', () => {
    const html = renderToStaticMarkup(createElement(WorkplanPanel, { versions: [version(true)] }));
    expect(html).toContain('data-testid="workplan-legacy-note"');
    expect(html).toContain('这是改成问题树之前的版本');
  });

  it('shows nothing otherwise', () => {
    const html = renderToStaticMarkup(createElement(WorkplanPanel, { versions: [version(false)] }));
    expect(html).not.toContain('workplan-legacy-note');
    expect(html).toContain('论点与假设');
  });
});
