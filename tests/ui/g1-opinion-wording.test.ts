/** Spec 5a-T5: G1 is "send it for an opinion", so no screen says 审批 / 批准 / 打回. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReviewPanel } from '@/components/workspace/review-panel';
import { ReviewRequestCard } from '@/components/workspace/review-request-card';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import type { CommentView, ReviewView } from '@/lib/workplan/view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {} }),
  usePathname: () => '/workspace/p/w',
}));

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

const comment = (over: Partial<CommentView> = {}): CommentView => ({
  id: 'm1',
  link: '[[review/G1 2026-10-25#^m1]]',
  text: '假设不可证伪',
  author: 'Senior',
  reviewPath: 'review/G1 2026-10-25.md',
  reviewName: 'G1 2026-10-25',
  gate: 'G1',
  result: null,
  handledIn: [],
  ...over,
});

const review = (over: Partial<ReviewView> = {}): ReviewView => ({
  path: 'review/G1 2026-10-25.md',
  name: 'G1 2026-10-25',
  gate: 'G1',
  result: null,
  requester: 'Junior A',
  reviewer: 'Senior',
  created: '2026-10-25',
  version: 1,
  summary: '请看拆题逻辑',
  focus: ['假设 H1 是否可证伪'],
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

describe('the Senior answers with an opinion, not an approval', () => {
  it('pending buttons say 看过了 / 有意见, and the old words are gone', () => {
    const out = panel({});
    expect(out).toContain('看过了，没有要改的');
    expect(out).toContain('有意见，请修改');
    expect(out).not.toContain('>通过<');
    expect(out).not.toContain('打回');
    expect(out).not.toContain('审批');
    expect(out).not.toContain('批准');
    expect(out).toContain('data-testid="approve-review"');
    expect(out).toContain('data-testid="reject-review"');
  });

  it('a reader who cannot reply gets the read-only notice', () => {
    const out = panel({}, { canDecide: false, actorName: 'Junior B' });
    expect(out).toContain('只读：你不能回复这次征求意见。');
    expect(out).not.toContain('打回');
  });

  it('a decided review says 看过了 or 有意见', () => {
    const approved = panel({ result: '通过' });
    expect(approved).toContain('看过了');
    expect(approved).not.toContain('已通过');
    expect(approved).not.toContain('已打回');

    const rejected = panel({ result: '打回' });
    expect(rejected).toContain('有意见');
    expect(rejected).not.toContain('已打回');
    expect(rejected).not.toContain('已通过');
  });
});

describe('the Junior sends it for an opinion', () => {
  const output = {
    prepared: true,
    gate: 'G1',
    subject: 'workplan v1',
    version: 1,
    summary: 's',
    focus: ['f'],
    hypotheses: [],
    next: 'n',
  };
  const card = (props: Partial<Parameters<typeof ReviewRequestCard>[0]>) =>
    html(
      createElement(ReviewRequestCard, {
        workspacePath: '20_项目/P/WS-A',
        state: 'output-available',
        output,
        isOwner: true,
        owner: 'Junior A',
        reviewer: 'Senior',
        hasOpenRequest: false,
        ...props,
      }),
    );

  it('the button and header say 发给 Senior 征求意见', () => {
    const out = card({});
    expect(out).toContain('发给 Senior 征求意见');
    expect(out).not.toContain('审批');
  });

  it('one open request at a time', () => {
    expect(card({ hasOpenRequest: true })).toContain('上一份还在等 Senior 回复');
  });

  it('only the owner sends', () => {
    expect(card({ isOwner: false })).toContain('只有 Junior A 能发');
  });
});

// D-64 T31: the nav has two tabs (工作台, 文件管理); 征求意见 is a step inside 工作台, no longer a tab
describe('the nav', () => {
  it('has no 审批', () => {
    const out = html(createElement(WorkspaceNav, { basePath: '/workspace/p/w' }));
    expect(out).toContain('工作台');
    expect(out).not.toContain('审批');
  });
});

describe('no user-visible string still says 审批 / 批准 / 打回', () => {
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const files = [
    'components/workspace/review-panel.tsx',
    'components/workspace/review-request-card.tsx',
    'components/workspace/workplan-panel.tsx',
    'components/workspace/comment-list.tsx',
    'components/workspace/workspace-nav.tsx',
    'app/workspace/[project]/[workspace]/review/page.tsx',
  ];

  it.each(files)('%s', (file) => {
    const source = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
    expect(source).not.toContain('批准');
    expect(source).not.toContain('审批');
    // The data value stays `打回`; only the quoted literal may appear.
    expect(source.replace(/'打回'/g, '')).not.toContain('打回');
  });
});
