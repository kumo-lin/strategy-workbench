/** D-61 steps 1–3: the evaluator's gate, the revision split, the budget, and the whole judgment with a scripted model. */
import { describe, expect, it } from 'vitest';
import { BudgetError, Meter, metered } from '@/lib/workplan/compose/budget';
import { checkEvaluation, holisticJudgment, openLine, splitRevision } from '@/lib/workplan/compose/judgment';
import { newState, type EvalAnswer } from '@/lib/workplan/compose/types';
import { scriptedModel } from './fake-model';

const DRAFT = '核心问题是谁在采购里有否决权。竞争假设：IT 能管才买单；价格排第一；业务部门自带预算绕开 IT。关键的不确定性：采购标准里可管理性与价格的先后。最值得先验证采购文件里把什么排在前面，这一步成本最低，也最能区分前两个假设。容易被忽略的解释：企业换机主要是因为系统到期，不是为了 AI，所以 AI 带来的溢价本身可能并不存在，需要把换机原因和付费意愿分开看，分别找采购记录、预算科目和续约合同里的证据来区分。再看续约合同和预算科目里有没有为管理能力单独列支，把换机的原因和付费的意愿分开记录。';
const ok = (q: number): EvalAnswer => ({ q, verdict: '没问题', target: '', counterexample: '草案已经把竞争假设和关键不确定性分开写了', fix: '' });
const allOk = [1, 2, 3, 4, 5, 6].map(ok);
const bad = (over: Partial<EvalAnswer> = {}): EvalAnswer => ({
  q: 4,
  verdict: '有问题',
  target: '采购文件里把什么排在前面',
  counterexample: '采购文件常常只写技术规格，不排优先级，这一条就查不出区分',
  fix: '改成先看三家大客户招标书的评分表里可管理性和价格各占几分',
  ...over,
});
const withoutQ4 = allOk.filter((a) => a.q !== 4);

describe('checkEvaluation', () => {
  it('accepts a concrete problem tied to a phrase of the draft, and six answered questions', () => {
    const r = checkEvaluation([bad(), ...withoutQ4], DRAFT);
    expect(r.problems).toEqual([]);
    expect(r.valid).toHaveLength(6);
  });

  it('throws back a target that is not in the draft', () => {
    const r = checkEvaluation([bad({ target: '草案里根本没有的一句话' }), ...withoutQ4], DRAFT);
    expect(r.valid.some((a) => a.verdict === '有问题')).toBe(false);
    expect(r.problems.join('')).toContain('不是草案里的原话');
    expect(r.problems.join('')).toContain('第 4 问');
  });

  it('throws back vague feedback: an empty counterexample and a fix that only says "be more specific"', () => {
    expect(checkEvaluation([bad({ counterexample: '可能不够全面' }), ...withoutQ4], DRAFT).problems.join('')).toContain('反例太空');
    expect(checkEvaluation([bad({ fix: '应进一步具体化，更加深入' }), ...withoutQ4], DRAFT).problems.join('')).toContain('改法太空');
    expect(checkEvaluation([bad({ fix: '完善' }), ...withoutQ4], DRAFT).problems.join('')).toContain('改法太空');
  });

  it('throws back a "没问题" without a reason, and a question nobody answered', () => {
    expect(checkEvaluation([{ ...ok(1), counterexample: '好' }, ...allOk.slice(1)], DRAFT).problems.join('')).toContain('没写为什么站得住');
    const r = checkEvaluation(withoutQ4, DRAFT);
    expect(r.problems).toEqual(['第 4 问（关键假设有没有区分度：什么证据能推翻它）还没有合格的回答。']);
  });
});

describe('splitRevision', () => {
  const issues = [bad(), bad({ q: 5, target: '这一步成本最低' })];
  it('cuts the closing section off the text and maps the numbers back to the findings', () => {
    const r = splitRevision(`${DRAFT}\n\n## 没能改动的意见\n[2] 用户点名要查\n[9] 不存在的编号\n无`, issues);
    expect(r.revised).toBe(DRAFT);
    expect(r.unresolved).toEqual([{ issue: issues[1], why: '用户点名要查' }]);
  });
  it('a revision without the section has nothing unresolved', () => {
    expect(splitRevision(DRAFT, issues)).toEqual({ revised: DRAFT, unresolved: [] });
  });
  it('openLine is one plain sentence with the question in words, not a number', () => {
    expect(openLine(issues[1], '用户点名要查。')).toBe('评估提醒：有没有"验证成功了也不改变决策"的研究——「这一步成本最低」，采购文件常常只写技术规格，不排优先级，这一条就查不出区分；这一版没能改动：用户点名要查。');
  });
});

describe('the budget', () => {
  it('counts the usage of every call, refuses a call past a hard limit, and tells the optional steps when to stop', async () => {
    const meter = new Meter({ hardTokens: 5, hardMs: 1_000_000, softTokens: 2, softMs: 1_000_000 });
    const m = scriptedModel({ workplan_judgment: 'x' });
    const model = metered(m.model, meter) as typeof m.model;
    const call = () => model.doGenerate({ prompt: [{ role: 'system', content: '任务：整体判断' }, { role: 'user', content: [{ type: 'text', text: 'q' }] }] });
    expect(meter.canSpend()).toBe(true);
    await call(); // 2 tokens in the fake usage
    expect(meter.tokens).toBe(2);
    expect(meter.canSpend()).toBe(false);
    await call();
    await call(); // 6 now
    await expect(call()).rejects.toBeInstanceOf(BudgetError);
  });

  it('the clock counts too', () => {
    let now = 0;
    const meter = new Meter({ hardTokens: 1e9, hardMs: 100, softTokens: 1e9, softMs: 50 }, () => now);
    now = 60;
    expect(meter.canSpend()).toBe(false);
    expect(() => meter.check()).not.toThrow();
    now = 100;
    expect(() => meter.check()).toThrow(BudgetError);
  });
});

describe('holisticJudgment', () => {
  const deps = (m: ReturnType<typeof scriptedModel>, meter = new Meter()) => ({ model: m.model, meter, perspectives: [] });

  it('retries the evaluator once with the problems named, then keeps what passed the gate', async () => {
    const m = scriptedModel({ workplan_judgment: DRAFT, workplan_revise: DRAFT, workplan_eval: (n: number) => ({ answers: n === 0 ? [bad({ target: '不在草案里的话' }), ...withoutQ4] : [bad(), ...withoutQ4] }) });
    const r = await holisticJudgment(newState(), deps(m));
    expect(m.asked.workplan_eval).toBe(2);
    expect(r?.judgment.evaluation.filter((a) => a.verdict === '有问题')).toHaveLength(1);
  });

  it('skips the evaluation and the revision, and says so, when the run is already past the soft budget', async () => {
    const m = scriptedModel({ workplan_judgment: DRAFT });
    const r = await holisticJudgment(newState(), deps(m, new Meter({ hardTokens: 1e9, hardMs: 1e9, softTokens: 0, softMs: 1e9 })));
    expect(m.asked.workplan_eval).toBeUndefined();
    expect(r?.judgment.revised).toBe(DRAFT);
    expect(r?.judgment.open[0]).toContain('没有经过独立评估');
  });

  it('a revision that lost most of the draft is not a revision: the draft stays and the findings stay open', async () => {
    const m = scriptedModel({ workplan_judgment: DRAFT, workplan_eval: { answers: [bad(), ...withoutQ4] }, workplan_revise: '太短了' });
    const r = await holisticJudgment(newState(), deps(m));
    expect(m.asked.workplan_revise).toBe(2);
    expect(r?.judgment.revised).toBe(DRAFT);
    expect(r?.judgment.open).toHaveLength(1);
    expect(r?.judgment.open[0]).toContain('修订没有成功');
  });

  it('asks the evaluator in a fresh context: only the contract and the draft, no pack ids, no drafting prompt', async () => {
    const seen: string[] = [];
    const m = scriptedModel({ workplan_judgment: DRAFT, workplan_eval: allOk && { answers: allOk } });
    const orig = m.model.doGenerate.bind(m.model);
    m.model.doGenerate = (async (o: Parameters<typeof orig>[0]) => {
      seen.push(JSON.stringify(o.prompt));
      return orig(o);
    }) as typeof m.model.doGenerate;
    const s = { ...newState(), pack: [{ id: 'K7', kind: 'reference' as const, title: '某调研', path: 'x.md', gist: '一句话' }] };
    await holisticJudgment(s, deps(m));
    const evalCall = seen.find((t) => t.includes('战略评估'))!;
    expect(evalCall).toContain('## 草案');
    expect(evalCall).not.toContain('K7');
    expect(evalCall).not.toContain('某调研');
    expect(evalCall).not.toContain('整体判断草案');
  });
});
