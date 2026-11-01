/** GFM tables (and blockquotes) in the report viewer's markdown: must-3 对照表 needs them. */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isTableSeparator, parseMarkdown, splitTableRow, stripFrontmatter, type Inline } from '@/components/research/markdown-lite';
import { ReportViewer } from '@/components/research/report-viewer';
import { uniqueCitedSources } from '@/components/research/citation-utils';
import type { CitationDetail } from '@/lib/research/citation-types';

const text = (cell: Inline[]) => cell.map((n) => ('text' in n ? n.text : n.kind)).join('');
const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

describe('splitTableRow / isTableSeparator', () => {
  it('splits on pipes but not inside [[wikilinks|alias]], `code` or after a backslash', () => {
    expect(splitTableRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
    expect(splitTableRow('a | b')).toEqual(['a', 'b']);
    expect(splitTableRow('| [[资料#^c1|别名]] | `x|y` | 1\\|2 |')).toEqual(['[[资料#^c1|别名]]', '`x|y`', '1|2']);
    expect(splitTableRow('| a |  | c |')).toEqual(['a', '', 'c']);
  });
  it('recognises delimiter rows only', () => {
    expect(isTableSeparator('|---|---|')).toBe(true);
    expect(isTableSeparator('| :--- | :---: | ---: |')).toBe(true);
    expect(isTableSeparator('--- | ---')).toBe(true);
    expect(isTableSeparator('| a | b |')).toBe(false);
    expect(isTableSeparator('---')).toBe(false); // a horizontal rule is not a table
    expect(isTableSeparator('')).toBe(false);
  });
});

describe('parseMarkdown: tables', () => {
  const md = '前言\n\n| 项 | 团队 | 普通 |\n|:---|:---:|---:|\n| 引用 | 33/33 “原文” [[资料甲#^c1]] | 24 |\n| 反证 | 4/4 |\n\n后记';
  it('header, alignment and rows (short rows padded, citations kept inside cells)', () => {
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table', 'paragraph']);
    const t = blocks[1];
    if (t.kind !== 'table') throw new Error('not a table');
    expect(t.header.map(text)).toEqual(['项', '团队', '普通']);
    expect(t.align).toEqual(['left', 'center', 'right']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].map((c) => c.some((n) => n.kind === 'citation'))).toEqual([false, true, false]);
    expect(t.rows[1].map(text)).toEqual(['反证', '4/4', '']); // padded to the header's width
  });
  it('a lone line with a pipe is not a table; the table ends at the first non-pipe line', () => {
    expect(parseMarkdown('a | b\n\nc').map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n正文').map((b) => b.kind)).toEqual(['table', 'paragraph']);
  });
  it('a table straight after a list or paragraph does not swallow them', () => {
    expect(parseMarkdown('- x\n- y\n\n| a | b |\n|---|---|\n| 1 | 2 |').map((b) => b.kind)).toEqual(['list', 'table']);
    expect(parseMarkdown('段落\n| a | b |\n|---|---|\n| 1 | 2 |').map((b) => b.kind)).toEqual(['paragraph', 'table']);
  });
  it('blockquotes: consecutive > lines become one block', () => {
    const b = parseMarkdown('> AI 起草，**待确认**\n> 第二行\n\n正文');
    expect(b.map((x) => x.kind)).toEqual(['blockquote', 'paragraph']);
  });
});

const cite = (name: string): [string, CitationDetail] => {
  const link = `[[${name}#^c1]]`;
  return [link, { link, ok: true, sourceName: name, sourcePath: `10_资料库/${name}.md`, blockId: 'c1', blockText: '「x」— 位置：p', quote: 'x', grade: 'B', gradedBy: 'AI', origin: '网络', publisher: 'P', url: null, published: null }];
};

describe('ReportViewer renders tables', () => {
  const md = '## Summary\n- a\n\n## 对照\n| 项 | 团队 | 普通 |\n|---|---|---|\n| 引用 | “原文”（B 级）[[资料甲#^c1]] | 24 处 |\n| 反证 | 4/4 | 无 |\n';
  const citations = Object.fromEntries([cite('资料甲')]);
  const out = html(createElement(ReportViewer, { markdown: md, citations, delivery: '已交付' }));

  it('a real <table>, header cells, body cells, citation chips inside cells', () => {
    expect(out).toContain('data-testid="report-table"');
    expect((out.match(/<th /g) ?? []).length).toBe(3);
    expect((out.match(/<td /g) ?? []).length).toBe(6);
    expect(out).toContain('24 处');
    expect(out).toContain('data-testid="citation-chip"');
    expect(out).not.toMatch(/\|\s*---/); // no raw pipes / delimiter row left on the page
  });
  it('citations inside table cells count as cited sources', () => {
    expect(uniqueCitedSources(md, citations).map((s) => s.sourceName)).toEqual(['资料甲']);
  });
});

describe('the real must-3 对照表 (S3 snapshot)', () => {
  const file = 'demo-vault/.snapshots/S3-C7-ws-a/20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/must-3 对照表.md';
  const body = stripFrontmatter(readFileSync(file, 'utf8'));
  it('parses into tables and blockquotes; no markdown table syntax reaches the page', () => {
    const blocks = parseMarkdown(body);
    const tables = blocks.filter((b) => b.kind === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const t of tables) if (t.kind === 'table') for (const row of t.rows) expect(row).toHaveLength(t.header.length);
    expect(blocks.some((b) => b.kind === 'blockquote')).toBe(true);
    const out = html(createElement(ReportViewer, { markdown: body, citations: {}, delivery: '已交付' }));
    expect((out.match(/data-testid="report-table"/g) ?? []).length).toBe(tables.length);
    expect(out).not.toMatch(/\|\s*:?-{3,}/);
    expect(out).not.toContain('&gt; AI 起草');
  });
});
