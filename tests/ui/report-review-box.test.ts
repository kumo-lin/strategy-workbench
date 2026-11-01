/** C1: the report page's "提交给 Senior 确认" box and its status texts. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReportReviewBox, type ReportReviewBoxProps } from '@/components/workspace/report-review-box';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {} }),
}));

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

const box = (over: Partial<ReportReviewBoxProps> = {}) =>
  html(
    createElement(ReportReviewBox, {
      workspacePath: '20_项目/P/WS-A',
      reportPath: '20_项目/P/WS-A/调查/R1/报告 v1.md',
      reportName: '报告 v1',
      owner: 'Junior A',
      reviewer: 'Senior',
      state: 'none',
      isOwner: true,
      canSubmit: true,
      summaryDraft: '买方的关键是 IT 可管理性',
      ...over,
    }),
  );

describe('ReportReviewBox', () => {
  it('1: none + owner + newest version shows the submit button', () => {
    const out = box();
    expect(out).toContain('data-testid="submit-report"');
    expect(out).toContain('报告没问题，提交给 Senior →'); // D-64 T40 (ui-4d)
  });

  it('2: none + not the owner renders nothing', () => {
    expect(box({ isOwner: false })).toBe('');
  });

  it('3: open says it waits for the reviewer, and shows the panel when given', () => {
    const out = box({ state: 'open', panel: createElement('p', null, '评审面板') });
    expect(out).toContain('已提交给 Senior，等确认');
    expect(out).toContain('评审面板');
  });

  it('4: confirmed says so and has no submit button', () => {
    const out = box({ state: 'confirmed' });
    expect(out).toContain('✓ Senior 已确认，这份报告已放进项目文件');
    expect(out).not.toContain('data-testid="submit-report"');
  });

  it('5: sent_back + owner can submit again', () => {
    const out = box({ state: 'sent_back' });
    expect(out).toContain('Senior 有意见，改完可以再提交');
    expect(out).toContain('data-testid="submit-report"');
  });

  it('6: sent_back on an older version has no submit button', () => {
    expect(box({ state: 'sent_back', canSubmit: false })).not.toContain('data-testid="submit-report"');
  });
});
