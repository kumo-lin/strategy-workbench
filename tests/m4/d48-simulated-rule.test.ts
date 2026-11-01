/**
 * D-48, the user's rule on simulated interviews ("这次参考模拟访谈，我不觉得是个错误"): the recommendation may cite one —
 * its footnote shows as usual (marked （模拟） on the page), the report is delivered, the run log says so
 * (research:simulated-in-recommendation). What does not change: a simulated interview is never an A/B source, and on
 * its own it never makes a condition 成立.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkCondition, summarizeEvidence, supportBar, type Evidence } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { RECOMMENDATION, fakeWeb, scriptedModel, setup } from '../m2/research-fixture';

const ev = (n: number, over: Partial<Evidence> = {}): Evidence => ({
  ref: `[[资料${n}#^c1]]`, path: `10_资料库/资料${n}.md`, block: 'c1', text: 't', quote: `原文 ${n}`, sourceName: `资料${n}`, publisher: `P${n}`, url: null,
  grade: 'A', origin: '网络', gradedBy: 'AI', published: null, claimId: 'C1', subQuestionId: 'C1-Q1', round: 'web1', stance: 'supports', reason: '', core: false, partial: false, ...over,
});
// even graded A by mistake, a simulated interview is not a source
const sim = (n: number) => ev(n, { ref: `[[访谈（模拟）#^e${n}]]`, block: `e${n}`, sourceName: '访谈（模拟）', publisher: `访谈 ${n}（模拟）`, sourceKind: 'expert', simulated: true, origin: '专家访谈' });

describe('a simulated interview is never an A/B source', () => {
  it('not among the supports, not the best grade, not past the 成立 bar', () => {
    const s = summarizeEvidence([sim(1), sim(2)]);
    expect(s.supports).toEqual([]);
    expect(s.bestSupportGrade).toBeNull();
    expect(supportBar([sim(1), sim(2)])).toEqual({ passed: false, basis: '没有资料证据支持' });
    // beside one real source it adds nothing: still 1 independent source
    expect(supportBar([sim(1), ev(3)])).toMatchObject({ passed: false, basis: '只有 1 个独立来源，最高 A 级' });
  });
});

describe('on simulated interviews alone, no condition is 成立', () => {
  const keyed = new Map([['E1', sim(1)], ['E2', sim(2)], ['E3', ev(3)], ['E4', ev(4, { grade: 'B' })]]);
  it('the model\'s 成立 on two interviews is checked down to 证据不足, saying why; two real sources keep it', () => {
    const c = checkCondition({ n: 1, status: '成立', keys: ['E1', 'E2'], note: '受访者都说 IT 拍板' }, keyed, new Set());
    expect(c.status).toBe('证据不足');
    expect(c.adjusted).toContain('没有资料证据支持');
    expect(checkCondition({ n: 1, status: '成立', keys: ['E1', 'E2', 'E3'], note: '' }, keyed, new Set()).status).toBe('证据不足');
    expect(checkCondition({ n: 1, status: '成立', keys: ['E3', 'E4'], note: '' }, keyed, new Set()).status).toBe('成立');
  });
});

describe('a recommendation citing a simulated interview', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup?.();
    cleanup = undefined;
  });

  it('is delivered, the footnote shown; the run log says it (research:simulated-in-recommendation)', async () => {
    vi.setConfig({ testTimeout: 90_000 });
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ expert: true });
    cleanup = fx.cleanup;
    let interview = '';
    const sm = scriptedModel({
      // the interview is the judge's challenge; the recommendation leans on it too (WS-A v8's 押自研 agent)
      judge: (k) => {
        interview = k.challenges[0] ?? k.refutes[0] ?? '';
        return {
          verdict: '证据不足', rebutted: [], revised_statement: null,
          support_lines: k.supports.slice(0, 1).map((e) => `IT 部门主导采购 [${e}]`),
          counter_lines: [],
          challenge_responses: [...k.refutes, ...k.challenges].map((c) => ({ key: c, challenge: '管得太死员工会绕开', response: `资料说 IT 部门主导采购 [${k.supports[0]}]；推断：只在管理严格的企业成立`, effect: '收窄' })),
          reasoning: `IT 主导采购 [${k.supports[0]}]`, model_knowledge: [], so_what: ['先打管理严格的大企业'], gaps: [], expert_questions: [],
        };
      },
      recommendation: () => ({ ...RECOMMENDATION, alternatives: [RECOMMENDATION.alternatives[0], RECOMMENDATION.alternatives[1], { ...RECOMMENDATION.alternatives[2], why_not: `做事之后的审计追责链条还不清楚 [${interview}]` }] }),
    });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    expect(interview).toMatch(/^E\d+$/);
    expect(r.delivered).toBe(true);
    expect(r.failedChecks.join('\n')).not.toMatch(/模拟访谈/);
    const body = (await fx.vault.read(r.reportPath)).body;
    const row = body.split('\n').find((l) => l.startsWith('| 其他选项（换一种拿法：收购）'))!;
    const n = /审计追责链条还不清楚\[\^(\d+)\]/.exec(row)?.[1];
    expect(n).toBeDefined();
    expect(body).toMatch(new RegExp(`^\\[\\^${n}\\]: .*访谈（模拟）#\\^e\\d+`, 'm'));
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.filter((l) => l.action === 'research:simulated-in-recommendation').map((l) => l.change)).toEqual([expect.stringContaining(`推荐判断引用了模拟访谈 [${interview}]`)]);
  });
});
