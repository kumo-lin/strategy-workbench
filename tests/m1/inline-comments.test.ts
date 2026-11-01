/** Comments on a workplan version itself: machine data, citable from a workplan change (评论/workplan v<N>.json). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { addInlineComment, inlineCommentExists, inlineCommentLink, inlineCommentsPath, parseInlineCommentLink, readInlineComments } from '@/lib/workplan/inline-comments';
import { ctxFor, makeM1Vault, WS } from './helpers';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM1Vault());
});
afterEach(async () => cleanup());

const now = new Date('2026-10-27T00:00:00Z');

describe('the comment file', () => {
  it('numbers comments c1, c2 … per version, keeps them in order and cites them by link', async () => {
    const a = await addInlineComment(vault, WS, 1, { author: 'Senior', text: 'H1 少了反证', target: '论点与假设' }, now);
    const b = await addInlineComment(vault, WS, 1, { author: 'Junior A', text: '第二条' }, now);
    expect([a.comment.id, b.comment.id]).toEqual(['c1', 'c2']);
    expect(a.link).toBe(`[[${WS}/评论/workplan v1#c1]]`);
    expect((await readInlineComments(vault, WS, 1)).map((c) => c.text)).toEqual(['H1 少了反证', '第二条']);
    expect(await readInlineComments(vault, WS, 2)).toEqual([]);
    expect(inlineCommentsPath(WS, 1)).toBe(`${WS}/评论/workplan v1.json`);
  });

  it('is not a note: the vault does not list it', async () => {
    await addInlineComment(vault, WS, 1, { author: 'Senior', text: 'x' }, now);
    expect((await vault.list(`${WS}/评论`)).filter((e) => e.kind === 'file')).toEqual([]);
  });

  it('recognises its own links only', async () => {
    expect(parseInlineCommentLink(inlineCommentLink(WS, 3, 'c2'))).toEqual({ path: `${WS}/评论/workplan v3.json`, version: 3, id: 'c2' });
    expect(parseInlineCommentLink(`[[${WS}/review/G1 2026-10-24#^m1]]`)).toBeNull();
    expect(parseInlineCommentLink('[[团队]]')).toBeNull();
  });

  it('a link exists only if the comment is in this Workspace\'s own file', async () => {
    const { link } = await addInlineComment(vault, WS, 1, { author: 'Senior', text: 'x' }, now);
    expect(await inlineCommentExists(vault, WS, link)).toBe(true);
    expect(await inlineCommentExists(vault, WS, inlineCommentLink(WS, 1, 'c9'))).toBe(false);
    expect(await inlineCommentExists(vault, WS, inlineCommentLink(WS, 2, 'c1'))).toBe(false);
    expect(await inlineCommentExists(vault, WS, inlineCommentLink('20_项目/P/WS-B', 1, 'c1'))).toBe(false);
  });
});

describe('a workplan change citing such a comment', () => {
  const write = async (comment: string) => {
    const ctx = await ctxFor(vault);
    return executeTool(
      'write_draft',
      {
        note_type: 'workplan',
        name: 'workplan v1',
        frontmatter: {
          id: 'ws-a-wp-v1',
          version: 1,
          derived_from: ['[[团队]]'],
          relates_to: [`[[${WS}/workspace|WS-A]]`],
          changes: [{ comment, intent: '要反证', change: '补了反证' }],
        },
        body: '# WS-A workplan v1\n\n## 论点与假设\n- [[WS-A-H1 IT 可管理性]]\n',
        why: '测试',
      },
      ctx,
    );
  };

  it('is accepted when the comment exists, refused (with the link named) when it does not', async () => {
    const { link } = await addInlineComment(vault, WS, 1, { author: 'Senior', text: 'H1 少了反证' }, now);
    await expect(write(link)).resolves.toMatchObject({ created: false });
    await expect(write(inlineCommentLink(WS, 1, 'c7'))).rejects.toThrow('评论/workplan v1#c7');
  });

  it('a review comment is checked as before', async () => {
    await expect(write(`[[${WS}/review/G1 2026-10-24#^m1]]`)).rejects.toThrow('追溯不到');
  });
});
