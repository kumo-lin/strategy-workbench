/**
 * D-48: a question-tree hypothesis is judged on its plan conditions one by one (①②③, three states), code checks each
 * status, derives the verdict from them, then §9.5 on the whole. Fixtures: W5 计划 v1's C1 (its ③ states the judging
 * standard) and conditions from the WS-A plans.
 */
import { describe, expect, it } from 'vitest';
import { checkCondition, isCriterionCondition, verdictFromConditions, type Evidence } from '@/lib/research/evidence';
import { answeredRefutes, plannedConditions, revisionFailures, settleJudgment, type ClaimResult } from '@/lib/research/judge';
import { judgmentSchema, type Judgment } from '@/lib/research/schemas';
import { ev } from './research-evidence';

/** W5 计划 v1, C1. */
const W5_C1 = {
  question: '联想该押哪一层，怎么拿到？',
  conditions: ['分析机构或财报显示联想的优势在于能整合和管理的设备类别多、商用渠道大、服务收入占比高', '换机预算吃紧时，买方看重的是机队运行成本而不是 AI 硬件能力', '至少 2 条互相独立的支持证据，其中至少 1 条 A/B 级'],
};

describe('the line that states the judging standard is skipped', () => {
  it('W5 计划 v1 C1 ③ (and the WS-B variant); ① ② are judged, numbered by the plan', () => {
    expect(isCriterionCondition(W5_C1.conditions[2])).toBe(true);
    expect(isCriterionCondition('至少 2 份互相独立的调研支持，其中至少 1 份 A/B 级')).toBe(true);
    expect(plannedConditions(W5_C1)).toEqual([
      { n: 1, text: W5_C1.conditions[0] },
      { n: 2, text: W5_C1.conditions[1] },
    ]);
  });

  it('a condition about the world stays, numbers or grades in it or not', () => {
    for (const c of [
      '换机预算确实吃紧：单价上涨、出货下滑、换机周期延长，三者至少两个成立',
      '独立第三方的员工调研里，未经批准使用 AI 工具的比例在三成以上，样本是大中型企业员工',
      '「AI」作为标签本身不足以扩大预算，而能给出可量化收益的具体项目可以获批——两点都要有证据，否则只是同义反复',
      '独立分析机构把 Windows 11 换机而非 AI 列为主因',
      ...W5_C1.conditions.slice(0, 2),
    ])
      expect(isCriterionCondition(c)).toBe(false);
  });

  it('an older plan (no question on the claim) is judged the old way: nothing planned', () => {
    expect(plannedConditions({ question: undefined, conditions: W5_C1.conditions })).toEqual([]);
  });
});

const A = (over: Partial<Evidence> = {}) => ev({ grade: 'A', ...over });
const C = (over: Partial<Evidence> = {}) => ev({ grade: 'C', ...over });

describe('code checks each status', () => {
  const s1 = A();
  const s2 = C();
  const s3 = C({ publisher: s2.publisher, url: s2.url });
  const r1 = A({ stance: 'refutes' });
  const r2 = C({ stance: 'refutes' });
  const keyed = new Map<string, Evidence>([['E1', s1], ['E2', s2], ['E3', s3], ['E4', r1], ['E5', r2]]);
  const none = new Set<string>();

  it('成立 needs 2 independent supports, one A/B: [E1][E2] stands, [E2][E3] (one publisher) is 证据不足', () => {
    expect(checkCondition({ n: 1, status: '成立', keys: ['E1', 'E2'], note: '' }, keyed, none)).toEqual({ n: 1, status: '成立', keys: ['E1', 'E2'], note: '' });
    const weak = checkCondition({ n: 1, status: '成立', keys: ['E2', '[E3]', 'E9'], note: 'x' }, keyed, none);
    expect(weak).toMatchObject({ status: '证据不足', keys: ['E2', 'E3'], note: 'x' });
    expect(weak.adjusted).toContain('只有 1 个独立来源，最高 C 级');
  });

  it('不成立 needs an A/B refute not rebutted: [E4] stands; [E5] (C) or a rebutted [E4] is 证据不足', () => {
    expect(checkCondition({ n: 2, status: '不成立', keys: ['E4'], note: '' }, keyed, none).status).toBe('不成立');
    expect(checkCondition({ n: 2, status: '不成立', keys: ['E5'], note: '' }, keyed, none)).toMatchObject({ status: '证据不足', adjusted: expect.stringContaining('A/B 级反证') });
    expect(checkCondition({ n: 2, status: '不成立', keys: ['E4'], note: '' }, keyed, new Set([r1.ref])).status).toBe('证据不足');
  });

  it('证据不足 is left as it is', () => {
    expect(checkCondition({ n: 3, status: '证据不足', keys: [], note: '' }, keyed, none)).toEqual({ n: 3, status: '证据不足', keys: [], note: '' });
  });

  it('the verdict from the statuses: the four cases', () => {
    expect(verdictFromConditions(['成立', '成立', '成立'])).toBe('成立');
    expect(verdictFromConditions(['不成立', '不成立'])).toBe('不成立');
    expect(verdictFromConditions(['证据不足', '证据不足'])).toBe('证据不足');
    expect(verdictFromConditions(['成立', '不成立', '证据不足'])).toBe('需要修改');
    expect(verdictFromConditions(['成立', '证据不足'])).toBe('需要修改');
  });
});

describe('settleJudgment: conditions → verdict → §9.5', () => {
  const s1 = A();
  const s2 = ev({ grade: 'B' });
  const s3 = A();
  const core = A({ stance: 'refutes', core: true });
  const evidence = [s1, s2, s3, core];
  const keyed = new Map<string, Evidence>([['E1', s1], ['E2', s2], ['E3', s3], ['E4', core]]);
  const planned = plannedConditions(W5_C1);
  const judgment = (over: Partial<Judgment>): Judgment =>
    judgmentSchema.parse({ verdict: '需要修改', reasoning: 'r', support_lines: [], counter_lines: [], challenge_responses: [], model_knowledge: [], so_what: [], gaps: [], expert_questions: [], ...over });
  const conds = (a: string, b: string, keysA = ['E1', 'E2'], keysB = ['E1', 'E3']) => [
    { n: 1, status: a, keys: keysA, note: '' },
    { n: 2, status: b, keys: keysB, note: '' },
  ];

  it('all 成立 → 成立 (no 系统复核 line when the model said so too); "改了什么" is kept as written', () => {
    const { result, fallback } = settleJudgment('H1', judgment({ verdict: '成立', conditions: conds('成立', '成立') as never, changed: '没改', rebutted: ['E4'] }), evidence, keyed, planned);
    expect(fallback).toBeNull();
    expect(result).toMatchObject({ verdict: '成立', adjusted: false, adjustNote: '', revisedStatement: null });
    expect(result.conditions.map((c) => [c.label, c.status])).toEqual([['①', '成立'], ['②', '成立']]);
    expect(result.conditions[0].text).toBe(W5_C1.conditions[0]);
  });

  it('all 不成立 → 不成立', () => {
    const { result } = settleJudgment('H1', judgment({ verdict: '不成立', conditions: conds('不成立', '不成立', ['E4'], ['E4']) as never, changed: '① 被推翻' }), evidence, keyed, planned);
    expect(result.verdict).toBe('不成立');
  });

  it('all 证据不足 → 证据不足', () => {
    const { result } = settleJudgment('H1', judgment({ verdict: '证据不足', conditions: conds('证据不足', '证据不足', [], []) as never, changed: '还判断不了，缺买方证据' }), evidence, keyed, planned);
    expect(result).toMatchObject({ verdict: '证据不足', adjusted: false });
  });

  it('the rest → 需要修改, revised_statement = "改了什么"; a revision needs no assertions to pass', () => {
    const { result } = settleJudgment('H1', judgment({ verdict: '需要修改', conditions: conds('成立', '不成立', ['E1', 'E2'], ['E4']) as never, changed: '改成只押机队整合', revised_statement: '旧的长句' }), evidence, keyed, planned);
    expect(result).toMatchObject({ verdict: '需要修改', adjusted: false, revisedStatement: '改成只押机队整合', assertions: [] });
    expect(result.judgment.revised_statement).toBe('改成只押机队整合');
    expect(revisionFailures([{ ...result, label: 'H1', claim: { id: 'C1' } } as unknown as ClaimResult])).toEqual([]);
  });

  it('a 成立 that does not clear the bar turns the verdict: 系统复核 says which condition and why', () => {
    const { result } = settleJudgment('H1', judgment({ verdict: '成立', conditions: conds('成立', '成立', ['E1', 'E2'], ['E2']) as never, changed: '没改' }), evidence, keyed, planned);
    expect(result.conditions[1]).toMatchObject({ status: '证据不足', adjusted: expect.stringContaining('只有 1 个独立来源') });
    expect(result.adjusted).toBe(true);
    expect(result.verdict).toBe('需要修改');
    expect(result.adjustNote).toMatch(/^② 成立要至少 2 个独立来源.*；按各条件推出需要修改（模型提议 成立）$/);
    // the model's "没改" was for 成立: code writes what changed, and it is the revised statement
    expect(result.judgment.changed).toBe('只有 ① 成立，② 证据不足');
    expect(result.revisedStatement).toBe('只有 ① 成立，② 证据不足');
  });

  it('"改了什么" by code for the other verdicts it derives', () => {
    const notHeld = settleJudgment('H1', judgment({ verdict: '需要修改', conditions: conds('不成立', '不成立', ['E4'], ['E4']) as never, changed: '改成别的' }), evidence, keyed, planned);
    expect(notHeld.result).toMatchObject({ verdict: '不成立', judgment: { changed: '①② 不成立' } });
    const none = settleJudgment('H1', judgment({ verdict: '需要修改', conditions: conds('证据不足', '证据不足', [], []) as never, changed: '改成别的' }), evidence, keyed, planned);
    expect(none.result).toMatchObject({ verdict: '证据不足', judgment: { changed: '还判断不了，①② 缺证据' } });
    const noneHeld = settleJudgment('H1', judgment({ verdict: '需要修改', conditions: conds('不成立', '证据不足', ['E4'], []) as never, changed: '' }), evidence, keyed, planned);
    expect(noneHeld.result.judgment.changed).toBe('① 不成立，② 证据不足');
  });

  it('§9.5 on the whole turns a derived 成立 (an A refute nobody rebutted, aimed at no condition): 改了什么 names it', () => {
    const { result } = settleJudgment('H1', judgment({ verdict: '成立', conditions: conds('成立', '成立') as never, changed: '没改' }), evidence, keyed, planned);
    expect(result).toMatchObject({ verdict: '证据不足', adjusted: true, judgment: { changed: '还判断不了：x [E4]，没驳倒' } });
    expect(result.adjustNote).toMatch(/^按各条件推出成立，再按判断标准复核为证据不足（模型提议 成立）；存在同等级以上、未被驳倒的反证/);
  });

  it('the model left the conditions out, or numbered them otherwise: the old way, and why (research:conditions-fallback)', () => {
    const missing = settleJudgment('H1', judgment({ verdict: '需要修改', revised_statement: '只在受监管行业成立', revised_assertions: [{ text: 'a', keys: ['E1', 'E2'] }] as never }), evidence, keyed, planned);
    expect(missing.fallback).toBe('模型没有逐条判计划里的条件');
    expect(missing.result).toMatchObject({ verdict: '需要修改', revisedStatement: '只在受监管行业成立', conditions: [] });
    expect(missing.result.assertions).toHaveLength(1);
    const wrong = settleJudgment('H1', judgment({ verdict: '成立', conditions: [...conds('成立', '成立'), { n: 3, status: '成立', keys: [], note: '' }] as never }), evidence, keyed, planned);
    expect(wrong.fallback).toBe('模型逐条判的条件是 1、2、3，计划里要判的是 1、2，对不上');
    expect(wrong.result.conditions).toEqual([]);
  });

  describe('第 2 轮: a refute the 反证表 answered "不影响判断" (WS-A v5 H3-2)', () => {
    const row = (response: string, challenge = '说 AI PC 卖的是溢价价格'): Judgment['challenge_responses'][number] => ({ key: 'E4', challenge, response, effect: '不影响判断' });
    const settle = (responses: ReturnType<typeof row>[], c = conds('成立', '成立')) =>
      settleJudgment('H3-2', judgment({ verdict: '成立', conditions: c as never, changed: '没改', challenge_responses: responses }), evidence, keyed, planned).result;

    it('only "不影响" (no reason, or a reason pointing nowhere) still downgrades', () => {
      for (const response of ['不影响判断', '不影响 [E4]', '这条不影响我们的判断结论']) expect(settle([row(response)]).verdict).toBe('证据不足');
      expect(answeredRefutes({ challenge_responses: [row('不影响判断')] }, keyed, planned)).toEqual([]);
    });

    it('a reason pointing to other evidence, or to a plan condition, is answered: the card stays 成立', () => {
      for (const response of ['这是厂商一侧的说法，买方调研里没有为 AI 单独付钱的预算 [E2]', '厂商自己的说法，正落在条件(2)允许的范围里', '只是厂商口径，② 本来就允许这种说法']) {
        expect(settle([row(response)])).toMatchObject({ verdict: '成立', adjusted: false, adjustNote: '' });
      }
      expect(answeredRefutes({ challenge_responses: [row('厂商自己的说法，正落在条件(2)允许的范围里')] }, keyed, planned)).toEqual([core.ref]);
      // (3) states the judging standard: not a condition judged here, so it points nowhere
      expect(settle([row('厂商自己的说法，正落在条件(3)允许的范围里')]).verdict).toBe('证据不足');
      // "推翻了假设" is never answered, however it is argued
      expect(settle([{ ...row('厂商一侧的说法 [E2]'), effect: '推翻了假设' }]).verdict).toBe('证据不足');
    });

    it('a downgrade lands on the condition the refute is aimed at; the verdict is derived again', () => {
      // the row names ②
      const named = settle([row('不影响', '冲着 (2)：说买方愿为 AI 付溢价')]);
      expect(named.conditions.map((c) => c.status)).toEqual(['成立', '证据不足']);
      expect(named.conditions[1]).toMatchObject({ keys: ['E1', 'E3', 'E4'], adjusted: '有一条同等级以上的反证没驳倒（冲着 (2)：说买方愿为 AI 付溢价），改为证据不足' });
      expect(named).toMatchObject({ verdict: '需要修改', adjusted: true, revisedStatement: '只有 ① 成立，② 证据不足', judgment: { changed: '只有 ① 成立，② 证据不足' } });
      expect(named.adjustNote).toMatch(/^② 有一条同等级以上的反证没驳倒.*；按各条件推出需要修改（模型提议 成立）$/);
      // ① cites the refute among its keys
      const cited = settle([row('不影响')], conds('成立', '成立', ['E1', 'E2', 'E4']));
      expect(cited.conditions.map((c) => c.status)).toEqual(['证据不足', '成立']);
      expect(cited.verdict).toBe('需要修改');
    });
  });

  it('an older plan: nothing planned, no fallback logged, the model\'s verdict under §9.5 as before', () => {
    const { result, fallback } = settleJudgment('H1', judgment({ verdict: '成立' }), evidence, keyed, []);
    expect(fallback).toBeNull();
    expect(result.verdict).toBe('证据不足'); // a core A refute, not rebutted
  });
});
