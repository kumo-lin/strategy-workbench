/** 2.2 — pure helpers behind the plan editor. */
import { describe, expect, it } from 'vitest';
import {
  addClaim,
  addSubQuestion,
  nextClaimId,
  nextSubQuestionId,
  planEquals,
  removeClaim,
  removeSubQuestion,
  updateSubQuestion,
  validatePlan,
} from '@/components/research/plan-edit-utils';
import type { EditablePlan } from '@/lib/research/plan-types';

const plan = (): EditablePlan => ({
  question: '企业为什么买单？',
  purpose: '决定先做哪个买方场景',
  claims: [
    {
      id: 'C1',
      statement: 'IT 可管理性决定采购',
      hypothesis: '[[WS-A-H1 IT 可管理性决定采购]]',
      conditions: ['采购决策由 IT 牵头'],
      sub_questions: [
        { id: 'C1-Q1', question: '谁拍板？', methods: ['知识库'] },
        { id: 'C1-Q3', question: '预算来自哪里？', methods: ['知识库', '网络'] },
      ],
      counter_search: '找 IT 不是决策方的案例',
    },
  ],
});

describe('plan edit helpers', () => {
  it('nextSubQuestionId continues from the highest number, not the count', () => {
    expect(nextSubQuestionId(plan().claims[0])).toBe('C1-Q4');
    expect(nextClaimId(plan())).toBe('C2');
  });

  it('addSubQuestion appends a valid, empty-ish sub-question and does not mutate the input', () => {
    const p = plan();
    const next = addSubQuestion(p, 'C1', '新的问法');
    expect(next.claims[0].sub_questions.map((q) => q.id)).toEqual(['C1-Q1', 'C1-Q3', 'C1-Q4']);
    expect(next.claims[0].sub_questions[2]).toMatchObject({ question: '新的问法', methods: ['知识库'] });
    expect(p.claims[0].sub_questions).toHaveLength(2);
  });

  it('removeSubQuestion keeps ids stable and refuses to remove the last one', () => {
    const next = removeSubQuestion(plan(), 'C1', 'C1-Q1');
    expect(next.claims[0].sub_questions.map((q) => q.id)).toEqual(['C1-Q3']);
    const same = removeSubQuestion(next, 'C1', 'C1-Q3');
    expect(same.claims[0].sub_questions).toHaveLength(1);
  });

  it('updateSubQuestion changes the wording / methods of one sub-question only', () => {
    const next = updateSubQuestion(plan(), 'C1-Q3', { question: '预算归谁？', methods: ['专家访谈'] });
    expect(next.claims[0].sub_questions[1]).toMatchObject({ id: 'C1-Q3', question: '预算归谁？', methods: ['专家访谈'] });
    expect(next.claims[0].sub_questions[0].question).toBe('谁拍板？');
  });

  it('addClaim creates C2 with one sub-question C2-Q1; removeClaim refuses to remove the last claim', () => {
    const next = addClaim(plan());
    expect(next.claims.map((c) => c.id)).toEqual(['C1', 'C2']);
    expect(next.claims[1].sub_questions.map((q) => q.id)).toEqual(['C2-Q1']);
    expect(removeClaim(next, 'C1').claims.map((c) => c.id)).toEqual(['C2']);
    expect(removeClaim(removeClaim(next, 'C1'), 'C2').claims).toHaveLength(1);
  });

  it('validatePlan reports what is missing, in Chinese, and accepts a good plan', () => {
    expect(validatePlan(plan())).toEqual([]);
    const bad = plan();
    bad.question = ' ';
    bad.claims[0].counter_search = '';
    bad.claims[0].conditions = [''];
    bad.claims[0].sub_questions[0].methods = [];
    bad.claims[0].sub_questions[1].question = '';
    const errs = validatePlan(bad);
    expect(errs.length).toBeGreaterThanOrEqual(5);
    expect(errs.join('\n')).toMatch(/问题/);
    expect(errs.join('\n')).toMatch(/反证/);
    expect(errs.join('\n')).toMatch(/C1-Q1/);
    expect(validatePlan({ ...plan(), claims: [] })).not.toEqual([]);
  });

  it('planEquals compares content, not identity', () => {
    expect(planEquals(plan(), plan())).toBe(true);
    const changed = plan();
    changed.claims[0].sub_questions[0].question = '谁最终拍板？';
    expect(planEquals(plan(), changed)).toBe(false);
  });
});
