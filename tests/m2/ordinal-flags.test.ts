/**
 * D-21-4 (h), M1's third walk-through: run 4 stopped at a draft on "这一行有数字但没有出处：- 修正假设：把论点 1 拆成两层，
 * 未经批准使用一层保留……" (bareNumbers took the 1 of "论点 1" for a quantity).
 *   1. an ordinal of the report's own parts (论点 N, 假设 N, 子问题 N, 第 N 条/层/步, H1-A2) is not a number: one rule
 *      (isOrdinal) in the self-check and the number check
 *   2. a number with no source in the text no longer blocks either: the repair rounds first, then number_flags, delivered
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeResearch } from '@/lib/research/execute';
import { summaryUpdateGaps, summaryUpdateNumberFlags } from '@/lib/research/followup';
import { isOrdinal, numbersIn } from '@/lib/research/number-check';
import { isNumberCheck, numberFlagsOf } from '@/lib/research/number-repair';
import { bareNumbers, checkNewLines, checkReportText } from '@/lib/research/selfcheck';
import { fakeWeb, scriptedModel, setup } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

/** The line as M1's run 4 wrote it (the self-check message keeps its first 80 characters). */
const M1_LINE = '- 修正假设：把论点 1 拆成两层，未经批准使用一层保留……';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe('1. ordinals are not numbers (one rule, both checks)', () => {
  it('M1 run 4: "论点 1" is not a bare number', () => {
    expect(bareNumbers(M1_LINE)).toEqual([]);
    expect(numbersIn(M1_LINE)).toEqual([]);
    expect(checkNewLines([M1_LINE]).filter((f) => f.code === 'uncited_number')).toEqual([]);
  });

  const ordinals = ['论点 1 拆成两层', '假设 2 不成立', '子问题 3 要问专家', '回应挑战 1、2 时', '第 2 层是审批', '第 1–2 步先做', '第 3 条规则', 'H1-A2 依赖它', '论点1和论点2'];
  const quantities = ['假设 3 个用户', '第 3 名的份额', '论点里 40 家企业', '子问题涉及 25% 的员工', '问题 2.5 倍', '发现 1,223 种在用工具', '问题 30 多家企业都有'];

  it.each(ordinals)('"%s": neither check counts it', (s) => {
    expect(bareNumbers(s)).toEqual([]);
    expect(numbersIn(s)).toEqual([]);
  });

  it.each(quantities.filter((s) => !s.startsWith('第')))('"%s": still a quantity in both checks', (s) => {
    expect(bareNumbers(s).length).toBeGreaterThan(0);
    expect(numbersIn(s).length).toBeGreaterThan(0);
  });

  it('"第 3 名" is a ranking, not an ordinal of the report: the self-check still asks for its source', () => {
    // (the number check never compared any "第 N" with the quote; that is unchanged)
    expect(bareNumbers('第 3 名的份额')).toEqual(['3']);
    expect(isOrdinal('第 ', '3', ' 名的份额')).toBe(false);
  });
});

describe('2. an uncited number in the text: repair first, then flagged, delivered', () => {
  const judge = (soWhat: string[]) => (k: { supports: string[] }) => ({
    verdict: '成立',
    rebutted: [],
    revised_statement: null,
    support_lines: [`IT 部门主导采购 [${k.supports[0]}]`],
    counter_lines: [],
    challenge_responses: [],
    reasoning: `IT 主导 [${k.supports[0]}]`,
    model_knowledge: [],
    so_what: soWhat,
    gaps: [],
    expert_questions: [],
  });

  it('every uncited_number is a number check (the text\'s too); the other checks are not', () => {
    expect(isNumberCheck({ code: 'uncited_number', message: '这一行有数字但没有出处：…' })).toBe(true);
    expect(isNumberCheck({ code: 'uncited_number', message: '推荐判断里这一行有数字但没有出处：…' })).toBe(true);
    for (const code of ['quote_mismatch', 'block_not_found', 'note_not_found', 'missing_quote', 'inference_cited', 'uncited_line', 'unknown_evidence_key', 'decision_quote_mismatch'] as const) expect(isNumberCheck({ code, message: '这一行有数字但没有出处' })).toBe(false);
  });

  it('the self-check and the new-line check give the flag its line and numbers', () => {
    const line = '- 修正假设：把论点 1 拆成两层，约 40 家企业已经试点';
    const [f] = checkNewLines([line]);
    expect(f).toMatchObject({ code: 'uncited_number', clause: line, numbers: ['40'] });
    expect(numberFlagsOf([f])).toEqual([{ check: 'uncited_number', text: line, numbers: ['40'] }]);
  });

  it('M1 run 4\'s line: delivered, nothing flagged', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const out = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel({ judge: judge([M1_LINE.slice(2)]) }).model, webClient: fakeWeb() });
    const report = await fx.vault.read(out.reportPath);
    expect(report.body).toContain('把论点 1 拆成两层');
    expect(out.delivered).toBe(true);
    expect(report.data.number_flags).toBeUndefined();
  });

  it('a number the repair cannot source: the repair round runs, then number_flags, delivered, and the page lists it', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const m = scriptedModel({ judge: judge(['修正假设：把论点 1 拆成两层，约 40 家企业已经试点']) });
    const out = await executeResearch({ ctx: fx.ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(out.reportPath);
    expect(m.tasks).toContain('repair');
    expect(out.delivered).toBe(true);
    expect(out.failedChecks).toEqual([]);
    expect(report.data.delivery).toBe('已交付');
    expect(report.data.number_flags).toEqual([expect.objectContaining({ check: 'uncited_number', numbers: ['40'], text: expect.stringContaining('约 40 家企业已经试点') })]);
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:number-flagged' && x.change.includes('40'))).toBe(true);
    const { ReportViewer } = await import('@/components/research/report-viewer');
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(createElement(ReportViewer, { markdown: report.body, citations: {} })).replace(/<!-- -->/g, '');
    expect(html).toContain('1 处数字没有出处');
    expect(html).toMatch(/data-testid="number-warning-uncited"[^>]*>正文 · 「[^」]*约 40 家企业已经试点/);
  });

  it('the same report still stays a draft on a check that is not a number heuristic', () => {
    const body = checkReportText('## Summary\n\n- 一句话答案：[E3] 说明了一切\n');
    expect(body.some((f) => f.code === 'unknown_evidence_key' && !isNumberCheck(f))).toBe(true);
  });

  it('a follow-up\'s new Summary 理由: its uncited number is a gap during the rounds, a flag after them', () => {
    const rec = { summary_update: { reason: '约 40 家企业已经试点', so_what: '' } } as Parameters<typeof summaryUpdateGaps>[0];
    const o = { label: 'H1', changed: true, keyed: new Map(), issuedKeys: new Set<string>(), body: '' };
    expect(summaryUpdateGaps(rec, o)).toEqual([expect.stringContaining('summary_update：这一行有数字但没有出处')]);
    expect(summaryUpdateGaps(rec, { ...o, numbers: false })).toEqual([]);
    expect(summaryUpdateNumberFlags(rec, o)).toEqual([expect.objectContaining({ code: 'uncited_number', numbers: ['40'] })]);
  });
});
