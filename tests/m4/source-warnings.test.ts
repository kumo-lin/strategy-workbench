/** source_warnings: a cited source found wrong after the report was written is flagged on the page; the file stays. */
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { reportSchema } from '@/lib/notes/schema';
import { readSourceWarnings } from '@/lib/report/source-warnings';
import { createVault } from '@/lib/vault';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const count = (s: string, needle: string) => s.split(needle).length - 1;

const WARNING = {
  footnotes: ['36', '6', '35'],
  source: '[[人工智能在金融领域的2025年法规解读与风险管理可行性分析报告.docx - 建立供应商“准入-监控-退出”全流程管控]]',
  problem: '这份 .docx 是文库网站上用户上传的文件，它引用的《金融机构人工智能风险管理指引（试行）》查不到。',
  action: '这三处引用不作为证据；结论不依赖它们。',
  found_by: 'Senior',
  found_on: '2026-10-25',
};

const S3 = path.resolve('demo-vault/.snapshots/S3-C7-ws-a');
const WS = '20_项目/个人AI战略/WS-A 买方';
const DIR = `${WS}/调查/买方采购逻辑`;

describe('reportSchema.source_warnings', () => {
  it('an old report without the field still parses; with it, each item is checked', async () => {
    const v3 = (await createVault(S3).read(`${DIR}/报告 v3.md`)).data;
    const { source_warnings: _, ...plain } = v3 as Record<string, unknown>;
    expect(reportSchema.safeParse(plain).success).toBe(true);
    expect(reportSchema.safeParse({ ...plain, source_warnings: [WARNING] }).success).toBe(true);
    expect(reportSchema.safeParse({ ...plain, source_warnings: [{ ...WARNING, problem: '' }] }).success).toBe(false);
    expect(reportSchema.safeParse({ ...plain, source_warnings: [{ ...WARNING, footnotes: [] }] }).success).toBe(false);
    expect(reportSchema.safeParse({ ...plain, source_warnings: [{ ...WARNING, found_on: '昨天' }] }).success).toBe(false);
  });

  it('readSourceWarnings keeps the items that match and drops the rest', () => {
    expect(readSourceWarnings({})).toEqual([]);
    expect(readSourceWarnings({ source_warnings: 'x' })).toEqual([]);
    expect(readSourceWarnings({ source_warnings: [{ footnotes: ['1'] }, WARNING] })).toEqual([WARNING]);
  });
});

describe('the team report (ReportViewer)', () => {
  const md = [
    '# 买方采购逻辑 调查报告 v3',
    '',
    '## Summary',
    '- 选型权在 IT[^1]，监管要求设委员会[^36]。',
    '',
    '## 逐个假设',
    '- 白名单制度[^6]；治理委员会[^35]；还有[^1]。',
    '',
    '[^1]: “a”[[资料 A#^c1]]',
    '[^6]: “b”[[资料 B#^c6]]',
    '[^35]: “c”[[资料 B#^c5]]',
    '[^36]: “d”[[资料 B#^c3]]',
  ].join('\n');

  it('puts the 来源警告 box above Summary and flags exactly the footnotes it names', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', sourceWarnings: [WARNING] }));
    expect(count(out, 'data-testid="source-warnings"')).toBe(1);
    expect(count(out, 'data-testid="source-warning"')).toBe(1);
    expect(out).toContain(WARNING.problem);
    expect(out).toContain(WARNING.action);
    expect(out.indexOf('data-testid="source-warnings"')).toBeLessThan(out.indexOf('Summary'));
    // [^36], [^6], [^35] in the text: one tag each; the two [^1] stay clean
    expect(count(out, 'data-testid="source-warning-tag"')).toBe(3);
    expect(out).toMatch(/\[36\]<\/button><span data-testid="source-warning-tag"[^>]*>⚠ 来源有问题<\/span>/);
    expect(out).not.toMatch(/\[1\]<\/button><span data-testid="source-warning-tag"/);
  });

  it('a report without the field shows neither box nor tag', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付' }));
    expect(out).not.toContain('source-warning');
  });
});
