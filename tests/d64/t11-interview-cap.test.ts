/** D-64 T11: the verdict ladder of CONTRACT-CHANGE-D63 §3 — an interview lifts a claim to 访谈支持, never to 成立. */
import { describe, expect, it } from 'vitest';
import { baselineVerdict, enforceVerdict, keyQuestionLabel, keyQuestionVerdict, verdictLabel, type Evidence } from '@/lib/research/evidence';

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
const interview = (over: Partial<Evidence> = {}) =>
  ev({ sourceKind: 'expert', origin: '专家访谈', grade: 'C', publisher: `访谈${n}`, url: null, simulated: false, ...over });

describe('T11 verdict ladder', () => {
  it('1. two independent A-grade public sources → 成立 (regression)', () => {
    const e = [ev({ grade: 'A' }), ev({ grade: 'A' })];
    expect(baselineVerdict(e)).toBe('成立');
    expect(enforceVerdict({ verdict: '成立', rebutted: [] }, e)).toMatchObject({ verdict: '成立', adjusted: false });
  });

  it('2. one C-grade public source plus one real interview → 访谈支持', () => {
    expect(baselineVerdict([ev({ grade: 'C' }), interview()])).toBe('访谈支持');
  });

  it('3. only a simulated interview supports → 访谈支持, labelled （模拟访谈）', () => {
    const e = [interview({ simulated: true })];
    expect(baselineVerdict(e)).toBe('访谈支持');
    expect(verdictLabel('访谈支持', e)).toBe('访谈支持（模拟访谈）');
    expect(verdictLabel('访谈支持', [interview({ simulated: false })])).toBe('访谈支持');
  });

  it('4. the model proposes 成立 on the evidence of 2 → 访谈支持, the note says the sample is small', () => {
    const v = enforceVerdict({ verdict: '成立', rebutted: [] }, [ev({ grade: 'C' }), interview()]);
    expect(v.verdict).toBe('访谈支持');
    expect(v.adjusted).toBe(true);
    expect(v.note).toContain('访谈样本少');
  });

  it('5. an unrebutted A-grade core refute plus interview support → 不成立', () => {
    const e = [ev({ grade: 'A', stance: 'refutes', core: true }), interview()];
    expect(baselineVerdict(e)).toBe('不成立');
  });

  it('6. no support → 证据不足', () => {
    expect(baselineVerdict([])).toBe('证据不足');
    expect(baselineVerdict([ev({ stance: 'irrelevant' })])).toBe('证据不足');
  });

  it('7. a key question takes its best claim; 需要修改 shows as 部分支持', () => {
    expect(keyQuestionVerdict(['证据不足', '需要修改'])).toBe('需要修改');
    expect(keyQuestionLabel('需要修改')).toBe('部分支持');
    expect(keyQuestionVerdict(['不成立', '访谈支持', '证据不足'])).toBe('访谈支持');
    expect(keyQuestionVerdict(['访谈支持', '成立'])).toBe('成立');
  });

  it('a proposed 访谈支持 without any interview support falls to 证据不足', () => {
    expect(enforceVerdict({ verdict: '访谈支持', rebutted: [] }, [ev({ grade: 'C' })]).verdict).toBe('证据不足');
    expect(enforceVerdict({ verdict: '访谈支持', rebutted: [] }, [interview()])).toMatchObject({ verdict: '访谈支持', adjusted: false });
  });
});
