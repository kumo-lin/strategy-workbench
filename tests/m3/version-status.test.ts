/**
 * An unconfirmed delivered version in the older structure says what it is (lib/research/version-status.ts): S3's
 * WS-A 报告 v4 ("未经用户确认": v2 of the same investigation was confirmed) and W5 报告 v1 ("未经用户判断": nothing there
 * was), "已被新结构的版本取代" once a later question-tree version exists. Versions that are drafts, confirmed, or the
 * 对照表's pinned version keep their labels. Fixture: a temp vault shaped like S3 (no demo content).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isConfirmed, isTreeReport, versionStatusLabels, type VersionInfo } from '@/lib/research/version-status';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const OLD = '# x 调查报告\n\n## Summary\n- 一句话答案：…\n\n## 逐个假设\n\n### H1 …\n';
const TREE = '# x 调查报告\n\n## Summary\n- 核心问题：…\n\n## Q1 谁决定？\n\n### 假设 H1：…\n';
const v = (n: number, data: Record<string, unknown>, body = OLD): VersionInfo => ({ path: `d/报告 v${n}.md`, n, data: { delivery: '已交付', ...data }, body });

describe('versionStatusLabels', () => {
  const wsA = [v(1, { delivery: '草稿' }), v(2, { content_confirmed_by: '用户（Senior 角色）', content_confirmed_at: '2026-10-25' }), v(3, {}), v(4, { human_edits: [{ kind: '错别字' }] })];

  it('S3 WS-A: v4 is "旧结构版本，未经用户确认"; v1 (a draft), v2 (confirmed) and v3 (the pinned version) keep their labels', () => {
    expect([...versionStatusLabels(wsA, 'd/报告 v3.md')]).toEqual([['d/报告 v4.md', '旧结构版本，未经用户确认']]);
  });

  it('a later question-tree version: "…，已被新结构的版本取代"', () => {
    const labels = versionStatusLabels([...wsA, v(5, { report_format: 'question_tree' }, TREE)], 'd/报告 v3.md');
    expect(labels.get('d/报告 v4.md')).toBe('旧结构版本，未经用户确认，已被新结构的版本取代');
    expect(labels.has('d/报告 v5.md')).toBe(false); // the new one is not old-structure
    expect(labels.has('d/报告 v3.md')).toBe(false);
  });

  it('S3 W5: v1, nothing in the investigation confirmed and no 对照表: "旧结构版本，未经用户判断"', () => {
    expect([...versionStatusLabels([v(1, {})], null)]).toEqual([['d/报告 v1.md', '旧结构版本，未经用户判断']]);
  });

  it('what counts as a question tree, and as confirmed', () => {
    expect(isTreeReport({ data: { report_format: 'question_tree' }, body: OLD })).toBe(true);
    expect(isTreeReport({ data: {}, body: TREE })).toBe(true);
    expect(isTreeReport({ data: {}, body: OLD })).toBe(false);
    expect(isConfirmed({ content_confirmed_by: '用户' })).toBe(true);
    expect(isConfirmed({ content_confirmation: '一句话答案……' })).toBe(false); // the note of what was confirmed is not the confirmation
    expect(isConfirmed({ content_confirmed_by: null })).toBe(false);
  });
});

describe('where it shows', () => {

  it('the report page: a note at the top, the file unchanged', async () => {
    const { ReportViewer } = await import('@/components/research/report-viewer');
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(createElement(ReportViewer, { markdown: OLD, citations: {}, statusNote: '旧结构版本，未经用户确认' })).replace(/<!-- -->/g, '');
    expect(html).toContain('data-testid="version-status-note"');
    expect(html).toContain('这一版是旧结构版本，未经用户确认：不要把它当成确认过的最新结论。');
    expect(renderToString(createElement(ReportViewer, { markdown: OLD, citations: {} }))).not.toContain('version-status-note');
  });
});
