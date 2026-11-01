/** Wave 1 of the UI/UX rework (display only): what the pages say. Server-side render to a string, no DOM needed. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { ReadOnlyNotice } from '@/components/shell/readonly-notice';
import { roleJob, roleStyle } from '@/components/shell/role-style';
import { MODE_NAME, MODE_TIME, modeFacts } from '@/lib/research/mode-copy';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

describe('the two investigation modes are explained in one place', () => {
  it('names and measured times (5 acceptance runs took 176–207 s)', () => {
    expect(MODE_NAME).toEqual({ small: '试水调查', full: '完整调查' });
    expect(MODE_TIME.small).toBe('约 3–4 分钟');
  });
  it('each option says what is searched, and when to use it; the 试水调查 says it is a real report', () => {
    const small = modeFacts('small', 'H1');
    expect(small.scope).toContain('H1');
    expect(small.when).toContain('正式的报告版本');
    expect(modeFacts('full', 'H1').web).toContain('30');
  });
});

describe('read-only places say the same five things', () => {
  it('cannot / who / why / can / where, in that order', () => {
    const out = html(createElement(ReadOnlyNotice, { cannot: '只读：x', who: 'W', can: 'C', where: 'D' }));
    const at = ['只读：x', '谁能做：', '为什么：', '你能做什么：', '去哪做：'].map((t) => out.indexOf(t));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(out).toContain('不是提示词');
  });
});

describe('roles are told apart by colour and job title', () => {
  it('one colour per role, a fallback for others', () => {
    expect(new Set(['senior', 'junior-a', 'junior-b'].map((r) => roleStyle(r).band)).size).toBe(3);
    expect(roleStyle('someone-else').band).toBeTruthy();
    expect(roleJob('senior')).toBe('审批者');
    expect(roleJob('junior')).toBe('执行者');
  });
});

describe('the report says how far the run went', () => {
  const props = { markdown: '# R\n## Summary\n- So what：x', citations: {}, delivery: '已交付' as const };
  it('a 试水调查 answered only some hypotheses', () => {
    const out = html(createElement(ReportViewer, { ...props, scope: { mode: 'small', hypotheses: ['H1'] } }));
    expect(out).toContain('试水调查 · 只回答了 H1，其余本次没有查');
  });
  it('a full run says so; no scope, no badge; the decision shortcut sits at the top', () => {
    expect(html(createElement(ReportViewer, { ...props, scope: { mode: 'full', hypotheses: [] } }))).toContain('完整调查 · 回答了全部假设');
    expect(html(createElement(ReportViewer, props))).not.toContain('report-scope');
    expect(html(createElement(ReportViewer, { ...props, decisionTop: createElement('span', null, '决定由 Senior 确认') }))).toContain('决定由 Senior 确认');
  });
});
