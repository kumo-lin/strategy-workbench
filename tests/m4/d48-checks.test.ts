/**
 * D-48: a card's ①②③ lines are the approved plan's conditions, word for word, and a status written by code; only the
 * note after the status is the model's claim. 改了什么 is not checked either. selfcheck (uncited_number) and the number
 * check (a number not in the original its clause cites) pass the rest; the Summary table's new 回答 column is checked.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/lib/vault/frontmatter';
import { checkReportText } from '@/lib/research/selfcheck';
import { conditionNote, footnoteDefs, numberMismatches } from '@/lib/research/number-check';

const V5 = parseMarkdown(readFileSync('tests/fixtures/d47/报告 v5（样例）.md', 'utf8')).body;

const card = (lines: string[], table: string[] = []) =>
  [
    '## Summary',
    '- 核心问题：企业会为什么付钱？',
    '- 各假设的提议判断：',
    '',
    '| 子问题 | 假设 | 提议的判断 | 回答 |',
    '|---|---|---|---|',
    ...table,
    '',
    '## Q1 谁出钱？',
    '',
    '### 假设 H1：IT 出钱。',
    ...lines,
    '',
    '## 引文出处',
    '[^1]: “22% said AI budgets are managed centrally by IT.”（C 级，网络）[[资料#^c1]]',
  ].join('\n');
const uncited = (body: string) => checkReportText(body).filter((f) => f.code === 'uncited_number').map((f) => f.excerpt);
const mismatched = (body: string) => numberMismatches(body, footnoteDefs(body)).map((m) => m.number);

describe('conditionNote', () => {
  it('the note after the status, footnotes kept; "" with none; null for any other line', () => {
    expect(conditionNote('  - ① 至少 2 条互相独立的支持证据 → 成立[^3][^5]')).toBe('[^3][^5]');
    expect(conditionNote('  - ② 拍板的是 IT → 不成立：IT 集中管的只占 22%[^1]')).toBe('IT 集中管的只占 22%[^1]');
    expect(conditionNote('  - ② 拍板的是 IT → 证据不足：（系统复核：模型判不成立，推翻它的反证只有 1 条 C 级）预算多在 IT 之外[^5]')).toBe('预算多在 IT 之外[^5]');
    expect(conditionNote('  - ③ 有 30% 的企业被否 → 证据不足')).toBe('');
    expect(conditionNote('  - 银行保险监管要求建准入机制[^2]')).toBeNull();
    expect(conditionNote('- 提议的判断：需要修改（② 不成立）')).toBeNull();
  });
});

describe('selfcheck: uncited_number', () => {
  it("the plan's words and code's 系统复核 are not checked; a number in the note without a footnote is", () => {
    const body = card([
      '- 当时的假设，逐条对照：',
      '  - ① 至少 2 条互相独立的支持证据，其中至少 1 条 A/B 级 → 成立[^1]',
      '  - ② 30% 以上的采购由 IT 拍板 → 证据不足：（系统复核：模型判不成立，推翻它的反证只有 1 条 C 级）',
      '  - ③ 有 5 家以上企业把管不住的产品否掉 → 不成立：只有 12 家里的 3 家这样做',
    ]);
    expect(uncited(body)).toEqual(['- ③ 有 5 家以上企业把管不住的产品否掉 → 不成立：只有 12 家里的 3 家这样做']);
  });

  it('改了什么 is not checked; 回答, Q2-1 的回答 (the model\'s since D-48) and 理由 are', () => {
    const body = card(['- 改了什么：改成 IT 只出 2 成的钱', '- 回答：IT 只出 22% 的钱', '- Q2-1 的回答：只有 30% 的企业这样做', '- 理由：', '  - 20% 由业务线自管']);
    expect(uncited(body)).toEqual(['- 回答：IT 只出 22% 的钱', '- Q2-1 的回答：只有 30% 的企业这样做', '- 20% 由业务线自管']);
  });

  it("the Summary table's 回答 column is checked; the verdict column still is", () => {
    const body = card([], ['| Q1 | H1 IT 出钱 | 需要修改（② 证据不足） | IT 集中管的只占 22% |', '| Q2 | H2 管不住出局 | 成立 | 只在受监管行业[^1] |']);
    expect(uncited(body)).toEqual(['| Q1 | H1 IT 出钱 | 需要修改（② 证据不足） | IT 集中管的只占 22% |']);
  });
});

describe('number check: a number must be in the original its clause cites', () => {
  it("the plan's words before the status are not checked against the footnote; the note is", () => {
    const body = card([
      '  - ① 30% 以上的采购由 IT 拍板 → 成立[^1]',
      '  - ② 拍板的是 IT → 不成立：IT 集中管的只占 22%[^1]',
      '  - ③ 拍板的是 IT → 不成立：IT 集中管的只占 25%[^1]',
    ]);
    expect(mismatched(body)).toEqual(['25%']);
  });

  it("改了什么 is not checked; the Summary table's 回答 column is", () => {
    const body = card(['- 改了什么：改成 IT 只出 40% 的钱[^1]'], ['| Q1 | H1 IT 出钱 | 需要修改 | IT 只管 30%[^1] |']);
    expect(mismatched(body)).toEqual(['30%']);
  });
});

describe('the D-48 sample (tests/fixtures/d47/报告 v5（样例）.md)', () => {
  it('passes both: no uncited number, no number missing from its original', () => {
    expect(uncited(V5)).toEqual([]);
    expect(mismatched(V5)).toEqual([]);
  });
});
