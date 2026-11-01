/**
 * D-48 (报告新写法), the fields everyone writes against: the judgment's conditions / answer / reasons / changed /
 * short_statement and the summary's split_basis. An older answer (every mock written before) still parses, with
 * the defaults; a new one keeps what it gave, and what is malformed falls back instead of failing the whole answer.
 */
import { describe, expect, it } from 'vitest';
import { judgmentSchema, summarySchema } from '@/lib/research/schemas';

const OLD_JUDGMENT = {
  verdict: '需要修改',
  rebutted: [],
  revised_statement: 'IT 管准入，钱由多方出',
  support_lines: ['IT 把关准入 [E1]'],
  counter_lines: [],
  reasoning: '准入在 IT [E1]，预算分散 [E2]',
  challenge_responses: [],
  model_knowledge: [],
  so_what: ['先打 IT'],
  gaps: [],
  expert_questions: [],
};

describe('judgmentSchema: the D-48 fields', () => {
  it('an answer written before D-48 parses, with the defaults', () => {
    const j = judgmentSchema.parse(OLD_JUDGMENT);
    expect(j).toMatchObject({ conditions: [], answer: '', reasons: [], changed: '', short_statement: '' });
  });

  it('a new answer keeps them; more than 3 reasons are cut; n and keys are read loosely', () => {
    const j = judgmentSchema.parse({
      ...OLD_JUDGMENT,
      conditions: [
        { n: 1, status: '成立', keys: ['E1', 'E3'], note: '准入由 IT 把关' },
        { n: '2', status: '不成立', keys: 'E2,E5', note: 'IT 集中出的只占约两成' },
        { n: 3, status: '证据不足', note: '' },
      ],
      answer: 'IT 管能不能进；钱由多方出，IT 集中出的只占约两成 [E2]',
      reasons: ['准入在 IT [E1]', '预算分散 [E2]', '支出在 IT 之外 [E5]', '第四条'],
      changed: '改成 IT 管准入、钱由多方出',
      short_statement: 'IT 一手包办',
    });
    expect(j.conditions).toEqual([
      { n: 1, status: '成立', keys: ['E1', 'E3'], note: '准入由 IT 把关' },
      { n: 2, status: '不成立', keys: ['E2', 'E5'], note: 'IT 集中出的只占约两成' },
      { n: 3, status: '证据不足', keys: [], note: '' },
    ]);
    expect(j.reasons).toHaveLength(3);
    expect(j.changed).toBe('改成 IT 管准入、钱由多方出');
    expect(j.short_statement).toBe('IT 一手包办');
  });

  it('a status outside the three ("一半成立") drops the conditions, not the judgment: it is judged the old way', () => {
    const j = judgmentSchema.parse({ ...OLD_JUDGMENT, conditions: [{ n: 1, status: '一半成立', keys: [], note: '' }], answer: 7 });
    expect(j.conditions).toEqual([]);
    expect(j.answer).toBe('');
    expect(j.verdict).toBe('需要修改');
  });
});

describe('summarySchema: split_basis', () => {
  const OLD = { so_what: '付钱的是软件席位和服务订阅', results: ['H1 → 需要修改（提议）'] };
  it('absent in an older answer; kept when given; a list is joined like the other loose text fields', () => {
    expect(summarySchema.parse(OLD).split_basis ?? '').toBe('');
    expect(summarySchema.parse({ ...OLD, split_basis: '按一笔采购的三个要素拆' }).split_basis).toBe('按一笔采购的三个要素拆');
    expect(summarySchema.parse({ ...OLD, split_basis: ['谁拍板', '按什么标准'] }).split_basis).toBe('谁拍板；按什么标准');
  });
});
