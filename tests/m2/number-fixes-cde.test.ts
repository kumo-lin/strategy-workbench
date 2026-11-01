/**
 * D-21-4 (c) (d) (e): three ways the number rules stopped a live run at a draft, on the real sentences.
 *   (c) M4's S0 small run (WS-B 员工自带AI的程度): the recommendation's 量级 put "500 人…2000 名员工" after [^1][^2]
 *       and before [^4], so the numbers were checked against [^4]; the repair was even told to cite "$500 million".
 *   (d) W5: the code-written "依赖待验证断言 H1-A4「…25.1%…」" in 对决策的回答 counted as an uncited number.
 *   (e) W5 and M4: "Intune / Agent 365" in 做什么 counted as an uncited number (selfcheck had no product-name rule).
 * Fixtures: tests/fixtures/s0-w5-numbers (the rows as the runs wrote them, the real source notes).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixCarriedNumbers } from '@/lib/research/carried-numbers';
import type { Evidence } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import type { ClaimResult } from '@/lib/research/judge';
import { isNameNumber, numberMismatches, numbersIn, numbersInQuote } from '@/lib/research/number-check';
import { footnoteQuotes, numberFailures, sameMagnitude } from '@/lib/research/number-repair';
import { checkReportText, hasBareNumber } from '@/lib/research/selfcheck';
import { claimBlocksOf, loadSourceInfo } from '@/lib/research/sources';
import { createVault, type Vault } from '@/lib/vault';
import { fakeWeb, RECOMMENDATION, scriptedModel, setup } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

const FX = 'tests/fixtures/s0-w5-numbers';
const read = (f: string) => readFileSync(path.join(FX, f), 'utf8').replace(/^<!--.*-->\n/, '');
const M4 = read('m4-s0-small.md');
const [W5_ANSWER, W5_ACTION] = read('w5-rec-rows.md').trimEnd().split('\n');
const M4_ACTION = M4.split('\n').find((l) => l.startsWith('| 做什么 |'))!;
const M4_SCALE = M4.split('\n').find((l) => l.startsWith('| 量级 |'))!;
const REPORT = '20_项目/个人AI战略/WS-B 用户/调查/员工自带AI的程度/报告 v1.md';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function m4Vault(): Promise<Vault> {
  const root = await mkdtemp(path.join(tmpdir(), 'sw-cde-'));
  cleanup = () => rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, '10_资料库'), { recursive: true });
  for (const f of readdirSync(path.join(FX, 'sources'))) await writeFile(path.join(root, '10_资料库', f), readFileSync(path.join(FX, 'sources', f)));
  await mkdir(path.join(root, path.dirname(REPORT)), { recursive: true });
  await writeFile(path.join(root, REPORT), `---\nid: rep\ntype: report\n---\n\n${M4}`);
  return createVault(root);
}

describe('(e) a number right after an English product name is a name, in both checks', () => {
  it('W5 and M4 做什么: "Intune / Agent 365" is not a bare number (the rows had no other digit)', () => {
    expect(hasBareNumber('身份与智能体配置沿用微软生态（Intune / Agent 365）')).toBe(false);
    expect(hasBareNumber(W5_ACTION)).toBe(false);
    expect(hasBareNumber(M4_ACTION)).toBe(false);
    expect(numbersIn(W5_ACTION)).toEqual([]);
    expect(numbersIn(M4_ACTION)).toEqual([]);
  });

  it.each([
    ['Windows 11 停服推动换机', false],
    ['Microsoft 365 Copilot 的席位', false],
    ['Copilot+ PC 和 Agent 365', false],
    ['用 GPT4 和 Win11 测', false],
    ['覆盖 30 家企业', true],
    ['Copilot 3 个功能', true], // a count word after it: a quantity
    ['Agent 365 有 3 项能力', true],
    ['份额升到25.1%', true],
    ['IDC 预计 18.3% 的涨幅', true],
  ])('%s → bare number %s, and the number check agrees', (text, bare) => {
    expect(hasBareNumber(text)).toBe(bare);
    expect(numbersIn(text).length > 0).toBe(bare);
  });

  it('isNameNumber is the one rule both use', () => {
    expect(isNameNumber('（Intune / Agent ', '365', '）')).toBe(true);
    expect(isNameNumber('Copilot ', '3', ' 个功能')).toBe(false);
    expect(isNameNumber('Windows ', '11', '')).toBe(true);
    expect(isNameNumber('增长 ', '11', '%')).toBe(false);
  });
});

describe('(d) the assertion quote code writes after 依赖待验证断言 is not an uncited number', () => {
  it('W5 对决策的回答: its only digits are in "依赖待验证断言 H1-A4「…25.1%…」"', () => {
    expect(W5_ANSWER).toContain('依赖待验证断言 H1-A4「端侧不是可以放弃的一层：联想 AI PC 全球市场份额升到25.1%');
    expect(hasBareNumber(W5_ANSWER)).toBe(false);
    // the same cell with a number of its own is still caught
    expect(hasBareNumber(W5_ANSWER.replace('明年把', '明年用 30 家试点把'))).toBe(true);
  });

  it('a whole W5-like report: neither row gives uncited_number any more', () => {
    const body = ['## Summary', '', '- AI 的推荐判断（提议，待你拍板）：', '', '| | 提议 |', '|---|---|', W5_ANSWER, W5_ACTION, '', '以上全部是 AI 提议', ''].join('\n');
    expect(checkReportText(body, []).filter((f) => f.code === 'uncited_number')).toEqual([]);
  });
});

describe('(c) a year in the recommendation is the proposal\'s time point, as in the number check', () => {
  const RUN2 = read('s0-run2-action.md').trimEnd();

  it('the real-model rerun\'s 做什么: "2026 年内进入商用产品线" (and Agent 365) is not an uncited number in the recommendation', () => {
    expect(RUN2).toContain('2026 年内进入商用产品线');
    expect(hasBareNumber(RUN2, { timePoints: true })).toBe(false);
    expect(hasBareNumber(RUN2)).toBe(true); // outside the recommendation a year is data
    const body = ['## Summary', '', '- AI 的推荐判断（提议，待你拍板）：', '', '| | 提议 |', '|---|---|', RUN2, '', '以上全部是 AI 提议', ''].join('\n');
    expect(checkReportText(body, []).filter((f) => f.code === 'uncited_number')).toEqual([]);
  });

  it('still caught: a quantity with a count word in the recommendation, and an uncited year in a claim about the world', () => {
    expect(hasBareNumber('先在 30 家大客户落地', { timePoints: true })).toBe(true);
    expect(hasBareNumber('覆盖 2000 名员工', { timePoints: true })).toBe(true);
    const body = ['## Summary', '', '- 一句话答案：AI PC 普及推迟到 2028 年', '', '- AI 的推荐判断（提议，待你拍板）：', '', '| | 提议 |', '|---|---|', RUN2, ''].join('\n');
    expect(checkReportText(body, []).filter((f) => f.code === 'uncited_number').map((f) => f.excerpt)).toEqual(['- 一句话答案：AI PC 普及推迟到 2028 年']);
  });
});

describe('(c) a recommendation number in the wrong clause', () => {
  it('the rule finds M4\'s two: 500 and 2000 checked against [^4] (88% only), though [^2] on the same line has both', async () => {
    const vault = await m4Vault();
    const ms = numberMismatches(M4, await footnoteQuotes(vault, M4, REPORT));
    expect(ms.map((m) => `${m.number}@[^${m.footnotes.join(',')}]`)).toEqual(['500@[^4]', '2000@[^4]']);
  });

  it('magnitudes must agree when looking for an original: 500 人 is not "$500 million", 3000 万 is not "$3,000"', () => {
    const t = (s: string) => numbersIn(s)[0];
    expect(sameMagnitude(t('500 人'), numbersInQuote('companies with a minimum annual revenue of $500 million'))).toBe(false);
    expect(sameMagnitude(t('500 人'), numbersInQuote('2,000 workers at companies with more than 500 employees'))).toBe(true);
    expect(sameMagnitude(t('2000 名'), numbersInQuote('The survey of 2,000 workers'))).toBe(true);
    expect(sameMagnitude(t('3000 万'), numbersInQuote('$1,500-$3,000/month'))).toBe(false);
    expect(sameMagnitude(t('3000 万'), numbersInQuote('more than 30 million paid seats'))).toBe(true);
  });

  it('the repair is told where the number is: in [E2] on the same line, put [E2] right after it (not "cite $500 million")', async () => {
    const vault = await m4Vault();
    const draft = async (block: string) => {
      const info = (await loadSourceInfo(vault, `10_资料库/${block.split('#')[0]}.md`))!;
      const [d] = await claimBlocksOf(vault, info, new Set([block.split('#^')[1]]));
      return { ...d, claimId: 'C1', subQuestionId: 'C1-Q1', round: 'kb', stance: 'supports', reason: '', core: false, partial: false } as Evidence;
    };
    const keyed = new Map([
      ['E1', await draft('CIO.com 2026-01 BlackFog影子AI调查#^c1')],
      ['E2', await draft('CIO.com 2026-01 BlackFog影子AI调查#^c2')],
      ['E4', await draft('PagerDuty 2026-06 影子AI调查#^c2')],
    ]);
    const fails = await numberFailures({ vault, log: async () => {}, results: [{ keyed } as unknown as ClaimResult] }, M4, REPORT);
    expect(fails).toHaveLength(2);
    for (const f of fails) {
      expect(f.message).toMatch(/^推荐判断里/); // goes to the recommendation repair round
      expect(f.message).toContain('这个数字在同一行引用的 [E2] 的原文里');
      expect(f.message).toContain('把 [E2] 紧跟在这个数字所在的半句后面');
      expect(f.message).not.toContain('$500 million');
    }
  });

  it('when the repair rounds still leave it, code places it: [^2] joins [^4] after the clause (the 88% keeps its [^4])', async () => {
    const vault = await m4Vault();
    const r = await fixCarriedNumbers({ vault, log: async () => {}, fromPath: REPORT, vPrev: 1, what: '正文' }, M4);
    expect(r.unresolved).toEqual([]);
    const row = r.body.split('\n').find((l) => l.startsWith('| 量级 |'))!;
    expect(row).toContain('的样本口径（500 人以上企业的 2000 名员工）和[^4]、[^2] 的 88% 外流比例看');
    expect(row.replace('和[^4]、[^2] 的', '和[^4] 的')).toBe(M4_SCALE); // nothing else in the row changed
    expect(numberMismatches(r.body, await footnoteQuotes(vault, r.body, REPORT))).toEqual([]);
    expect(r.fixes[0].note).toContain('正文「的样本口径（500 人以上企业的 2000 名员工）和」');
  });
});

describe('(c) in a run: a number the recommendation repair cannot fix no longer leaves the report a draft', () => {
  it('the scripted recommendation keeps "37%" (in no original) through both repair rounds: code rewrites the clause, the report is delivered', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const rec = { ...RECOMMENDATION, action: `${RECOMMENDATION.action}，先覆盖 37% 的机队 [E1]` };
    const m = scriptedModel({ recommendation: rec, reword: () => '先覆盖一部分机队' });
    const out = await executeResearch({ ctx: fx.ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(out.reportPath);
    expect(m.tasks.filter((t) => t === 'recommend:repair').length).toBeGreaterThanOrEqual(1); // the repair round was tried first
    expect(m.tasks).toContain('number-carried');
    expect(out.delivered).toBe(true);
    const row = report.body.split('\n').find((l) => l.startsWith('| 做什么 |'))!;
    expect(row).toContain('先覆盖一部分机队[^');
    expect(row).not.toContain('37%');
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((r) => r.action === 'research:number-carried' && r.change.includes('37%'))).toBe(true);
  });
});

describe('(f) the number checks (and inference_cited) flag after the repair; every other check still blocks', () => {
  it('number_not_in_quote and uncited_number are the number checks (D-21-4 h: the text\'s uncited_number too)', async () => {
    const { isNumberCheck } = await import('@/lib/research/number-repair');
    expect(isNumberCheck({ code: 'number_not_in_quote', message: 'x' })).toBe(true);
    expect(isNumberCheck({ code: 'uncited_number', message: '推荐判断里这一行有数字但没有出处：…' })).toBe(true);
    expect(isNumberCheck({ code: 'uncited_number', message: '这一行有数字但没有出处：…' })).toBe(true); // flagged too since (h)
    for (const code of ['quote_mismatch', 'block_not_found', 'note_not_found', 'missing_quote', 'inference_cited', 'uncited_line', 'decision_quote_mismatch'] as const) expect(isNumberCheck({ code, message: '推荐判断里…' })).toBe(false);
  });

  it('the recommendation\'s uncited number: delivered with number_flags, and the page lists it', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const rec = { ...RECOMMENDATION, action: `${RECOMMENDATION.action}，先在 30 家大客户落地` };
    const out = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel({ recommendation: rec }).model, webClient: fakeWeb() });
    const report = await fx.vault.read(out.reportPath);
    expect(out.delivered).toBe(true);
    expect(report.data.number_flags).toEqual([expect.objectContaining({ check: 'uncited_number', numbers: ['30'] })]);
    const { ReportViewer } = await import('@/components/research/report-viewer');
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(createElement(ReportViewer, { markdown: report.body, citations: {} })).replace(/<!-- -->/g, '');
    expect(html).toContain('1 处数字没有出处');
    expect(html).toContain('推荐判断 · 「');
    expect(html).toContain('data-testid="number-warning-uncited"');
  });

  it('a quote that no longer matches its block still keeps the report a draft (the number rule changed nothing there)', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const { writeFileSync, readFileSync: readSync } = await import('node:fs');
    const note = path.join(fx.root, '10_资料库/资料甲.md');
    // once the evidence is in the report, the source block changes under it: check_citations must fail
    const m = scriptedModel({
      onPrompt: (p) => {
        if (p.includes('写报告最前面的 Summary')) writeFileSync(note, readSync(note, 'utf8').replace('IT 可管理性是企业采购 AI PC 的首要考量。', '资料原文已经改了。'));
      },
    });
    const out = await executeResearch({ ctx: fx.ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    expect(out.delivered).toBe(false);
    expect(out.failedChecks.join('\n')).toMatch(/引号里的原文和资料里的那一块对不上/);
  });

  it('a 回应 with its footnote after the inference is flagged too (inference_flags, after M1\'s acceptance run 1), beside a bad number', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const judge = (k: { supports: string[]; refutes: string[] }) => ({
      verdict: '成立',
      rebutted: k.refutes,
      revised_statement: null,
      support_lines: [`IT 部门主导了 77% 的采购 [${k.supports[0]}]`],
      counter_lines: [],
      challenge_responses: k.refutes.map((c) => ({ key: c, challenge: '员工会绕开', response: `所以论点推不翻 [${k.supports[0]}]`, effect: '推不翻' })),
      reasoning: `IT 主导 [${k.supports[0]}]`,
      model_knowledge: [],
      so_what: [],
      gaps: [],
      expert_questions: [],
    });
    const out = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel({ judge, reword: (c) => c }).model, webClient: fakeWeb() });
    const report = await fx.vault.read(out.reportPath);
    expect(out.delivered).toBe(true);
    expect(out.failedChecks).toEqual([]);
    expect(report.data.inference_flags).toEqual([expect.objectContaining({ text: expect.stringContaining('所以论点推不翻') })]);
    expect(report.data.number_flags).toEqual([expect.objectContaining({ numbers: ['77%'] })]);
  });
});
