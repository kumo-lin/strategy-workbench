import { describe, expect, it } from 'vitest';
import { appendCommentLine, commentLink, formatCommentLine, nextCommentNumber, parseComments, sanitizeCommentText } from '@/lib/workplan/comments';
import { parseBlocks } from '@/lib/vault';

describe('comment lines', () => {
  it('round-trips through format and parse', () => {
    const line = formatCommentLine({ n: 1, author: 'Senior', text: '假设和决策的关系没说清', target: 'Q2-1' });
    expect(line).toBe('- （Senior）[关于：Q2-1] 假设和决策的关系没说清 ^m1');
    expect(parseComments(line)).toEqual([{ id: 'm1', n: 1, author: 'Senior', target: 'Q2-1', text: '假设和决策的关系没说清' }]);
  });

  it('parses lines without a target or an author, ignores everything else', () => {
    const body = ['# G1', '- 普通列表项', '- （Senior）只有作者 ^m2', '- 没有作者 ^m3', '段落 ^m9'].join('\n');
    expect(parseComments(body).map((c) => [c.id, c.author, c.text])).toEqual([
      ['m2', 'Senior', '只有作者'],
      ['m3', '', '没有作者'],
    ]);
  });

  it('numbers the next comment after the largest one', () => {
    expect(nextCommentNumber('')).toBe(1);
    expect(nextCommentNumber('- （S）a ^m1\n- （S）b ^m4')).toBe(5);
  });

  it('keeps a comment on one line and strips a pasted marker', () => {
    expect(sanitizeCommentText('第一行\n第二行 ^m7')).toBe('第一行 第二行');
    expect(formatCommentLine({ n: 2, author: 'S', text: 'a\nb' })).toBe('- （S）a b ^m2');
  });

  it('appends under one Comment heading and every comment is a vault block', () => {
    let body = '# G1 审批\n\n## 提交说明\n\n说明\n';
    body = appendCommentLine(body, formatCommentLine({ n: 1, author: 'Senior', text: '一' }));
    body = appendCommentLine(body, formatCommentLine({ n: 2, author: 'Senior', text: '二' }));
    expect(body.match(/## Comment/g)).toHaveLength(1);
    expect([...parseBlocks(body).keys()]).toEqual(['m1', 'm2']);
    expect(parseBlocks(body).get('m2')?.text).toBe('（Senior）二');
  });

  it('builds the link workplan.changes stores', () => {
    expect(commentLink('20_项目/P/WS-A/review/G1 2026-10-24.md', 'm1')).toBe('[[20_项目/P/WS-A/review/G1 2026-10-24#^m1]]');
  });
});

describe('comment targets', () => {
  it('lists the headings two to four levels deep, so a sub-question of a question-tree workplan can be picked', async () => {
    const { commentTargets } = await import('@/lib/workplan/comments');
    const body = '# WS-A workplan v1\n\n## 问题树与假设\n### Q1 谁决定买？\n### Q2 按什么标准放行？\n#### Q2-1 管得住是准入要求吗？\n##### 不列\n正文 ## 不是标题\n';
    expect(commentTargets(body)).toEqual(['问题树与假设', 'Q1 谁决定买？', 'Q2 按什么标准放行？', 'Q2-1 管得住是准入要求吗？']);
  });
});
