/** Spec 5a-T7: the workplan page has a visible button to send it for an opinion, not only the card inside the chat. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SendForOpinion } from '@/components/workspace/send-for-opinion';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {} }),
}));

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

describe('send for an opinion from the workplan page', () => {
  it('renders a visible button with the reviewer’s name', () => {
    const out = html(
      createElement(SendForOpinion, {
        workspacePath: '20_项目/P/WS-A',
        subject: '20_项目/P/WS-A/workplan v1.md',
        version: 1,
        body: '## 要回答的问题与要支撑的决策\n\n问题。',
        reviewer: 'Senior',
      }),
    );
    // D-64 T35 (ui-2): 请 Senior 提意见
    expect(out).toContain('data-testid="ask-senior"');
    expect(out).toContain('请 Senior 提意见');
  });
});
