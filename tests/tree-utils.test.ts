/** Acceptance tests for the DeepSeek task T-001 (vault tree). Written before the code. */
import { describe, expect, it } from 'vitest';
import { ancestorPaths, countNotes, displayName, filterTree } from '@/components/vault/tree-utils';
import type { VaultTreeNode } from '@/lib/vault/vault';

const tree: VaultTreeNode[] = [
  {
    path: '10_资料库',
    name: '10_资料库',
    kind: 'dir',
    children: [
      { path: '10_资料库/IDC 报告.md', name: 'IDC 报告.md', kind: 'file' },
      { path: '10_资料库/Gartner.md', name: 'Gartner.md', kind: 'file' },
    ],
  },
  {
    path: '20_项目',
    name: '20_项目',
    kind: 'dir',
    children: [
      {
        path: '20_项目/P',
        name: 'P',
        kind: 'dir',
        children: [
          { path: '20_项目/P/WS-A', name: 'WS-A', kind: 'dir', children: [{ path: '20_项目/P/WS-A/workplan v1.md', name: 'workplan v1.md', kind: 'file' }] },
          { path: '20_项目/P/空文件夹', name: '空文件夹', kind: 'dir', children: [] },
          { path: '20_项目/P/项目.md', name: '项目.md', kind: 'file' },
        ],
      },
    ],
  },
];

describe('tree-utils', () => {
  it('displayName strips .md from files only', () => {
    expect(displayName({ path: 'a/x.md', name: 'x.md', kind: 'file' })).toBe('x');
    expect(displayName({ path: 'a/v1.md', name: 'v1.md', kind: 'dir' })).toBe('v1.md');
  });

  it('countNotes counts files in a subtree', () => {
    expect(countNotes(tree[0])).toBe(2);
    expect(countNotes(tree[1])).toBe(2);
    expect(countNotes({ path: 'x.md', name: 'x.md', kind: 'file' })).toBe(1);
    expect(countNotes({ path: 'e', name: 'e', kind: 'dir', children: [] })).toBe(0);
  });

  it('filterTree keeps matching files with their ancestors, case-insensitive', () => {
    const r = filterTree(tree, 'WORKPLAN');
    expect(r).toHaveLength(1);
    expect(r[0].path).toBe('20_项目');
    expect(r[0].children![0].children!.map((c) => c.path)).toEqual(['20_项目/P/WS-A']);
    expect(r[0].children![0].children![0].children!.map((c) => c.name)).toEqual(['workplan v1.md']);
  });

  it('filterTree keeps a matching folder with all its children', () => {
    const r = filterTree(tree, '资料库');
    expect(r).toEqual([tree[0]]);
  });

  it('filterTree does not mutate its input and returns input for blank query', () => {
    const before = JSON.stringify(tree);
    filterTree(tree, 'gartner');
    expect(JSON.stringify(tree)).toBe(before);
    expect(filterTree(tree, '   ')).toBe(tree);
    expect(filterTree(tree, 'zzz')).toEqual([]);
  });

  it('ancestorPaths lists parent folders from the root down', () => {
    expect(ancestorPaths('20_项目/P/WS-A/workplan v1.md')).toEqual(['20_项目', '20_项目/P', '20_项目/P/WS-A']);
    expect(ancestorPaths('top.md')).toEqual([]);
  });
});
