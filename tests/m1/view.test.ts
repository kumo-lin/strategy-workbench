import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/lib/vault';
import { addComment, decideReview, requestReview } from '@/lib/workplan/review-flow';
import { addedLines, buildCommentViews, buildReviewViews, buildWorkplanViews, parseReviewBody } from '@/lib/workplan/view';
import { makeM1Vault, ROLES, WS } from './helpers';

describe('addedLines', () => {
  it('marks new and reworded lines, not moved-over unchanged ones', () => {
    const prev = ['# 标题', '', '论点 1', '论点 2', '- next'].join('\n');
    const next = ['# 标题', '', '论点 1（补了反证）〔m1〕', '论点 2', '新的一段', '- next'].join('\n');
    expect(addedLines(prev, next)).toEqual([2, 4]);
  });
  it('is empty for identical text and ignores blank lines and trailing spaces', () => {
    expect(addedLines('a\n\nb', 'a  \n\nb')).toEqual([]);
    expect(addedLines('a', 'a\n\n\n')).toEqual([]);
  });
});

describe('parseReviewBody', () => {
  it('reads summary and focus', () => {
    const body = '# G1\n\n> x\n\n## 提交说明\n\n看拆题。\n第二行。\n\n## 请重点看\n\n- H1 可证伪吗\n- 少了反证吗\n\n## Comment\n\n- （S）a ^m1\n';
    expect(parseReviewBody(body)).toEqual({ summary: '看拆题。\n第二行。', focus: ['H1 可证伪吗', '少了反证吗'] });
  });
});

describe('views over a real G1 round', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, cleanup } = await makeM1Vault());
  });
  afterEach(async () => cleanup());

  it('trace each change to its comment, and flag a dangling one', async () => {
    const { reviewPath } = await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: `${WS}/workplan v1.md`, summary: '请看', focus: ['f1'] });
    const { link } = await addComment({ vault, actor: ROLES.senior, reviewPath, text: '少了反证' });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve' });
    const v1 = await vault.read(`${WS}/workplan v1.md`);
    // a v2 with one real and one dangling change (written directly: the write_draft hook is what refuses the dangling one)
    await vault.write(`${WS}/workplan v2.md`, {
      frontmatter: {
        id: 'ws-a-wp-v2', type: 'workplan', status: '进行中', created: '2026-10-25', updated: '2026-10-25', author: 'AI',
        derived_from: [`[[${WS}/workplan v1|workplan v1]]`], relates_to: ['[[团队]]'], version: 2, approved_by: null, approved_at: null,
        changes: [
          { comment: link, intent: '每个论点要有反证', change: '补了反证' },
          { comment: link.replace('#^m1', '#^m9'), intent: 'i', change: 'c' },
        ],
      },
      body: `${v1.body}\n- 反证：看 Win10 换机潮〔m1〕\n`,
    });

    const [a, b] = await buildWorkplanViews(vault, WS);
    expect([a.version, b.version]).toEqual([1, 2]);
    expect(a.status).toBe('已确认');
    expect(a.approvedBy).toBe('Senior');
    expect(b.changes.map((c) => [c.traced, c.commentId, c.commentText])).toEqual([
      [true, 'm1', '少了反证'],
      [false, null, null],
    ]);
    expect(b.changes[0]).toMatchObject({ commentAuthor: 'Senior', reviewName: expect.stringMatching(/^G1 /) });
    expect(b.changedLines).toHaveLength(1);
    expect(b.body.split('\n')[b.changedLines[0]]).toContain('反证：看 Win10');

    const comments = await buildCommentViews(vault, WS);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ id: 'm1', result: '通过', handledIn: [2] });

    const reviews = await buildReviewViews(vault, WS);
    expect(reviews[0]).toMatchObject({ gate: 'G1', result: '通过', version: 1, summary: '请看', focus: ['f1'] });
  });
});
