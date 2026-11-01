/** D-64 T41 (ui-4e): the Senior's confirm step — the report's summary on the left, the decision as three fields on the right. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecisionPanel, type DecisionCardData } from '@/components/decision/decision-panel';
import { citationsOf, fromFieldText, toFieldText } from '@/components/decision/format';
import { ConfirmStep } from '@/components/research/confirm-step';
import { decisionFields, withFields } from '@/lib/decisions/fields';
import { loadInbox } from '@/lib/inbox';
import { confirmSummaryOf } from '@/lib/research/confirm-summary';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/x' }));

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const REPORT_MD = ['# M1 调查报告 v1', '', '## So what', '', '用的人多，天天用的人少[^1]。', '', '## 为什么（三条支撑）', '', '1. 用的人多，天天用的人少', '   - 事实：每天用的只有 24%[^1]', '2. Qira 布局到位，价值未证明', '   - 推断：只证明供给', '3. 用户要帮忙，不要失控', '', '## 缺乏信息、需要另外验证的问题', ''].join('\n');
const LINK = '[[Pew 2026-06 Americans and AI 2026#^c2]]';
const BODY = `# 跨设备先分场景验证\n\n## 决定\n\n跨设备先分场景验证。\n\n## 理由\n\n- 每天用的只有 24%${LINK}\n\n## 适用边界\n\n拿到留存数据前有效。\n`;
const card: DecisionCardData = { path: '20_项目/P/决策/跨设备先分场景验证.md', name: '跨设备先分场景验证', status: '推断', decidedBy: null, draftedByModel: null, body: BODY, problems: [] };

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

describe('T41 confirm step', () => {
  it('the summary: So what and the three reasons, footnote marks left out', () => {
    expect(confirmSummaryOf(REPORT_MD)).toEqual({ soWhat: '用的人多，天天用的人少。', reasons: ['用的人多，天天用的人少', 'Qira 布局到位，价值未证明', '用户要帮忙，不要失控'] });
    expect(confirmSummaryOf('# 旧报告\n\n## Summary\n\n旧的摘要。\n')).toEqual({ soWhat: '旧的摘要。', reasons: [] });
  });

  it('the fields are the 决定, 理由, 适用边界 sections, and write back into them', () => {
    expect(decisionFields(BODY)).toEqual({ decision: '跨设备先分场景验证。', reason: `- 每天用的只有 24%${LINK}`, scope: '拿到留存数据前有效。' });
    expect(decisionFields(withFields(BODY, { decision: '先验证。', reason: '- 因为', scope: '半年内。' }))).toEqual({ decision: '先验证。', reason: '- 因为', scope: '半年内。' });
  });

  it('ui-4e: every text and testid; a draft shows three fields the Senior can change directly', () => {
    const panel = html(createElement(DecisionPanel, { workspacePath: '20_项目/P/WS-A', researchDir: '20_项目/P/WS-A/调查/R1', reportPath: '20_项目/P/WS-A/调查/R1/报告 v1.md', decisions: [card], reviewPath: '20_项目/P/WS-A/review/结论 2026-10-28.md' }));
    const out = html(createElement(ConfirmStep, { markdown: REPORT_MD, reportName: '报告 v1' }, createElement('div', { dangerouslySetInnerHTML: { __html: panel } })));
    for (const t of ['决定 + 理由', 'AI 起草 · 待你确认', '决定', '理由', '适用边界', '可以直接改', '退回，写明理由', '确认，存入项目文件', '用的人多，天天用的人少', 'Qira 布局到位，价值未证明']) expect(out, t).toContain(t);
    for (const id of ['confirm-summary', 'return-report', 'confirm-store']) expect(out, id).toContain(`data-testid="${id}"`);
    expect([...out.matchAll(/data-testid="decision-field" data-field="(\w+)"/g)].map((m) => m[1])).toEqual(['decision', 'reason', 'scope']);
    expect(out).toContain('拿到留存数据前有效。');
    expect(out).not.toContain('data-testid="decision-editor"');
    // D10: no internal link syntax on the screen, in the fields either
    // 复核 P5: the citation is a numbered mark in the text, and its source is named once under the field
    expect(out).toContain('每天用的只有 24% 〔1〕');
    expect(out).toContain('data-testid="decision-citations"');
    expect(out).toContain('Pew 2026-06 Americans and AI 2026');
    expect(out).not.toMatch(/\[\[|#\^|· c2/);
  });

  it('复核 P5: a citation (quote, grade and link) is one numbered mark; the label loses its markdown; typing goes back with the citations as they were', () => {
    const cite = `“The kind of access they’re willing to grant is also limited”（B 级，知识库）[[Ping Identity 2026-06 Consumer Survey AI Trust#^c1]]`;
    const raw = `- **事实**：每天用的只有 24%${LINK}\n- **推断**：用户要帮忙，不要失控 ${cite}\n- 见 [[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]`;
    const shown = toFieldText(raw);
    expect(shown).toBe('- 事实：每天用的只有 24% 〔1〕\n- 推断：用户要帮忙，不要失控 〔2〕\n- 见 〔报告 v1〕');
    expect(fromFieldText(shown, raw)).toBe(raw);
    expect(fromFieldText(`${shown}\n- 新的一条 `, raw)).toBe(`${raw}\n- 新的一条 `);
    // the Senior rewrites the words and keeps the mark: the citation comes back intact
    expect(fromFieldText('- 事实：只有四分之一天天用 〔1〕', raw)).toBe(`- **事实**：只有四分之一天天用${LINK}`);
    expect(citationsOf(raw).map((c) => c.name)).toEqual(['Pew 2026-06 Americans and AI 2026', 'Ping Identity 2026-06 Consumer Survey AI Trust']);
    expect(citationsOf(raw)[1].quote).toContain('The kind of access');
  });

  it('review: a field that starts with a citation, a bare link inside a longer citation, and a quote with brackets', () => {
    const body = `# 决\n\n## 决定\n\n“先验证”（A 级，知识库）[[Pew A#^c1]] 先验证高频场景（[[Pew B#^c2]]）\n\n## 理由\n\n- **事实**：多数只是试用 “18 至 29 岁（31%）”（B 级，知识库）[[Pew B#^c2]]\n`;
    const decision = '“先验证”（A 级，知识库）[[Pew A#^c1]] 先验证高频场景（[[Pew B#^c2]]）';
    const reason = '- **事实**：多数只是试用 “18 至 29 岁（31%）”（B 级，知识库）[[Pew B#^c2]]';
    // A: the first citation of a field is a marker, and comes back as it was after an edit
    const shownDecision = toFieldText(decision, body);
    expect(shownDecision).not.toMatch(/\[\[|〔Pew/);
    expect(fromFieldText(shownDecision, body)).toBe(decision);
    expect(fromFieldText(`${shownDecision}。`, body)).toBe(`${decision}。`);
    // B: the reason shows no raw quote even though the same block is cited bare in 决定
    const shownReason = toFieldText(reason, body);
    expect(shownReason).not.toMatch(/“|\[\[/);
    expect(fromFieldText(shownReason, body)).toBe(reason);
    // C: the grade is the bracket right before the link, not one inside the quote
    expect(citationsOf(body).find((c) => c.quote?.startsWith('18'))?.grade).toBe('B 级，知识库');
  });

  it('a confirmed decision has no fields and no buttons', () => {
    const out = html(createElement(DecisionPanel, { workspacePath: 'w', researchDir: 'r', reportPath: 'p', decisions: [{ ...card, status: '已确认', decidedBy: 'Senior' }] }));
    for (const id of ['decision-field', 'return-report', 'confirm-store']) expect(out).not.toContain(`data-testid="${id}"`);
  });

  it('the inbox opens a report to confirm on its research page, at this step', async () => {
    const fm = (s: string) => `---\n${s.trim()}\n---\n`;
    const fx = await makeFixtureVault({
      '20_项目/P/WS-A/调查/R1/报告 v1.md': `${fm(`
id: r1
type: report
status: 进行中
created: "2026-10-27"
updated: "2026-10-27"
author: AI
derived_from: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
version: 1
research_plan: null
mode: team
exploratory: false
delivery: 已交付
`)}\n${REPORT_MD}\n`,
      '20_项目/P/WS-A/review/结论 2026-10-28.md': `${fm(`
id: rev-jl-open
type: review
status: 进行中
created: "2026-10-28"
updated: "2026-10-28"
author: Junior A
derived_from: ["[[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
requester: Junior A
reviewer: Senior
result: null
gate: 结论
version: 1
`)}\n# 结论 2026-10-28\n\n## Comment\n`,
    });
    cleanup = fx.cleanup;
    const [item] = await loadInbox(fx.vault, ROLES.senior);
    expect(item.href).toBe(`/workspace/P/WS-A/research/R1?step=confirm`);
  });
});
