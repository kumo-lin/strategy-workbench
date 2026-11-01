/** Render gate for the research UI (server-side render to a string: no DOM needed). */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { uniqueCitedSources } from '@/components/research/citation-utils';
import type { CitationDetail } from '@/lib/research/citation-types';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const cite = (name: string, block: string, over: Partial<CitationDetail> = {}): [string, CitationDetail] => {
  const link = `[[${name}#^${block}]]`;
  return [
    link,
    { link, ok: true, sourceName: name, sourcePath: `10_资料库/${name}.md`, blockId: block, blockText: '「某句原文。」— 位置：p.1', quote: '某句原文', grade: 'B', gradedBy: 'AI', origin: '网络', publisher: '研究机构', url: 'https://example.com/a', published: '2026-09-01', ...over },
  ];
};

describe('ReportViewer + citation helpers', () => {
  const md = [
    '# R 调查报告 v1',
    '## Summary',
    '- So what：先打 IT 管理场景 “某句原文”（B 级，网络 · AI 定级）[[资料甲#^c1]]',
    '## 逐个假设',
    '### H1 x',
    '- 支持的证据：',
    '  - a “某句原文”（B 级，网络 · AI 定级）[[资料甲#^c2]] 和 “某句原文”（A 级，知识库）[[资料乙#^c1]]',
  ].join('\n');
  const citations = Object.fromEntries([cite('资料甲', 'c1'), cite('资料甲', 'c2'), cite('资料乙', 'c1', { grade: 'A', origin: '知识库', url: null })]);

  it('uniqueCitedSources: one row per source, in first-cited order, with counts and best info', () => {
    const rows = uniqueCitedSources(md, citations);
    expect(rows.map((r) => r.sourceName)).toEqual(['资料甲', '资料乙']);
    expect(rows[0]).toMatchObject({ grade: 'B', count: 2, url: 'https://example.com/a' });
    expect(rows[1]).toMatchObject({ grade: 'A', count: 1, url: null });
  });

  it('renders Summary first, chips with grade, the sources list, and the disabled next-action buttons', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations, delivery: '已交付', exploratory: true }));
    expect(out.indexOf('Summary')).toBeLessThan(out.indexOf('逐个假设'));
    expect(count(out, /data-testid="citation-chip"/g)).toBe(3);
    expect(out).toContain('data-testid="report-sources"');
    expect(out).toContain('资料甲');
    expect(out).toContain('资料乙');
    for (const b of ['追加调查', '调整方向', '重新调查', '新建调查', '直接 fix 当前版本']) expect(out).toContain(b);
    expect(out).toContain('探索性');
  });

  it('a draft report shows why it was not delivered', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations, delivery: '草稿', failedChecks: ['这一行有数字但没有出处：x'] }));
    expect(out).toContain('草稿');
    expect(out).toContain('这一行有数字但没有出处：x');
  });
});


describe('ReportViewer: D-20 reports (footnotes)', () => {
  const md = [
    '# R 调查报告 v1',
    '## Summary',
    '- 一句话答案：可管理性是门槛[^1]',
    '## 逐个假设',
    '### H1 x',
    '- 支持的证据：',
    '',
    '| 论断 | 关键数字 | 等级 | 出处 |',
    '|---|---|---|---|',
    '| CIO 把安全列为最大障碍 | 77% | B | [^1] |',
    '',
    '## 引文出处',
    '[^1]: “某句原文”（B 级，网络 · AI 定级）[[资料甲#^c1]]',
  ].join('\n');
  const citations = Object.fromEntries([cite('资料甲', 'c1')]);

  it('markers render as footnote buttons with the quote on hover; the definition keeps its citation chip', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations, delivery: '已交付', exploratory: false }));
    expect(count(out, /data-testid="footnote-ref"/g)).toBe(2);
    expect(out).toMatch(/title="“某句原文”（B 级，网络 · AI 定级） — 资料甲"/);
    expect(count(out, /data-testid="footnote-def"/g)).toBe(1);
    expect(out).toContain('id="fn-1"');
    expect(count(out, /data-testid="citation-chip"/g)).toBe(1);
  });

  it('an old report (inline citations, no footnotes) still renders its chips', () => {
    const old = '# R\n## Summary\n- So what：x “某句原文”（B 级，网络 · AI 定级）[[资料甲#^c1]]\n';
    const out = html(createElement(ReportViewer, { markdown: old, citations, delivery: '已交付', exploratory: false }));
    expect(count(out, /data-testid="citation-chip"/g)).toBe(1);
    expect(out).not.toContain('footnote-ref');
  });
});

describe('a footnote that cites a simulated interview is marked （模拟） on screen (the report file is not changed)', () => {
  const md = [
    '# R 调查报告 v1',
    '## Summary',
    '- 一句话答案：可管理性是门槛[^1]，但管得太死员工会绕开[^2]',
    '## 引文出处',
    '[^1]: “某句原文”（B 级，网络 · AI 定级）[[资料甲#^c1]]',
    '[^2]: “管得太死，员工会绕过去。”（专家意见，模拟访谈 · 不计入 A/B 级来源）[[访谈（模拟）#^e5]]',
  ].join('\n');
  const interview = (simulated: boolean) =>
    cite('访谈（模拟）', 'e5', { origin: '专家访谈', grade: null, gradedBy: null, simulated, publisher: '专家访谈（模拟）', url: null });

  it('report viewer: the interview marker gets the tag, the source marker does not; hover still shows the quote and 模拟访谈', () => {
    const citations = Object.fromEntries([cite('资料甲', 'c1'), interview(true)]);
    const out = html(createElement(ReportViewer, { markdown: md, citations, delivery: '已交付', exploratory: false }));
    expect(count(out, /data-testid="simulated-tag"/g)).toBe(1);
    expect(out).toMatch(/\[2\]<\/button><span data-testid="simulated-tag"[^>]*>（模拟）<\/span>/);
    expect(out).toMatch(/title="“管得太死，员工会绕过去。”（专家意见，模拟访谈 · 不计入 A\/B 级来源） — 访谈（模拟）"/);
  });

  it('a real (not simulated) interview, or an unknown citation, gets no tag', () => {
    const real = html(createElement(ReportViewer, { markdown: md, citations: Object.fromEntries([cite('资料甲', 'c1'), interview(false)]), delivery: '已交付', exploratory: false }));
    expect(real).not.toContain('simulated-tag');
    const none = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', exploratory: false }));
    expect(none).not.toContain('simulated-tag');
  });

  it('the frozen S3 v3: every marker whose footnote cites the simulated interview is tagged, the file is untouched', async () => {
    const { readFile } = await import('node:fs/promises');
    const { createVault } = await import('@/lib/vault');
    const { resolveReportCitations } = await import('@/lib/research/citations');
    const vault = createVault('demo-vault/.snapshots/S3-C7-ws-a');
    const p = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/报告 v3.md';
    const before = await readFile(`demo-vault/.snapshots/S3-C7-ws-a/${p}`, 'utf8');
    const note = await vault.read(p);
    const citations = await resolveReportCitations(vault, note.body, p);
    const ids = new Set([...note.body.matchAll(/^\[\^(\d+)\]: .*访谈（模拟）#\^e\d+\]\]$/gm)].map((m) => m[1]));
    expect(ids.size).toBeGreaterThan(0);
    const markers = [...note.body.split('## 引文出处')[0].matchAll(/\[\^(\d+)\](?!:)/g)].filter((m) => ids.has(m[1])).length;
    const out = html(createElement(ReportViewer, { markdown: note.body, citations, delivery: '已交付', exploratory: false }));
    expect(count(out, /data-testid="simulated-tag"/g)).toBe(markers);
    expect(await readFile(`demo-vault/.snapshots/S3-C7-ws-a/${p}`, 'utf8')).toBe(before);
  });
});
