/**
 * D-56 ⑦: the evaluation helpers of the three-gate check, measured against C's 81 hand-checked pairs (the script's
 * fixture). Pure functions only: the clause a footnote ends, the per-label tally, and the few lines the script prints.
 */
import { describe, expect, it } from 'vitest';
import type { Fit } from '@/lib/research/citation-fit';
import { clauseOf, formatSummary, summarizeEval, type EvalRow } from '@/lib/research/citation-verify-eval';

describe('clauseOf', () => {
  it('the clause the footnote ends, its leading comma taken out', () => {
    expect(clauseOf('钱多半不在软件科目[^9]，硬件无 AI 单列条目[^10]，获批要绑可量化收益[^11]。', '[^10]')).toBe('硬件无 AI 单列条目');
  });

  it('a leading label is stripped', () => {
    expect(clauseOf('依据：受监管行业把准入写成硬要求[^5][^15]；', '[^15]')).toBe('受监管行业把准入写成硬要求');
  });

  it('a footnote not in the sentence: the sentence without its marks', () => {
    expect(clauseOf('钱多半不在软件科目[^9]，硬件无 AI 单列条目[^10]。', '[^99]')).toBe('钱多半不在软件科目，硬件无 AI 单列条目。');
  });
});

const rowsOf = (label: Fit, n: number, verified = 0): EvalRow[] => Array.from({ length: n }, (_, i) => ({ label, verified: i < verified, entity: false, deepseek: null, kimi: null }));
const rows = [...rowsOf('挂错', 2), ...rowsOf('部分', 10, 1), ...rowsOf('撑得住', 5, 3)];

describe('summarizeEval', () => {
  it('per-label counts and rates; 挂错 0, 部分 10%, 撑得住 60% meets all', () => {
    const s = summarizeEval(rows);
    expect(s.byLabel['挂错']).toMatchObject({ n: 2, verified: 0, rate: 0 });
    expect(s.byLabel['部分']).toMatchObject({ n: 10, verified: 1, rate: 0.1 });
    expect(s.byLabel['撑得住']).toMatchObject({ n: 5, verified: 3, rate: 0.6 });
    expect(s.meets).toEqual({ wrongNone: true, partialAtMost10: true, holdsAtLeast60: true, all: true });
  });

  it('one more 挂错 verified: wrongNone and all false; the gates count too', () => {
    const s = summarizeEval([...rows, { label: '挂错', verified: true, entity: true, deepseek: '撑得住', kimi: '撑得住' }]);
    expect(s.byLabel['挂错']).toMatchObject({ n: 3, verified: 1, entity: 1, deepseek撑得住: 1, kimi撑得住: 1 });
    expect(s.meets.wrongNone).toBe(false);
    expect(s.meets.all).toBe(false);
  });

  it('a label with no rows: n 0, rate 0', () => {
    expect(summarizeEval(rowsOf('部分', 1, 1)).byLabel['挂错']).toEqual({ n: 0, verified: 0, rate: 0, entity: 0, deepseek撑得住: 0, kimi撑得住: 0 });
  });
});

describe('formatSummary', () => {
  it('one line per label, the time by report file name, the acceptance line', () => {
    const out = formatSummary(summarizeEval(rows), {
      total: 30.5,
      byReport: [
        ['20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑（问题树）/报告 v6.md', 12.3],
        ['20_项目/个人AI战略/W5 联想的位置/调查/联想的位置/报告 v4.md', 18.2],
      ],
    });
    expect(out).toContain('挂错 2 对');
    expect(out).toContain('✓ 0');
    expect(out).toContain('验收');
    expect(out).toContain('报告 v6.md');
    expect(out).toContain('报告 v4.md');
    expect(out).not.toContain('20_项目');
  });
});
