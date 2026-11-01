/**
 * review_notes (人工核对注): what a person found checking a report by hand — a footnote that cites the wrong document,
 * two passages that disagree. Shown like source_warnings: a box above Summary, "⚠ 见核对注" beside the footnotes it
 * names; a note without footnotes at the top of the section its `where` names (above Summary when none matches).
 * Display only. On the real WS-A 报告 v4 (tests/fixtures/ws-a-tree-versions, copied as it is from C's S3 copy) with
 * test notes — the real ones are written later, by C, after the user replies.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { reportSchema } from '@/lib/notes/schema';
import { headingFor, notedFootnotes, placeReviewNotes, readReviewNotes, type ReportReviewNote } from '@/lib/report/review-notes';

const V4 = readFileSync('tests/fixtures/ws-a-tree-versions/报告 v4.md', 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const html = (notes?: ReportReviewNote[]) => renderToString(createElement(ReportViewer, { markdown: V4, citations: {}, delivery: '已交付', reviewNotes: notes })).replace(/<!-- -->/g, '');
const count = (s: string, sub: string) => s.split(sub).length - 1;

const ON_FOOTNOTE: ReportReviewNote = { footnotes: ['30'], where: 'Q3 的回答', note: '测试注：这个脚注挂的是另一份文件', found_by: '测试', found_on: '2026-10-26' };
const ON_PASSAGE: ReportReviewNote = { where: 'Q3 的回答', note: '测试注：这里和上文说法不一致', found_by: '测试', found_on: '2026-10-26' };
const NOWHERE: ReportReviewNote = { footnotes: [], where: '推荐判断 · 量级', note: '测试注：没有对应的小节标题', found_by: '测试', found_on: '2026-10-26' };

describe('the field', () => {
  const base = { id: 'r', type: 'report', status: '进行中', created: '2026-10-26', updated: '2026-10-26', author: 'AI', derived_from: [], relates_to: [], version: 4, research_plan: null, mode: 'team', exploratory: false };

  it('optional: an older report without it parses as before; one with it parses too', () => {
    expect(reportSchema.safeParse(base).success).toBe(true);
    expect(reportSchema.safeParse({ ...base, review_notes: [ON_FOOTNOTE, ON_PASSAGE, NOWHERE] }).success).toBe(true);
    expect(reportSchema.safeParse({ ...base, review_notes: [{ note: '' }] }).success).toBe(false);
  });

  it('read for display: items that do not match are left out; no field, none', () => {
    expect(readReviewNotes({})).toEqual([]);
    expect(readReviewNotes({ review_notes: 'x' })).toEqual([]);
    expect(readReviewNotes({ review_notes: [ON_PASSAGE, { note: '缺了 found_by', found_on: '2026-10-26' }, { ...ON_FOOTNOTE, found_on: '10/26' }] })).toEqual([ON_PASSAGE]);
    expect([...notedFootnotes([ON_FOOTNOTE, ON_PASSAGE, NOWHERE])]).toEqual([['30', '测试注：这个脚注挂的是另一份文件']]);
  });
});

describe('where a note without footnotes goes', () => {
  const headings = ['Summary', '怎么查的', 'Q1 员工端侧个人 AI 的采购决策权……', '假设 H1：……', 'Q2 按什么放行、按什么选？', 'Q2-1 「可管」是不是放行的门槛', '假设 H2-1：可管理三层……', 'Q3 钱从哪里出、在什么条件下批？', 'Q3 的回答'];

  it('the heading `where` names, most specific part first; a label names its own heading, not a longer one', () => {
    expect(headingFor('Q3 的回答', headings)).toBe(8);
    expect(headingFor('Q3', headings)).toBe(7);
    expect(headingFor('Q2 · Q2-1', headings)).toBe(5);
    expect(headingFor('假设 H2-1', headings)).toBe(6);
    expect(headingFor('Q2', headings)).toBe(4); // not "Q2-1 …"
    expect(headingFor('Summary', headings)).toBe(0);
    expect(headingFor('推荐判断 · 量级', headings)).toBeNull();
    expect(headingFor(undefined, headings)).toBeNull();
  });

  it('a note with footnotes stays in the box on top; one whose `where` names nothing too', () => {
    const { top, at } = placeReviewNotes([ON_FOOTNOTE, ON_PASSAGE, NOWHERE], headings);
    expect(top).toEqual([ON_FOOTNOTE, NOWHERE]);
    expect([...at]).toEqual([[8, [ON_PASSAGE]]]);
  });
});

describe('the report page (report-viewer), on the real v4', () => {
  it('no notes: nothing new on the page', () => {
    expect(html()).not.toMatch(/review-note/);
  });

  it('"人工核对注" above Summary with the footnote note; "⚠ 见核对注" beside every [30]; not beside the others', () => {
    const h = html([ON_FOOTNOTE]);
    expect(h).toContain('data-testid="review-notes"');
    expect(h).toContain('人工核对注：有人核对这份报告时发现的问题');
    expect(h).toContain('脚注 [30] · Q3 的回答');
    expect(h).toContain('测试注：这个脚注挂的是另一份文件');
    const refs = [...V4.matchAll(/\[\^30\](?!:)/g)].length;
    expect(refs).toBeGreaterThan(0);
    expect(count(h, 'data-testid="review-note-tag"')).toBe(refs);
    expect(h.indexOf('data-testid="review-notes"')).toBeLessThan(h.indexOf('>Summary<'));
  });

  it('a note on a passage: at the top of "Q3 的回答" (under its heading, before the next one); the box on top points to it', () => {
    const h = html([ON_PASSAGE]);
    const box = h.indexOf('data-testid="review-notes-section"');
    expect(box).toBeGreaterThan(h.indexOf('>Q3 的回答<'));
    expect(box).toBeLessThan(h.indexOf('>对 workplan 的影响<'));
    expect(h).toContain('另有 1 条写在对应小节的顶部：Q3 的回答。');
    expect(count(h, 'data-testid="review-note-tag"')).toBe(0);
  });

  it('a passage that has no heading: in the box above Summary, with where it is about', () => {
    const h = html([NOWHERE]);
    expect(h).not.toContain('review-notes-section');
    expect(h).toContain('推荐判断 · 量级');
    expect(h).toContain('测试注：没有对应的小节标题');
  });

  it('the report text is unchanged: the same sentences either way', () => {
    const text = (s: string) => s.replace(/<section role="note"[\s\S]*?<\/section>/g, '').replace(/<span data-testid="review-note-tag"[^>]*>[^<]*<\/span>/g, '');
    expect(text(html([ON_FOOTNOTE, ON_PASSAGE, NOWHERE]))).toBe(text(html()));
  });
});
