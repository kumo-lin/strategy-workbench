/** Names from the app's internals (file names, tools, ids, folders) must never reach the visible page text. */
import { describe, expect, it } from 'vitest';
import { findInternals } from '@/lib/testing/internal-names';

describe('findInternals', () => {
  it('reports file names, tool names, links, ids and vault folders', () => {
    expect(findInternals('打开 项目.md')).toContain('项目.md');
    expect(findInternals('用 vault_read 读一下')).toContain('vault_read');
    expect(findInternals('ask_user 会弹出问题')).toContain('ask_user');
    expect(findInternals('见 [[WS-A]]')).toContain('[[');
    expect(findInternals('这条 #^c1 的评论')).toContain('#^');
    expect(findInternals('引用了 ^m1')).toContain('^m1');
    expect(findInternals('子问题 C1-Q1')).toContain('C1-Q1');
    expect(findInternals('假设 C2 成立')).toContain('C2');
    expect(findInternals('20_项目/个人AI战略')).toContain('20_项目');
    expect(findInternals('90_配置')).toContain('90_配置');
    expect(findInternals('在 00_团队知识\n里')).toContain('00_团队知识');
    expect(findInternals('字段 report_format')).toContain('report_format');
  });

  it('leaves normal text alone', () => {
    const normal = [
      'Q1 的回答',
      'H2-1',
      'Junior A 在等你',
      '试水调查 · 只回答了 H1',
      '《2026-10-16 高层周会纪要（模拟）》',
      '报告 v10',
      'W5 联想的位置',
      'workplan',
      'AI PC',
      'https://example.com/a.html',
      '第 4 步',
    ];
    for (const text of normal) expect(findInternals(text), text).toEqual([]);
  });

  it('drops allowed matches', () => {
    expect(findInternals('打开 项目.md', [/项目\.md/])).toEqual([]);
  });

  it('reports each distinct match once, in order of first appearance', () => {
    expect(findInternals('vault_read 然后 ask_user，再 vault_read')).toEqual(['vault_read', 'ask_user']);
  });
});
