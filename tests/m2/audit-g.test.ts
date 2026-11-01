/**
 * D-21-4 (g): the remaining false positives of M4's offline audit (共享笔记 M4_自检误报审计.md), on its example
 * sentences from the real-model reports (tests/fixtures/audit-g):
 *   A. a 回应 repeating its challenge: its numbers and its 「」 words may come from the row's challenge cell or from
 *      the original of any footnote on the row (numberMismatches and responseProblems alike); otherwise 「」 stays strict
 *   B. "每投入 1 美元" (the source: "for every dollar invested"): that 1 is the unit
 *   C. the plan's own years ("2026–2027 年" in the claim statements) are not uncited numbers
 *   D. the "自检没有通过" banner code writes at the top of a draft is not the report's text
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blankDraftBanner, challengeRows, footnoteDefs, numberMismatches, numbersIn, numbersInQuote, responseProblems, numberInQuote } from '@/lib/research/number-check';
import { checkReportText, hasBareNumber, planYears } from '@/lib/research/selfcheck';

const read = (f: string) => readFileSync(path.join('tests/fixtures/audit-g', f), 'utf8').replace(/^<!--.*-->\n/, '');
/** footnote id → the quote written in its definition. */
const shown = (body: string) => new Map([...footnoteDefs(body)].map(([n, d]) => [n, /“([\s\S]*)”（/.exec(d)?.[1] ?? d]));

describe('A. a 回应 may repeat its challenge', () => {
  const A = read('a-challenge-quote.md');

  it('d21b v3: 「部分」 is the challenge\'s own word ("涨价部分源于……"): no quote_not_in_source', () => {
    const rows = challengeRows(A.split('\n'));
    const [row] = [...rows.values()];
    expect(row.challenge).toContain('部分');
    expect(row.response).toContain('该说法只说「部分」');
    expect(responseProblems(A, shown(A))).toEqual([]);
  });

  it('「」 words found nowhere on the row are still caught (the rule stays strict otherwise)', () => {
    const made = A.replace('该说法只说「部分」', '该说法只说「结构性缺口」');
    expect(responseProblems(made, shown(made))).toEqual([expect.objectContaining({ kind: 'quote_not_in_source', quoted: '结构性缺口' })]);
  });

  it('a number of the challenge repeated in the 回应 passes; a number neither in the challenge nor in any footnote of the row does not', () => {
    const md = ['| 挑战 | 回应 | 结论 | 出处 |', '|---|---|---|---|', '| 19% 把缺乏清晰商业案例视为最大顾虑 | 19% 与其他材料中安全治理占 48% 的比例口径不同[^57] | 推不翻 | [^69] |', '', '[^57]: “cited by 48% of organisations”（C 级）[[x#^c3]]', '[^69]: “19% cite the lack of a clear business case”（C 级）[[y#^c1]]'].join('\n');
    expect(numberMismatches(md, shown(md))).toEqual([]);
    const other = md.replace('19% 与其他材料', '23% 与其他材料');
    expect(numberMismatches(other, shown(other)).map((m) => m.number)).toEqual(['23%']);
  });

  it('a follow-up\'s list form counts too: "- 挑战[^n] → 收窄：回应"', () => {
    const md = ['- 逐条回应挑战：', '    - 19% 把缺乏商业案例视为最大顾虑[^69] → 收窄：资料说安全治理占 48%，和 19% 口径不同[^57]', '', '[^57]: “cited by 48% of organisations”（C 级）[[x#^c3]]', '[^69]: “19% cite the lack of a clear business case”（C 级）[[y#^c1]]'].join('\n');
    expect(numberMismatches(md, shown(md))).toEqual([]);
  });
});

describe('B. the 1 of "每投入 1 美元" is the unit', () => {
  const B = read('b-every-dollar.md');

  it('d21 v3: the sentence and its 关键数字 cell both pass against "returns of $2.79 for every dollar invested"', () => {
    expect(numberMismatches(B, shown(B))).toEqual([]);
  });

  it('the source side: "every / each / per + unit" or "每 + 单位" stands for a 1', () => {
    const one = numbersIn('1 美元')[0];
    expect(numberInQuote(one, numbersInQuote('returns of $2.79 for every dollar invested'))).toBe(true);
    expect(numberInQuote(one, numbersInQuote('$30 per user each month'))).toBe(true);
    expect(numberInQuote(one, numbersInQuote('returns of $2.79 on investment'))).toBe(false);
  });

  it('the report side: "每投入 1 美元" is not a bare number; "1 家企业" still is', () => {
    expect(hasBareNumber('部分组织预计每投入 1 美元可回报')).toBe(false);
    expect(hasBareNumber('只有 1 家企业这样做')).toBe(true);
    expect(hasBareNumber('每投入 2 美元')).toBe(true);
  });
});

describe('C. the plan\'s own years are not uncited numbers', () => {
  const C = read('c-plan-years.md');

  it('vault-v4 v4: 2026–2027 comes from the claim statements; the revised hypothesis repeating it is not flagged', () => {
    expect([...planYears(C)].sort()).toEqual(['2026', '2027']);
    const line = C.split('\n').find((l) => l.startsWith('- 修正后的假设（v4）'))!;
    expect(hasBareNumber(line)).toBe(true); // without the plan: a year is data
    expect(hasBareNumber(line, { planYears: planYears(C) })).toBe(false);
    // (the fixture keeps no footnote definitions, so only that line is looked at)
    expect(checkReportText(C, []).filter((f) => f.code === 'uncited_number' && f.excerpt?.startsWith('- 修正后的假设'))).toEqual([]);
  });

  it('a year the plan never states is still flagged', () => {
    const md = C.replace('是 2026–2027 年大中型企业', '是 2028 年大中型企业');
    expect(checkReportText(md, []).filter((f) => f.code === 'uncited_number' && f.excerpt?.startsWith('- 修正后的假设')).map((f) => f.numbers)).toEqual([['2028']]);
  });
});

describe('D. the draft banner is not the report\'s text', () => {
  const D = read('d-draft-banner.md');

  it('M4\'s S0 draft: no uncited_number / unknown_evidence_key from the banner\'s "[E4] 的原文…500…"', () => {
    // (the fixture keeps no footnote definitions: only what comes from the banner is looked at)
    const fromBanner = (f: { code: string; excerpt?: string }) => f.code === 'unknown_evidence_key' || f.excerpt?.startsWith('>');
    expect(checkReportText(D, [], new Set(['E4', 'E10'])).filter(fromBanner)).toEqual([]);
    // the same lines as report text would be caught
    const asText = D.replace(/^> ⚠ 自检没有通过，这份报告\*\*没有交付\*\*.*$/m, '> 说明');
    expect(checkReportText(asText, [], new Set(['E4', 'E10'])).some((f) => f.code === 'unknown_evidence_key')).toBe(true);
  });

  it('blanked, not removed: the line numbers stay (the page marks flags by line)', () => {
    const out = blankDraftBanner(D);
    expect(out.split('\n')).toHaveLength(D.split('\n').length);
    expect(out).not.toContain('自检没有通过');
    expect(out).toContain('## Summary');
    expect(blankDraftBanner('## Summary\n> 引用块\n')).toBe('## Summary\n> 引用块\n');
  });
});
