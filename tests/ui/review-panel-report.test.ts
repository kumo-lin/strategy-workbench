/** C1: the ReviewPanel says "confirm this report", not "send for an opinion", for a 结论 review. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewPanel } from '@/components/workspace/review-panel';
import type { CommentView, ReviewView } from '@/lib/workplan/view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {} }),
}));

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

const comment = (over: Partial<CommentView> = {}): CommentView => ({
  id: 'm1',
  link: '[[review/结论 2026-10-25#^m1]]',
  text: 'Q1 的口径确认一下',
  author: 'Senior',
  reviewPath: 'review/结论 2026-10-25.md',
  reviewName: '结论 2026-10-25',
  gate: '结论',
  result: null,
  handledIn: [],
  ...over,
});

const review = (over: Partial<ReviewView> = {}): ReviewView => ({
  path: 'review/结论 2026-10-25.md',
  name: '结论 2026-10-25',
  gate: '结论',
  result: null,
  requester: 'Junior A',
  reviewer: 'Senior',
  created: '2026-10-25',
  version: null,
  summary: '见报告',
  focus: [],
  comments: [comment()],
  ...over,
});

const panel = (over: Partial<ReviewView>, props: Partial<Parameters<typeof ReviewPanel>[0]> = {}) =>
  html(
    createElement(ReviewPanel, {
      review: review(over),
      actorName: 'Senior',
      canComment: true,
      canDecide: true,
      targets: [],
      ...props,
    }),
  );

describe('the Senior confirms a report', () => {
  it('pending buttons confirm the report, and the workplan wording is gone', () => {
    const out = panel({});
    expect(out).toContain('确认，放进项目文件');
    expect(out).toContain('有意见，请修改');
    expect(out).toContain('提交给 Senior 确认');
    expect(out).not.toContain('看过了，没有要改的');
    expect(out).not.toContain('征求意见');
    expect(out).toContain('data-testid="approve-review"');
    expect(out).toContain('data-testid="reject-review"');
  });

  it('a decided review says 已确认', () => {
    const out = panel({ result: '通过' });
    expect(out).toContain('已确认');
    expect(out).toContain('Senior 已确认');
    expect(out).not.toContain('看过了');
  });

  it('a reader who cannot confirm gets the report read-only notice', () => {
    const out = panel({}, { canDecide: false, canComment: true, actorName: 'Junior B' });
    expect(out).toContain('只读：你不能确认这份报告。');
    expect(out).toContain('Senior 才能确认；Junior A 提交的，不能自己确认。');
    expect(out).toContain('看这份报告，在上面留意见；确认由 Senior 来做。');
  });

  it('a reader who cannot comment is told who comments', () => {
    const out = panel({}, { canDecide: false, canComment: false, actorName: 'Junior B' });
    expect(out).toContain('看这份报告；意见由 Senior 和别的角色来留。');
  });
});
