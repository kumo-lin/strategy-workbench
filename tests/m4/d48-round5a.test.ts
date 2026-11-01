/**
 * D-48 round 5 A and B (M4): the recommendation and the one-line answer point at a condition in its card —
 * "（见 Q2-1 ②）" — instead of carrying its footnotes; a number there that no [E#] covers is marked; the page links
 * the pointer to that ①②③ line, shows M3's [Qx] tags faint, marks summary_flags. And M1 验收 3: a length flag whose
 * sentence has [Q1②] in it is found; the one-line answer ends with "。" before code's brackets.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { readSummaryFlags, summaryFlagTitle } from '@/lib/report/citation-flags';
import { sentenceEnds } from '@/lib/report/sentence-place';
import type { CheckedCondition } from '@/lib/research/judge';
import { numbersNeedingEvidence } from '@/lib/research/number-check';
import { expandConditionRefs } from '@/lib/research/report';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

// WS-A v8: Q2-1 ② (不成立), whose keys E7 / E8 became [^7][^8] after "可管理只在受监管行业构成准入要求"
const V8 = JSON.parse(readFileSync('tests/fixtures/d48/WS-A 报告 v8.judgment.json', 'utf8')) as { claims: { label: string; conditions: CheckedCondition[] }[] };
const H21 = V8.claims.find((c) => c.label === 'H2-1')!;
const conds = new Map(H21.conditions.map((c) => [`Q2-1${c.label}`, c]));

describe('A: the recommendation points at the condition', () => {
  it('WS-A v8: "…构成准入要求（见 Q2-1 ②）", none of that condition\'s footnotes; a 证据不足 one says 待验证', () => {
    const t = expandConditionRefs('可管理只在受监管行业构成准入要求 [Q2-1②]', conds, undefined, { asLink: true });
    expect(t).toBe('可管理只在受监管行业构成准入要求（见 Q2-1 ②）');
    expect(t).not.toMatch(/\[E\d+\]/);
    expect(expandConditionRefs('员工端 AI 要 IT 登记 [Q2-1①]', conds, undefined, { asLink: true })).toBe('员工端 AI 要 IT 登记（见 Q2-1 ①，待验证）');
    // the cards and the sub-questions' answers still carry the condition's own footnotes
    expect(expandConditionRefs('x [Q2-1②]', conds)).toMatch(/\[E\d+\]/);
  });

  it('a number in a clause no [E#] covers is marked, where and which; one covered, a target row and an estimated 量级 are not', () => {
    const body = [
      '## Summary',
      '- AI 的推荐判断（待你拍板）：下面全部是 AI 的提议，状态只有人能改。',
      '',
      '| | 提议 |',
      '|---|---|',
      '| 对决策的回答 | 押管理栈，可管理只在受监管行业构成准入要求（见 Q2-1 ②）<br>依据：份额 24.2%[^5]，60% 的 CIO 要可管（见 Q1 ①） |',
      '| 量级 | 先在 20–50 家试点。怎么估的（推断）：按 12 个月续约周期 |',
      '| 看什么指标 | 6 个月内 3 家签约 |',
      '',
      '## 怎么查的',
      '- 联网搜索 24 次',
    ].join('\n');
    expect(numbersNeedingEvidence(body)).toEqual([{ where: '对决策的回答', sentence: '60% 的 CIO 要可管（见 Q1 ①）', numbers: ['60%'] }]);
  });
});

describe('the page', () => {
  const md = [
    '## Summary',
    '- 回答（一句话）：付钱的是软件席位 [Q3-1]，硬件不单列价（见 Q2-1 ②）。（由 Q2、Q3 的回答组装而成）',
    '- AI 的推荐判断（待你拍板）：下面全部是 AI 的提议，状态只有人能改。',
    '',
    '| | 提议 |',
    '|---|---|',
    '| 对决策的回答 | 押管理栈<br>依据：60% 的 CIO 要可管（见 Q2-1 ②） |',
    '',
    '## Q2 按什么放行',
    '',
    '#### 假设 H2-1：IT 管准入',
    '- 当时的假设，逐条对照：',
    '  - ① 员工端 AI 要 IT 登记 → 证据不足：只有一条[^1]',
    '  - ② 受监管行业要准入 → 不成立：只在受监管行业[^2]',
    '',
    '## 引文出处',
    '',
    '[^1]: “a”（B，x）',
    '[^2]: “b”（A，y）',
  ].join('\n');

  it('"（见 Q2-1 ②）" links to that line of the card; [Q3-1] faint; the number with no evidence marked', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付' }));
    expect(out).toContain('id="cond-Q2-1-②"');
    expect(out.match(/data-testid="condition-link" href="#cond-Q2-1-②"/g)).toHaveLength(2);
    expect(out).toMatch(/data-testid="question-tag"[^>]*>（Q3-1）</);
    expect(out).not.toContain('[Q3-1]');
    expect(out.match(/data-testid="number-evidence-tag"/g)).toHaveLength(1);
    expect(out).toContain('title="这一句的 60% 没有挂证据脚注（“见 Qx”只指向卡片，不算出处）"');
  });

  it('summary_flags: ⚠ beside that clause, found with its [Qx] and "（见 Qx）" taken out; the hover says why', () => {
    const summaryFlags = readSummaryFlags({ summary_flags: [{ sentence: '付钱的是软件席位 [Q3-1]', q: 'Q3-1', kind: 'tone' }, { sentence: '没有的一句', q: '', kind: 'nope' }] });
    expect(summaryFlags.map((f) => f.kind)).toEqual(['tone', 'untagged']);
    expect(summaryFlagTitle(summaryFlags[0])).toBe('语气和 Q3-1 的回答不一致');
    expect(summaryFlagTitle({ sentence: 's', q: 'Q2', kind: 'direction' })).toBe('方向可能和 Q2 的回答相反');
    const out = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', summaryFlags }));
    expect(out.match(/data-testid="summary-warning-tag"/g)).toHaveLength(1);
    expect(out).toContain('title="语气和 Q3-1 的回答不一致"');
    expect(out.indexOf('summary-warning-tag')).toBeLessThan(out.indexOf('硬件不单列价'));
  });
});

describe('M1 验收 3', () => {
  it('a length flag written with [Q1②] / [Q1 ②] finds its sentence, rendered with footnotes and "（见 Q1 ②，待验证）"', () => {
    const parts = [{ text: '若 IT 管控只是现实压力，推荐改成只做准入包' }, { footnote: '4' }, { text: '（见 Q1 ②，待验证）；若预算集中' }];
    expect(sentenceEnds(parts, [{ sentence: '若 IT 管控只是现实压力，推荐改成只做准入包 [Q1②]。', flag: 1 }, { sentence: '若 IT 管控只是现实压力 [Q1 ②]', flag: 2 }])).toEqual([
      { part: 0, offset: 23, flag: 1 },
      { part: 0, offset: 13, flag: 2 },
    ]);
  });
});
