/**
 * D-48 第 2 轮 (格式约定最后一节): what the writing prompts now ask of a question-tree report, and what the
 * recommendation prompt asks when a condition is 证据不足. An older plan's prompts are left as they were.
 */
import { describe, expect, it } from 'vitest';
import { judgePrompt, recommendPrompt, responsesPrompt, summaryPrompt } from '@/lib/harness/prompts/research-execute';
import { directivesOutOfBasis } from '@/lib/research/execute';

const claim = { id: 'C1', statement: '决策权和预算都在 IT', conditions: ['采购由 IT 牵头', '预算由 IT 出'], question: '决策权和预算在 IT 还是业务线？', label: 'H1', qid: 'Q1' };
const line = (key: string, stance: 'supports' | 'refutes') => ({ key, stance, grade: 'A', origin: '网络', publisher: 'p', published: null, quote: 'q', reason: '', core: false, partial: false });
const judge = (c: Record<string, unknown> = claim, conditions = [{ n: 1, text: '采购由 IT 牵头' }, { n: 2, text: '预算由 IT 出' }]) =>
  judgePrompt({
    claim: c as never,
    hypothesisLabel: null,
    evidence: [line('E1', 'supports'), line('E2', 'refutes')],
    subQuestions: [],
    context: '',
    exploratory: false,
    conditions,
  }).prompt;

describe('the writing prompt (a hypothesis card)', () => {
  const p = judge();

  it('fills every blank of the question, and the tone follows the conditions', () => {
    expect(p).toContain('问句里有几个空，就填几个');
    expect(p).toContain('写成"多半……，还缺……"');
  });

  it('a 证据不足 note says the half that holds first', () => {
    expect(p).toContain('证据不足的 note 先写已经成立的那一半，再写还缺什么');
  });

  it('a fact sentence with a footnote is not marked （推断）', () => {
    expect(p).toContain('挂了 [E#]、照着证据原文说的事实句不标"（推断）"');
  });

  it('"不影响判断" needs a reason pointing to evidence or a condition (also in the batched responses)', () => {
    expect(p).toContain('只写一句"不影响"、没有指向的，系统照旧当成没驳倒');
    const r = responsesPrompt({ claim: claim as never, evidence: [line('E2', 'refutes')], keys: ['E2'], verdict: '成立', revisedStatement: null, reasoning: 'r' }).prompt;
    expect(r).toContain('只写一句"不影响"、没有指向的，系统照旧当成没驳倒');
  });
});

describe('the Summary prompt', () => {
  it('the one-line answer answers the core question first', () => {
    const p = summaryPrompt({
      question: '谁为 AI PC 付钱？',
      claims: [{ label: 'H1', statement: 's', verdict: '需要修改', revised: null, reasoning: 'r', soWhat: [], gaps: [], expertQuestions: [], keyEvidence: [] }],
      exploratory: false,
      purpose: 'p',
      tree: { roots: [{ qid: 'Q1', question: '决策权和预算在 IT 还是业务线？', parts: [], labels: ['H1'], ran: true }], meceCheck: '' },
    } as never).prompt;
    expect(p).toContain('先正面回答核心问题的空（比如付钱的是哪一部分、按什么条件付），再说还没证实的');
    expect(p).toContain('answers 也一样：问句里有几个空就填几个');
  });
});

describe('the recommendation prompt', () => {
  const base = { question: 'q', purpose: 'p', soWhat: 's', workplanImpact: [], exploratory: false };
  const treeClaim = { label: 'H2-1', statement: 's', verdict: '需要修改', revised: null, reasoning: 'r', soWhat: [], keyEvidence: [], conditions: [{ label: '①', text: '管不住就出局', status: '证据不足' }, { label: '②', text: '监管写明准入', status: '成立' }] };

  it('a 证据不足 condition is no premise: "推断：依赖待验证断言 X（靠 Q2-1 ①）", and change_if says what the recommendation becomes', () => {
    const p = recommendPrompt({ ...base, claims: [treeClaim] }).prompt;
    expect(p).toContain('逐条对照里判"证据不足"的条件（[Q2-1①]）还没证实');
    expect(p).toContain('"推断：依赖待验证断言 <它说的事> [Q2-1①]"');
    expect(p).toContain('若 <它说的事> 不成立 → 推荐改成……');
  });

  it('each cell "<结论，≤ 60 字>。依据：…"; the directive row and the 待议事项 wording kept', () => {
    const p = recommendPrompt({ ...base, claims: [treeClaim], directives: [{ key: 'M1', kind: '会议', name: 'm', quote: '押管理' }] }).prompt;
    expect(p).toContain('每一格先写一句结论，不超过 60 字，后面接"依据："再写依据');
    expect(p).toContain('directive_response：怎么回应高层指示');
    expect(p).toContain('记作项目级待议事项，由 Senior 拍板');
  });

  it('an older plan (no conditions): as before', () => {
    const p = recommendPrompt({ ...base, claims: [{ ...treeClaim, label: 'H1', conditions: [] }] }).prompt;
    expect(p).not.toContain('每一格先写一句结论');
    expect(p).not.toContain('依赖待验证断言 <它说的事>');
  });
});

describe('第 3 轮', () => {
  it('the Summary keeps the cards\' "多半""还缺" when it assembles them', () => {
    const p = summaryPrompt({
      question: '谁为 AI PC 付钱？',
      purpose: 'p',
      claims: [{ label: 'H1', statement: 's', verdict: '需要修改', revised: null, reasoning: 'r', soWhat: [], gaps: [], expertQuestions: [], keyEvidence: [], answer: '多半按价格定，还缺采购案例' }],
      exploratory: false,
      tree: { roots: [{ qid: 'Q1', question: 'q', parts: [], labels: ['H1'], ran: true }], meceCheck: '' },
    } as never).prompt;
    expect(p).toContain('组装时语气不能变硬');
    expect(p).toContain('不能把"多半按价格定"改成"按价格定"');
  });

  it('"怎么回应高层指示" follows the pending rule; the directive is never its own 依据', () => {
    const p = recommendPrompt({
      question: 'q', purpose: 'p', soWhat: 's', workplanImpact: [], exploratory: false,
      claims: [{ label: 'H1', statement: 's', verdict: '需要修改', revised: null, reasoning: 'r', soWhat: [], keyEvidence: [], conditions: [{ label: '②', text: '拍板分散', status: '证据不足' }] }],
      directives: [{ key: 'M1', kind: '会议', name: 'm', quote: '决定权在 CIO 和 IT 手里' }],
    }).prompt;
    expect(p).toContain('高层指示的原话（[M#]）是被回应的对象');
    expect(p).toContain('（"怎么回应高层指示"那一格也算）');
  });

  it('code moves an [M#] out of the 依据 into the conclusion', () => {
    expect(directivesOutOfBasis('支持：联想站在机队整合这一层。依据：[M1] 微软已管配置 [E2]')).toBe('支持：联想站在机队整合这一层[M1]。依据：微软已管配置 [E2]');
    expect(directivesOutOfBasis('支持 [M1]：联想站在机队整合这一层。依据：[M1]')).toBe('支持 [M1]：联想站在机队整合这一层。');
    expect(directivesOutOfBasis('修正 [M1]：只在受监管行业。依据：监管要求 [E3]')).toBe('修正 [M1]：只在受监管行业。依据：监管要求 [E3]');
  });
});
