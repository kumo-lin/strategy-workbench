/** 2.11 ⑤ stop rule, §9.5 verdict rules (enforced in code), independence. */
import { describe, expect, it } from 'vitest';
import { baselineVerdict, enforceVerdict, expertAnswerRelevant, independenceKey, registrableDomain, stopReason, type Evidence } from '@/lib/research/evidence';

let n = 0;
function ev(over: Partial<Evidence>): Evidence {
  n++;
  return {
    ref: `[[s${n}#^c1]]`,
    path: `10_资料库/s${n}.md`,
    block: 'c1',
    text: '「x」— 位置：p',
    quote: 'x',
    sourceName: `s${n}`,
    publisher: `Pub${n}`,
    url: `https://pub${n}-site.com/a`,
    grade: 'B',
    origin: '网络',
    gradedBy: 'AI',
    published: '2026-01-01',
    claimId: 'C1',
    subQuestionId: 'C1-Q1',
    round: 'web1',
    stance: 'supports',
    reason: '',
    core: false,
    partial: false,
    ...over,
  };
}

describe('independence (§9.5)', () => {
  it('keys web sources by registrable domain, preset sources by publisher', () => {
    expect(registrableDomain('https://news.cn.reuters.com/x')).toBe('reuters.com');
    expect(registrableDomain('https://www.stats.gov.cn/x')).toBe('stats.gov.cn');
    expect(registrableDomain('https://www.bbc.co.uk/x')).toBe('bbc.co.uk');
    expect(independenceKey({ url: null, publisher: ' IDC ' })).toBe('publisher:idc');
  });
  it('two pages of the same publisher are not independent', () => {
    const a = ev({ url: 'https://www.idc.com/a', publisher: 'IDC' });
    const b = ev({ url: 'https://blog.idc.com/b', publisher: 'IDC Blog' });
    expect(baselineVerdict([a, b])).toBe('证据不足');
    expect(baselineVerdict([a, ev({})])).toBe('成立');
  });
});

describe('verdict rules (§9.5)', () => {
  it('成立 needs 2 independent supports incl. one A/B and no unrebutted equal-or-higher refute', () => {
    const s1 = ev({ grade: 'B' });
    const s2 = ev({ grade: 'C' });
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, [s1, s2])).toMatchObject({ verdict: '成立', adjusted: false });
    // only C-grade supports
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, [ev({ grade: 'C' }), ev({ grade: 'C' })])).toMatchObject({ verdict: '证据不足', adjusted: true });
    // one independent support only
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, [s1])).toMatchObject({ verdict: '证据不足', adjusted: true });
    // an equal-grade refute that is not rebutted blocks it …
    const r = ev({ stance: 'refutes', grade: 'B' });
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, [s1, s2, r])).toMatchObject({ verdict: '证据不足', adjusted: true });
    // … unless it was rebutted; a lower-grade refute never blocks
    expect(enforceVerdict({ verdict: '成立', rebutted: [r.ref] }, [s1, s2, r]).verdict).toBe('成立');
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, [s1, s2, ev({ stance: 'refutes', grade: 'C' })]).verdict).toBe('成立');
  });

  it('不成立 needs an A/B refute that overturns the core premise', () => {
    expect(enforceVerdict({ verdict: '不成立', rebutted: [] }, [ev({ stance: 'refutes', grade: 'A', core: true })]).verdict).toBe('不成立');
    expect(enforceVerdict({ verdict: '不成立', rebutted: [] }, [ev({ stance: 'refutes', grade: 'A', core: false })])).toMatchObject({ verdict: '证据不足', adjusted: true });
    expect(enforceVerdict({ verdict: '不成立', rebutted: [] }, [ev({ stance: 'refutes', grade: 'C', core: true })])).toMatchObject({ verdict: '证据不足', adjusted: true });
  });

  it('需要修改 needs some evidence and a revised statement', () => {
    expect(enforceVerdict({ verdict: '需要修改', rebutted: [], revisedStatement: '只在大企业成立' }, [ev({})]).verdict).toBe('需要修改');
    expect(enforceVerdict({ verdict: '需要修改', rebutted: [], revisedStatement: '' }, [ev({})]).verdict).toBe('证据不足');
    expect(enforceVerdict({ verdict: '需要修改', rebutted: [], revisedStatement: 'x' }, []).verdict).toBe('证据不足');
  });

  it('no evidence → 证据不足, never adjusted', () => {
    expect(enforceVerdict({ verdict: '证据不足', rebutted: [] }, [])).toMatchObject({ verdict: '证据不足', adjusted: false });
  });
});

describe('stop rule (§9.6)', () => {
  const base = { webRoundsDone: 0, maxWebRounds: 2, newEvidenceByRound: [] as number[], searchesLeft: 5 };
  it('continues while undecided with rounds and budget left', () => {
    expect(stopReason({ ...base, evidence: [ev({})] })).toBeNull();
  });
  it('stops as soon as §9.5 can decide 成立 or 不成立', () => {
    expect(stopReason({ ...base, evidence: [ev({}), ev({})] })).toBe('decidable');
    expect(stopReason({ ...base, evidence: [ev({ stance: 'refutes', grade: 'A', core: true })] })).toBe('decidable');
  });
  it('stops after two web rounds in a row that found nothing new (D63 §4)', () => {
    expect(stopReason({ ...base, webRoundsDone: 2, newEvidenceByRound: [0, 0], evidence: [ev({})] })).toBe('no_new_evidence');
  });
  it('stops after the maximum number of web rounds, and when the search budget is gone', () => {
    expect(stopReason({ ...base, webRoundsDone: 2, newEvidenceByRound: [0, 1], evidence: [ev({})] })).toBe('rounds_exhausted');
    expect(stopReason({ ...base, searchesLeft: 0, evidence: [ev({})] })).toBe('budget_exhausted');
  });
});

describe('expert input is not a source (D-18, PRD §7 rule 9)', () => {
  const expert = (over: Partial<Evidence>) => ev({ sourceKind: 'expert', origin: '专家访谈', grade: 'C', publisher: '专家访谈（模拟）', url: null, simulated: true, ...over });

  it('a simulated interview can never make a 成立, however many agree: it lifts the claim to 访谈支持 at most (D63 §3)', () => {
    const e = [ev({ grade: 'B' }), expert({}), expert({ ref: '[[x#^e2]]' })];
    const v = enforceVerdict({ verdict: '成立', rebutted: [] }, e);
    expect(v).toMatchObject({ verdict: '访谈支持', adjusted: true });
    expect(baselineVerdict(e)).toBe('访谈支持');
  });

  it('but it counts as a challenge: it can lead to 需要修改, and it never makes a 不成立 (not A/B)', () => {
    const challenge = expert({ stance: 'refutes', core: true });
    expect(enforceVerdict({ verdict: '不成立', rebutted: [] }, [challenge])).toMatchObject({ verdict: '证据不足', adjusted: true });
    expect(enforceVerdict({ verdict: '需要修改', rebutted: [], revisedStatement: '只在大企业成立' }, [ev({ grade: 'B' }), challenge]).verdict).toBe('需要修改');
  });

  it('a real (non-simulated) interview is not public material either: with one B source, or with another interview, it reaches 访谈支持, not 成立 (D63 §3)', () => {
    const real = expert({ simulated: false });
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, [ev({ grade: 'B' }), real]).verdict).toBe('访谈支持'); // one public source only
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, [real, expert({ simulated: false, publisher: '另一位专家', ref: '[[y#^e1]]' })]).verdict).toBe('访谈支持'); // no public source at all
  });
});

describe('interview answers must be about the claim (C’s v3: a budget answer hung under the manageability claim)', () => {
  const about = ['IT 可管理性决定企业是否采购 AI PC', '专家的反面意见：管得太死会不会让员工绕开 IT'];
  it('keeps answers that share words with the claim or the sub-question', () => {
    expect(expertAnswerRelevant('反面意见：管得太死，员工会绕过去，采购并不总是 IT 说了算。', ...about)).toBe(true);
    expect(expertAnswerRelevant('可管理性是门槛，不是加分项；IT 部门一票否决采购。', ...about)).toBe(true);
  });
  it('drops an answer about something else', () => {
    expect(expertAnswerRelevant('预算每年 11 月定，由 CFO 批，AI 工具先走试点额度。', ...about)).toBe(false);
  });
});
