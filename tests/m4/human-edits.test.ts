/** D-24: a person's typo fixes on a system report are said, with before/after, wherever the report is named. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HumanEditsNote } from '@/components/research/human-edits-note';
import { ReportViewer } from '@/components/research/report-viewer';
import { humanEditsLine, readHumanEdits } from '@/lib/report/human-edits';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const RAW = [
  { kind: '错别字', where: 'Summary · 结论', before: '采构', after: '采购', date: '2026-10-25', basis: 'D-24', content_changed: false },
  { kind: '错别字', where: 'H3 · 推导', before: '预箅', after: '预算', date: '2026-10-25', basis: 'D-24', content_changed: false },
];
const EDITS = readHumanEdits({ human_edits: RAW });

describe('readHumanEdits / humanEditsLine', () => {
  it('counts the recorded edits; no field, or nothing usable in it, means nothing to say', () => {
    expect(EDITS[0]).toEqual({ kind: '错别字', where: 'Summary · 结论', before: '采构', after: '采购', contentChanged: false });
    expect(humanEditsLine(EDITS)).toBe('人工修正 2 处错别字，内容未改');
    expect(readHumanEdits({})).toEqual([]);
    expect(readHumanEdits({ human_edits: 'x' })).toEqual([]);
    expect(readHumanEdits({ human_edits: [{ kind: '错别字', before: 'a' }, null, ...RAW] })).toEqual(EDITS);
    expect(humanEditsLine([])).toBeNull();
  });

  it('says so when any edit changed content (or does not say it did not)', () => {
    expect(humanEditsLine(readHumanEdits({ human_edits: [RAW[0], { ...RAW[1], content_changed: true }] }))).toBe('人工修正 2 处（含内容改动）');
    expect(humanEditsLine(readHumanEdits({ human_edits: [{ before: 'a', after: 'b' }] }))).toBe('人工修正 1 处（含内容改动）');
  });
});

describe('HumanEditsNote and the report page', () => {
  it('shows the line with every before/after (hover title and the opened list)', () => {
    const out = html(createElement(HumanEditsNote, { edits: EDITS }));
    expect(out).toContain('人工修正 2 处错别字，内容未改');
    expect(out).toContain('Summary · 结论：“采构” → “采购”');
    expect(out).toContain('H3 · 推导：');
    expect(out).toMatch(/改前 <span[^>]*>“预箅”<\/span> → 改后 <span[^>]*>“预算”<\/span>/);
    expect(html(createElement(HumanEditsNote, { edits: [] }))).toBe('');
  });

  it('ReportViewer puts it beside the report title only when the report has edits', () => {
    const md = '# 买方采购逻辑 调查报告 v3\n\n## Summary\n- 结论\n';
    expect(html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', humanEdits: EDITS }))).toContain('人工修正 2 处错别字，内容未改');
    const none = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付' }));
    expect(none).not.toContain('人工修正');
    expect(none).not.toContain('human-edits');
  });
});
