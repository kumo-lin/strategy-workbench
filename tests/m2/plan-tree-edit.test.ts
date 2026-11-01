/**
 * D-39 P1: editing a question-tree plan on the plan page, and saving it as a new version without losing a field.
 * Fixture: tests/fixtures/d39/计划 v3.md (C's WS-A sample: Q1 / Q2 → Q2-1, Q2-2 / Q3 → Q3-1, Q3-2, Q3-3).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addChildQuestion,
  addTopQuestion,
  editorTree,
  emptyCondition,
  removeQuestion,
  removeTreeNode,
  splitQuestion,
  updateClaimQuestion,
  updateCondition,
  updateTreeNode,
  validatePlan,
} from '@/components/research/plan-edit-utils';
import { researchPlanSchema } from '@/lib/notes/schema';
import { planSaveRequestSchema } from '@/lib/research/plan-request';
import { savePlanVersion } from '@/lib/research/plan-save';
import { renderPlanBody, toEditable, type EditablePlan } from '@/lib/research/plan-types';
import { hypothesisLabel, treeChecks } from '@/lib/research/question-tree';
import { parseMarkdown } from '@/lib/vault/frontmatter';
import { ROLES } from '../helpers/fixture-vault';
import { RDIR, setup, WS } from './research-fixture';

const RAW = readFileSync('tests/fixtures/d39/计划 v3.md', 'utf8');
const sample = (): EditablePlan => toEditable(researchPlanSchema.parse(parseMarkdown(RAW).data));
const labels = (p: EditablePlan) => p.claims.map((c) => `${c.id}=${hypothesisLabel(p, c.id)}`);
const codes = (p: EditablePlan) => treeChecks(p).map((t) => t.code);

describe('the sample plan', () => {
  it('passes the tree checks and the editor\'s own checks', () => {
    const p = sample();
    expect(treeChecks(p)).toEqual([]);
    expect(validatePlan(p)).toEqual([]);
    expect(labels(p)).toEqual(['C1=H1', 'C2=H2-1', 'C3=H2-2', 'C4=H3-1', 'C5=H3-2', 'C6=H3-3']);
  });
});

describe('tree edits keep the numbering in place', () => {
  it('splitting Q1: its question moves to the new node, its hypothesis is the first part, a second part is added', () => {
    const p = splitQuestion(sample(), 'C1');
    expect(p.question_tree).toEqual([
      { id: 'Q1', question: '谁决定买，谁出钱？' },
      { id: 'Q2', question: '买方按什么标准放行，又按什么标准选？' },
      { id: 'Q3', question: '这笔钱从哪个预算出？在什么条件下批？' },
    ]);
    expect(p.claims.slice(0, 2).map((c) => [c.id, c.parent, c.question])).toEqual([['C1', 'Q1', ''], ['C7', 'Q1', '']]);
    expect(labels(p).slice(0, 3)).toEqual(['C1=H1-1', 'C7=H1-2', 'C2=H2-1']);
    expect(validatePlan(p)).toEqual(expect.arrayContaining(['Q1-1：子问题的问句不能为空', 'Q1-2：子问题的问句不能为空', '假设 H1-2：假设不能为空']));
    const filled = updateClaimQuestion(updateClaimQuestion(p, 'C1', '谁决定买？'), 'C7', '谁出钱？');
    expect(codes(filled)).toEqual(['no_conditions', 'no_counter_search']); // only the new, empty card: the structure is sound
  });

  it('a part is not split again (two levels at most)', () => {
    const p = sample();
    expect(splitQuestion(p, 'C2')).toBe(p);
  });

  it('a part added under Q2 sits after Q2-2; Q3 keeps its numbers', () => {
    const p = addChildQuestion(sample(), 'Q2');
    expect(p.claims.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C7', 'C4', 'C5', 'C6']);
    expect(labels(p)).toEqual(['C1=H1', 'C2=H2-1', 'C3=H2-2', 'C7=H2-3', 'C4=H3-1', 'C5=H3-2', 'C6=H3-3']);
    expect(p.claims[3].conditions).toEqual([emptyCondition()]);
    expect(p.claims[3].sub_questions).toEqual([{ id: 'C7-Q1', question: '', methods: ['知识库'] }]);
  });

  it('removing Q2 with its parts renumbers Q3 to Q2 (node id and parents), so the tree check finds nothing out of place', () => {
    const p = removeTreeNode(sample(), 'Q2');
    expect(p.question_tree).toEqual([{ id: 'Q2', question: '这笔钱从哪个预算出？在什么条件下批？' }]);
    expect(p.claims.map((c) => c.parent ?? null)).toEqual([null, 'Q2', 'Q2', 'Q2']);
    expect(labels(p)).toEqual(['C1=H1', 'C4=H2-1', 'C5=H2-2', 'C6=H2-3']);
    expect(codes(p)).toEqual([]);
  });

  it('removing one of two parts leaves a split of one, which the tree check reports', () => {
    const p = removeQuestion(sample(), 'C2');
    expect(codes(p)).toEqual(['single_child']);
    expect(removeQuestion({ ...p, claims: p.claims.slice(0, 1) }, 'C1').claims).toHaveLength(1); // one is always kept
  });

  it('a new top-level sub-question is Q4 / H4, empty until written', () => {
    const p = addTopQuestion(sample());
    expect(labels(p).at(-1)).toBe('C7=H4');
    expect(validatePlan(p)).toEqual(expect.arrayContaining(['Q4：子问题的问句不能为空', '假设 H4：至少需要一条必须成立的条件', '要查的问题 Q4.1：问法不能为空']));
  });

  it('renaming a split sub-question; an empty one is reported by its number', () => {
    expect(updateTreeNode(sample(), 'Q3', '钱从哪里出？').question_tree?.[1]).toEqual({ id: 'Q3', question: '钱从哪里出？' });
    expect(validatePlan(updateTreeNode(sample(), 'Q3', ' '))).toEqual(['Q3：子问题的问句不能为空']);
  });

  it('every question cleared while typing: still a tree in the editor', () => {
    const p = sample();
    const cleared = { ...p, claims: p.claims.map((c) => ({ ...c, question: '' })) };
    expect(editorTree(cleared).roots.map((r) => r.qid)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(validatePlan(cleared, true)).toContain('Q2-1：子问题的问句不能为空');
  });

  it('a condition cell: a sentence becomes a row, a row keeps its other cells', () => {
    expect(updateCondition('采购由 IT 牵头', 'where', '招标公告')).toEqual({ text: '采购由 IT 牵头', where: '招标公告' });
    expect(updateCondition({ text: 'a', evidence_needed: 'b', where: 'c' }, 'text', 'x')).toEqual({ text: 'x', evidence_needed: 'b', where: 'c' });
  });
});

describe('the plan body written when the editor saves', () => {
  it('the tree, each hypothesis under its sub-question with the three-column table, the MECE check', () => {
    const body = renderPlanBody(sample(), '买方采购逻辑 调查计划 v4');
    expect(body).toContain('## 问题树');
    expect(body).toContain('├─ Q2 买方按什么标准放行，又按什么标准选？\n│   ├─ Q2-1 "IT 管得住"是不满足就出局的准入要求，还是加分项？');
    expect(body).toContain('└─ Q3 这笔钱从哪个预算出？在什么条件下批？\n    ├─ Q3-1');
    expect(body).toContain('### Q1 谁决定买，谁出钱？\n\n**假设 H1**：能不能进机队');
    expect(body).toContain('### Q2 买方按什么标准放行，又按什么标准选？\n\n#### Q2-1');
    expect(body).toContain('| 必须成立的条件 | 要什么证据 | 去哪里查 |');
    expect(body).toContain('| 1. 员工端 AI 工具被纳入统一终端管理，比如白名单、SSO、日志归集、策略下发 | 企业或行业的 AI 使用规定原文、终端管理政策原文 | 受监管行业公开的规定；知识库 |');
    expect(body).toContain('- Q1.1 企业把员工端 AI 工具纳入统一终端管理的规定原文有哪些？（查法：知识库、网络）');
    expect(body).toContain('## MECE 和充分必要的自检\n\n买方为一样东西付钱，要过三关');
    expect(body).not.toMatch(/论点|C1-Q1/);
  });

  it('an older-format plan is written as before', () => {
    const p = sample();
    const legacy: EditablePlan = { question: p.question, purpose: p.purpose, claims: [{ id: 'C1', statement: '论点', hypothesis: null, conditions: ['条件'], sub_questions: [{ id: 'C1-Q1', question: '查什么', methods: ['网络'] }], counter_search: '反证' }] };
    expect(renderPlanBody(legacy, 't')).toContain('## 论点 C1：论点\n- 成立的条件：\n  - 条件\n- 子问题：\n  - C1-Q1 查什么（查法：网络）');
  });
});

describe('saved from the page: request → schema → new version → read back, no field lost', () => {
  it('the sample plan, as the page posts it', async () => {
    const fx = await setup({});
    try {
      const plan = sample();
      const req = planSaveRequestSchema.parse(JSON.parse(JSON.stringify({ workspacePath: WS, researchDir: RDIR, plan })));
      expect(req.plan).toEqual(plan);
      const saved = await savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan: req.plan as EditablePlan });
      const back = await fx.vault.read(saved.path);
      expect(toEditable(researchPlanSchema.parse(back.data))).toEqual(plan);
      expect(treeChecks(researchPlanSchema.parse(back.data))).toEqual([]);
      expect(back.body).toContain('#### Q3-2');
    } finally {
      await fx.cleanup();
    }
  });
});

describe('the plan prompt (D-39)', () => {
  it('asks for the tree first, then one hypothesis per lowest-level sub-question, then the verification plan; its example passes the checks', async () => {
    const { researchPlanPrompt } = await import('@/lib/harness/prompts/research-plan');
    const fx = await setup({});
    try {
      const prompt = await researchPlanPrompt(fx.ctx);
      expect(prompt).toContain('**先拆子问题**');
      expect(prompt).toContain('给每个**最底层**的子问题');
      expect(prompt).toContain('**最后写验证计划**');
      expect(prompt).toContain('**要查的问题**（`sub_questions`');
      expect(prompt).toContain('**试水调查只查第 1 个子问题**');
      expect(prompt).toContain('成立 / 需要修改（改成……）/ 不成立 / 证据不足');
      const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]);
      expect(treeChecks(example)).toEqual([]);
      const note = researchPlanSchema.parse({ ...example, type: 'research_plan', status: '进行中', created: '2026-10-26', updated: '2026-10-26', author: 'AI', exploratory: false });
      expect(note.claims.map((c) => [c.id, c.parent ?? null])).toEqual([['C1', null], ['C2', 'Q2'], ['C3', 'Q2']]);
      expect(note.claims[0].conditions[0]).toEqual(expect.objectContaining({ evidence_needed: expect.any(String), where: expect.any(String) }));
    } finally {
      await fx.cleanup();
    }
  });
});

describe('the plan page (server render)', () => {
  const render = async (plan: EditablePlan, perspectives?: string[]) => {
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { PlanEditor } = await import('@/components/research/plan-editor');
    return renderToString(createElement(PlanEditor, { plan, planName: '计划 v3', approved: false, canEdit: true, onSave: async () => ({ ok: true as const, name: 'x' }), onApprove: async () => ({ ok: true as const }), perspectives })).replace(/<!-- -->/g, '');
  };
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  const approveButton = (html: string) => /<button[^>]*>(?:(?!<\/button>)[\s\S])*计划定了，开始调查 →<\/button>/.exec(html)![0];

  it('grouped by sub-question: two split ones, six hypothesis cards, a three-column table each, the MECE check; approvable', async () => {
    const html = await render(sample(), ['买方', '竞争对手', '我方自身的布局', '监管', '技术供给']);
    expect(html).toContain('data-testid="plan-tree"');
    expect(count(html, /data-testid="plan-tree-node"/g)).toBe(2);
    expect(count(html, /data-testid="plan-leaf"/g)).toBe(6);
    expect(count(html, /data-testid="plan-conditions"/g)).toBe(6);
    expect(html).toContain('核心问题');
    expect(html).toContain('假设 H2-1');
    expect(html).toContain('Q3-3');
    expect(html).toContain('要查的问题 2 条');
    expect(html).toContain('aria-label="要查的问题 Q1.1 的问法"');
    expect(html).toContain('aria-label="把 Q1 往下拆"');
    expect(html).not.toContain('aria-label="把 Q2-1 往下拆"'); // two levels at most
    expect(html).toContain('拆成：Q2-1、Q2-2');
    expect(html).toMatch(/data-testid="plan-node-perspectives">　视角：买方、监管、竞争对手/);
    expect(html).toContain('MECE 和充分必要的自检（AI 提议）');
    expect(html).not.toContain('data-testid="approve-blockers"');
    expect(approveButton(html)).not.toMatch(/disabled=""/);
    expect(html).not.toContain('论点');
  });

  it('a tree that fails its checks: the approve button cannot be clicked, and the page says why', async () => {
    const html = await render(removeQuestion(sample(), 'C2'));
    expect(approveButton(html)).toMatch(/disabled=""/);
    expect(html).toContain('data-testid="approve-blockers"');
    expect(html).toContain('现在还不能批准');
    expect(html).toContain('Q2 只拆出 1 个下一级子问题');
  });
});
