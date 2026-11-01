/** Follow-ups after the first M2 merge: chat survives a refresh, no repeated citations, the citation panel never covers the sources list. */
import type { UIMessage } from 'ai';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import type { Evidence } from '@/lib/research/evidence';
import { chatStorageKey, loadChat, saveChat } from '@/lib/research/chat-store';
import { citationOf, expandCitations } from '@/lib/research/report';

const fakeStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
};
const msg = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });

describe('grill chat survives a refresh', () => {
  it('round-trips the messages, per actor and per investigation', () => {
    const s = fakeStorage();
    const key = chatStorageKey('Junior A', '20_项目/P/WS-A/调查/R1');
    const chat = [msg('1', '我要做小调查'), { id: '2', role: 'assistant', parts: [{ type: 'tool-ask_user', toolCallId: 'c1', state: 'input-available', input: { question: '为什么？' } }] } as unknown as UIMessage];
    expect(saveChat(s, key, chat, 'ready')).toBe(true);
    expect(loadChat(s, key)).toEqual(chat); // the unanswered question card comes back as a question card
    expect(loadChat(s, chatStorageKey('Junior B', '20_项目/P/WS-A/调查/R1'))).toEqual([]);
    expect(loadChat(s, chatStorageKey('Junior A', '20_项目/P/WS-A/调查/R2'))).toEqual([]);
  });

  it('never wipes the saved chat with an empty list, never saves a half-streamed answer', () => {
    const s = fakeStorage();
    const key = 'k';
    saveChat(s, key, [msg('1', 'a')], 'ready');
    expect(saveChat(s, key, [], 'ready')).toBe(false);
    expect(saveChat(s, key, [msg('1', 'a'), msg('2', 'b')], 'streaming')).toBe(false);
    expect(loadChat(s, key)).toHaveLength(1);
  });

  it('missing, full or corrupt storage degrades to an empty chat', () => {
    expect(loadChat(undefined, 'k')).toEqual([]);
    const bad = fakeStorage();
    bad.raw.set('k', '{not json');
    expect(loadChat(bad, 'k')).toEqual([]);
    bad.raw.set('k', '{"a":1}');
    expect(loadChat(bad, 'k')).toEqual([]);
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(saveChat(full, 'k', [msg('1', 'a')], 'ready')).toBe(false);
  });
});

const ev = (n: number): Evidence => ({
  ref: `[[资料${n}#^c1]]`, path: `10_资料库/资料${n}.md`, block: 'c1', text: '「x」', quote: `第 ${n} 条原文内容`, sourceName: `资料${n}`, publisher: 'P', url: null,
  grade: 'B', origin: '知识库', gradedBy: 'AI', published: null, claimId: 'C1', subQuestionId: 'C1-Q1', round: 'kb', stance: 'supports', reason: '', core: false, partial: false,
});

describe('a sentence cites the same evidence once', () => {
  const keyed = new Map([['E1', ev(1)], ['E2', ev(2)]]);
  const n = (s: string, ref: string) => s.split(ref).length - 1;

  it('repeated [E1] in one field → one citation; other evidence is untouched', () => {
    const r = expandCitations('先打 IT 场景 [E1]，并且 [E1] 也说明这一点 [E2]；再看 [E1, E2][E1]。', keyed);
    expect(n(r.text, '[[资料1#^c1]]')).toBe(1);
    expect(n(r.text, '[[资料2#^c1]]')).toBe(1);
    expect(r.text).not.toMatch(/ {2,}/);
    expect(r.text).not.toMatch(/\[E\d/);
    expect(r.used.sort()).toEqual(['E1', 'E2']);
  });

  it('the same evidence in two different fields is still cited in both (each field stands alone)', () => {
    const a = expandCitations('A [E1]', keyed).text;
    const b = expandCitations('B [E1]', keyed).text;
    expect(a).toContain(citationOf(ev(1)));
    expect(b).toContain(citationOf(ev(1)));
  });
});

describe('citation panel placement', () => {
  const citations = { '[[资料1#^c1]]': { link: '[[资料1#^c1]]', ok: true, sourceName: '资料1', sourcePath: 'x', blockId: 'c1', blockText: '「x」', quote: 'x', grade: 'B' as const, gradedBy: 'AI' as const, origin: '知识库' as const, publisher: 'P', url: null, published: null } };
  const html = renderToString(createElement(ReportViewer, { markdown: '## Summary\n- a “x” [[资料1#^c1]]', citations, delivery: '已交付' }));
  it('stacked (narrow) layout docks the panel AFTER the text and the sources list, side-by-side only in a wide container', () => {
    const aside = /<aside class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(aside).toContain('order-last');
    expect(aside).toContain('sticky bottom-0');
    expect(aside).not.toContain('order-first');
    expect(aside).toContain('@3xl:order-none');
    expect(html).toContain('class="@container"');
    expect(html.indexOf('data-testid="report-sources"')).toBeLessThan(html.indexOf('<aside'));
  });
});

import { checkReportText, hasBareNumber } from '@/lib/research/selfcheck';

describe('identifiers are not data (self-check false positives)', () => {
  it.each([
    '先在 W3 做买方访谈，W6–W7 复盘',
    '按 W6-W7 的节奏，S1–S4 是加分项，M0 到 M5 是核心',
    '这是 Day-1 就要对齐的事，见 §9.5 和 §6.3.1',
    '参考 D-8 和 R4、G1、H1、P0',
    '第 3 周之前给出结论，第6步自检',
    'PRD v0.4 里写了：(1) 先查知识库 (2) 再联网',
    '2. 先对齐再动手',
  ])('not a number: %s', (line) => {
    expect(hasBareNumber(line)).toBe(false);
  });

  it.each(['渗透率达到 32%', '2026 年出货 1,200 万台', '预算约 300 万元', '增长了 3 倍', '占 70％ 的员工'])('still a number: %s', (line) => {
    expect(hasBareNumber(line)).toBe(true);
  });

  it('a report line naming W3 / §9.5 passes; one with a real uncited number still fails', () => {
    const rep = (line: string) =>
      `# R 调查报告 v1\n\n## Summary\n- So what：${line}\n\n## 怎么查的\n- x\n\n## 逐个假设\n### H1 x\n- 提议的判断：成立\n- 支持的证据：\n  - （无）\n- 反证：\n  - （无）\n- 推导（推断）：x\n\n## 对 workplan 的影响\n- 无\n`;
    expect(checkReportText(rep('W3 先做访谈，按 §9.5 判断，Day-1 对齐')).filter((f) => f.code === 'uncited_number')).toEqual([]);
    expect(checkReportText(rep('渗透率 32%')).filter((f) => f.code === 'uncited_number')).toHaveLength(1);
  });
});

describe('an evidence key the model made up never blocks the report', () => {
  const keyed = new Map([['E1', ev(1)], ['E2', ev(2)], ['E3', ev(3)]]);
  const hasKey = (t: string) => /(?<![A-Za-z0-9])E\d{1,3}(?![A-Za-z0-9])/.test(t.replace(/“[^”]*”/g, '').replace(/\[\[[^\]]*\]\]/g, ''));

  it.each([
    '见 [E59]',
    '见 [E1、E59]',
    '见 [E1, E2 等]',
    '见 [E1–E3]',
    '见【E2】和 [E59]',
    '证据 E1 表明，E59 也是',
  ])('expands what it can, removes what it cannot, leaves no key behind: %s', (text) => {
    const r = expandCitations(text, keyed);
    expect(hasKey(r.text)).toBe(false);
    expect(r.text).not.toMatch(/\[E\d/);
  });

  it('reports the unknown keys and expands a range', () => {
    const r = expandCitations('见 [E1–E3]，也见 [E59]', keyed);
    expect(r.used.sort()).toEqual(['E1', 'E2', 'E3']);
    expect(r.unknown).toEqual(['E59']);
  });

  it('a product name like "Microsoft 365 E5" is not mistaken for a key', () => {
    expect(expandCitations('Microsoft 365 E5 许可', keyed).text).toBe('Microsoft 365 E5 许可');
  });
});

import { PlanEditor } from '@/components/research/plan-editor';
import { workspaceNameOf } from '@/lib/research/folders';
import type { EditablePlan } from '@/lib/research/plan-types';

describe('approving starts the run, and the mode is chosen once, inside the approve dialog', () => {
  const plan: EditablePlan = { question: '问题', purpose: '目的', claims: [{ id: 'C1', statement: '论点', hypothesis: null, conditions: ['条件'], sub_questions: [{ id: 'C1-Q1', question: '问？', methods: ['知识库'] }], counter_search: '反证' }] };
  const props = { plan, planName: '计划 v1', approved: false, canEdit: true, onSave: async () => ({ ok: true as const, name: '计划 v2' }), onApprove: async () => ({ ok: true as const }) };
  const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

  it('the plan page has no mode control: the action bar is Save and 计划定了，开始调查 → (D-64 T36)', () => {
    const out = html(createElement(PlanEditor, props));
    expect(out).toContain('计划定了，开始调查 →');
    expect(out).not.toContain('data-testid="mode-picker"');
    expect(out).not.toContain('aria-label="调查模式"');
  });

  it('read-only viewers get no approve button', () => {
    expect(html(createElement(PlanEditor, { ...props, canEdit: false }))).not.toContain('计划定了，开始调查 →');
  });
});

describe('the research page shows the Workspace name, not its id', () => {
  it('workspaceNameOf', () => {
    expect(workspaceNameOf('20_项目/个人AI战略/WS-A 买方')).toBe('WS-A 买方');
  });
});

import { shortError } from '@/lib/research/run';
describe('error lines in the report stay short', () => {
  it('an API error body becomes one short phrase', () => {
    expect(shortError(new Error('/v1/tools/fetch failed: HTTP 404 {"error":{"message":"failed to fetch URL (request_id: 7)"}}'))).toBe('请求失败（HTTP 404）');
    expect(shortError(new Error('x'.repeat(500))).length).toBeLessThan(170);
  });
});

describe('a product name like "Microsoft 365 E3" in the prose is not a leaked key', () => {
  const rep = (line: string) => `# R 调查报告 v1\n\n## Summary\n- So what：${line}\n\n## 怎么查的\n- x\n\n## 逐个假设\n### H1 x\n- 提议的判断：成立\n- 支持的证据：\n  - （无）\n- 反证：\n  - （无）\n- 推导（推断）：x\n\n## 对 workplan 的影响\n- 无\n`;
  it('an edition name is never a key, even when this run issued that key; a bare key in prose is flagged only when it was issued', () => {
    const line = 'Microsoft 365 E3 许可是常见配置';
    const bare = (l: string, keys?: Set<string>) => checkReportText(rep(l), [], keys).filter((f) => f.code === 'bare_evidence_key' || f.code === 'unknown_evidence_key');
    expect(bare(line, new Set(['E1', 'E2']))).toEqual([]);
    expect(bare(line, new Set(['E3']))).toEqual([]); // 报告 v3: "E7 Frontier Suite" while the run had an E7
    expect(bare(line)).toEqual([]);
    expect(bare('证据见 E3，IT 主导', new Set(['E1']))).toEqual([]);
    expect(bare('证据见 E3，IT 主导', new Set(['E3'])).map((f) => f.code)).toEqual(['bare_evidence_key']);
  });
});

describe('the footer slot (M3 decision panel) sits alone in its own wrapper', () => {
  it('renders inside data-testid=report-footer, after the report body and the next-action row', () => {
    const out = renderToString(createElement(ReportViewer, { markdown: '## Summary\n- a', citations: {}, delivery: '已交付', footer: createElement('section', { 'data-testid': 'decision-panel' }, '决定 + 理由') }));
    expect(out).toContain('data-testid="report-footer"');
    expect(out.indexOf('data-testid="report-footer"')).toBeGreaterThan(out.indexOf('直接 fix 当前版本'));
    expect(out).toMatch(/data-testid="report-footer"[^>]*><section data-testid="decision-panel">/); // the only child of the wrapper
  });
  it('no footer, no wrapper', () => {
    expect(renderToString(createElement(ReportViewer, { markdown: '## Summary\n- a', citations: {}, delivery: '已交付' }))).not.toContain('report-footer');
  });
});

import { FollowUpForm } from '@/components/research/follow-up-dialog';
import { Dialog } from '@/components/ui/dialog';

describe('追加调查 button and dialog', () => {
  const md = '## Summary\n- a';
  const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
  it('the button is live only when the viewer is given a handler; the other next actions stay as entries', () => {
    const off = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付' }));
    expect(off).not.toContain('follow-up-open');
    const on = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', onFollowUp: () => {} }));
    expect(on).toContain('data-testid="follow-up-open"');
    expect(on).toMatch(/<button[^>]*data-testid="follow-up-open"[^>]*>追加调查/);
    expect(on).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="follow-up-open"/);
    for (const other of ['调整方向', '重新调查', '新建调查']) expect(on).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${other}`));
  });
  it('the dialog offers every claim by its report label, a focus box, and says it builds on the latest report', () => {
    const out = html(
      createElement(Dialog, { open: true }, createElement(FollowUpForm, {
        onCancel: () => {},
        baseReport: '报告 v2',
        claims: [
          { id: 'C1', label: 'H1', statement: 'IT 决定采购' },
          { id: 'C2', label: 'H2', statement: '预算在软件' },
        ],
        onSubmit: () => {},
      })),
    );
    for (const t of ['追加调查', 'H1', 'IT 决定采购', 'H2', '预算在软件', '报告 v2', '新的子问题', '开始追加调查', '专家的反面意见：管得太死会不会让员工绕开 IT']) expect(out).toContain(t);
  });
});
