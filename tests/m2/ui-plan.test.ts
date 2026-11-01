/** Render gate for the research UI (server-side render to a string: no DOM needed). */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanEditor } from '@/components/research/plan-editor';
import type { EditablePlan } from '@/lib/research/plan-types';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const plan: EditablePlan = {
  question: '企业为什么为员工的 AI PC 买单？',
  purpose: '决定 WS-A 先验证哪个买方场景',
  claims: [
    {
      id: 'C1',
      statement: 'IT 可管理性决定采购',
      hypothesis: null,
      conditions: ['采购由 IT 牵头'],
      sub_questions: [
        { id: 'C1-Q1', question: '谁拍板？', methods: ['知识库'] },
        { id: 'C1-Q2', question: '预算来自哪里？', methods: ['知识库', '网络'] },
      ],
      counter_search: '找 IT 不是决策方的案例',
    },
    { id: 'C2', statement: '第二个论点', hypothesis: null, conditions: ['条件'], sub_questions: [{ id: 'C2-Q1', question: '问题？', methods: ['网络'] }], counter_search: '反证' },
  ],
};

describe('PlanEditor', () => {
  const base = { plan, planName: '计划 v2', approved: false, canEdit: true, onSave: async () => ({ ok: true as const, name: '计划 v3' }), onApprove: async () => ({ ok: true as const }) };

  it('one Plan card per claim (AI Elements), every control reachable by label', () => {
    const out = html(createElement(PlanEditor, base));
    expect(count(out, /data-slot="plan"/g)).toBe(2);
    for (const label of ['删除论点 C1', '删除论点 C2', '删除子问题 C1-Q1', '删除子问题 C1-Q2', '为论点 C1 添加成立条件']) expect(out).toContain(label);
    for (const text of ['计划 v2', '保存为新版本', '计划定了，开始调查 →', 'C1-Q1', 'C1-Q2', '知识库', '网络', '专家访谈', '添加子问题', '添加论点']) expect(out).toContain(text);
    expect(out).toContain('IT 可管理性决定采购');
  });

  it('read-only for non-owners: no edit / save / approve controls', () => {
    const out = html(createElement(PlanEditor, { ...base, canEdit: false }));
    expect(out).not.toContain('保存为新版本');
    expect(out).not.toContain('计划定了，开始调查 →');
    expect(out).not.toContain('删除论点 C1');
    expect(out).toContain('只读：'); // the five-part read-only note (谁能做 / 为什么 / 你能做什么 / 去哪做)
  });
});

