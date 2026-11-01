/**
 * inference_cited, M1's acceptance run 1 (WS-B 员工自带AI的程度, small run, 393 s): kept a draft by
 *   回应「资料说某一家企业称自己的流量全部走可信安全管道、因此没有影子 AI[^9]」
 * where "因此" retells the source's own "meaning there isn't a shadow". Two changes:
 *   1. an inference word does not count in quotation marks, when the response retells the row's challenge, or (因此 /
 *      所以 / 意味着) when the cited original states a consequence itself;
 *   2. what the repair rounds leave is flagged (inference_flags, research:inference-flagged, "⚠ 推论挂了脚注" on the
 *      page), not blocking — the same as the number checks.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/components/research/markdown-lite';
import { ReportViewer } from '@/components/research/report-viewer';
import { markInferenceFlags, markNumberFlags, responseProblems } from '@/lib/research/number-check';
import { inferenceFlagsOf, isFlagCheck, isNumberCheck } from '@/lib/research/number-repair';
import { resolveReportCitations } from '@/lib/research/citations';

vi.setConfig({ testTimeout: 60_000 });

// the row as run 1 wrote it, and the original [^9] cites
const RUN1_ROW =
  '| 有企业称全部流量都走可信安全管道、不存在影子 AI，挑战未批准使用是否普遍。 | 资料说某一家企业称自己的流量全部走可信安全管道、因此没有影子 AI[^9]。推断：这只是一个管控较严的单点自述，说明企业之间差异存在，但压不过另外两项大样本调研报告的比例。 | 推不翻 | [^9] |';
const RUN1_QUOTE = 'Everything goes through our trusted secure pipeline, meaning there isn’t a shadow.';

const table = (...rows: string[]) => ['### H1 员工自带', '', '- 反证和挑战（逐条回应）：', '', '| 挑战 | 回应 | 结论 | 出处 |', '|---|---|---|---|', ...rows].join('\n');
const inferences = (body: string, quotes: Record<string, string>) => responseProblems(body, new Map(Object.entries(quotes))).filter((p) => p.kind === 'inference_cited');

describe('which cited clauses are the author\'s inference', () => {
  it('run 1: the source says "meaning…", so "因此" is the source\'s word — not flagged', () => {
    expect(inferences(table(RUN1_ROW), { 9: RUN1_QUOTE })).toEqual([]);
  });

  it('the same clause against an original that states no consequence is still the author\'s inference', () => {
    expect(inferences(table(RUN1_ROW), { 9: 'Everything goes through our trusted secure pipeline.' })).toEqual([expect.objectContaining({ footnotes: ['9'], text: expect.stringContaining('因此没有影子 AI') })]);
  });

  it('inference words in quotation marks are someone else\'s', () => {
    const row = '| 有人说员工会绕开 IT | 资料把这种做法称为「因此必须封禁」的老路[^1] | 推不翻 | [^1] |';
    expect(inferences(table(row), { 1: 'the old road of banning everything' })).toEqual([]);
  });

  it('a response retelling its challenge keeps the challenge\'s words; the bare word alone is not enough', () => {
    const retold = '| 资料称 AI 支出因此转出 IT 预算 | 资料说 AI 支出因此转出 IT 预算[^1]；推断：只是一部分 | 推不翻 | [^1] |';
    expect(inferences(table(retold), { 1: 'AI spend is moving outside IT budgets.' })).toEqual([]);
    // the audit's true positive (C's d21 v3): the challenge says "论点假设", the response's "论点应写成" is the author's
    const own = '| CFO或CIO不能单独决定，论点假设的决策主体被削弱。 | 它否定的是单一决策人假设，不否定「没有量化收益就难过审」；修正后的论点应写成多方共同把关下的价值门槛。[^47] | 收窄 | [^52] |';
    expect(inferences(table(own), { 47: 'Decisions involve several stakeholders.' })).toHaveLength(1);
  });

  it('a 推断 label outside quotation marks always counts', () => {
    const row = '| 员工会绕开 | 推断：这说明 IT 能管住[^1] | 推不翻 | [^1] |';
    expect(inferences(table(row), { 1: 'IT therefore controls the fleet.' })).toHaveLength(1);
  });
});

describe('flagged, not blocking', () => {
  it('inference_cited is a flag check (not a number check); the flag keeps the clause and its footnotes', () => {
    const f = { code: 'inference_cited' as const, message: '回应「…」：脚注挂在了你自己的推论后面', clause: '资料说……因此员工绕不开 IT', footnotes: ['3'] };
    expect(isFlagCheck(f)).toBe(true);
    expect(isNumberCheck(f)).toBe(false);
    for (const code of ['quote_mismatch', 'missing_quote', 'block_not_found', 'decision_quote_mismatch', 'unanswered_challenge'] as const) expect(isFlagCheck({ code, message: 'x' })).toBe(false);
    expect(inferenceFlagsOf([f, f, { code: 'quote_mismatch', message: 'x' }])).toEqual([{ text: '资料说……因此员工绕不开 IT', footnotes: ['3'] }]);
  });

  it('the page marks the clause\'s markers [^n~]; a marker flagged for a number too gets both', () => {
    const body = table('| 员工会绕开 | 资料说 77% 的采购由 IT 主导，因此员工绕不开 IT[^3] | 推不翻 | [^3] |');
    const quotes = new Map([['3', 'IT leads most purchases.']]);
    const problems = responseProblems(body, quotes);
    const line = markInferenceFlags(body, problems).split('\n').at(-1)!;
    expect(line).toContain('员工绕不开 IT[^3~]');
    expect(line.endsWith('| [^3] |')).toBe(true); // the row's 出处 cell is left alone
    const both = markInferenceFlags(markNumberFlags(body, [{ line: 7, claim: 'H1', section: 'H1', text: '资料说 77% 的采购由 IT 主导，因此员工绕不开 IT', number: '77%', footnotes: ['3'] }]), problems);
    expect(both).toContain('[^3!~]');
    const nodes = parseMarkdown(both).flatMap((b) => (b.kind === 'table' ? b.rows.flat(2) : []));
    expect(nodes).toContainEqual({ kind: 'footnote', id: '3', numberFlag: true, inferenceFlag: true });
  });
});

describe('in a mock run', () => {
  it('a response whose footnote hangs after an inference: repaired first, then flagged (inference_flags, log, page tag), the report delivered', async () => {
    const { setup, scriptedModel, fakeWeb } = await import('./research-fixture');
    const { executeResearch } = await import('@/lib/research/execute');
    const { clearPageCache } = await import('@/lib/research/page-cache');
    clearPageCache();
    const fx = await setup({ approved: true });
    try {
      const judge = (k: { supports: string[]; refutes: string[] }) => ({
        verdict: '成立',
        rebutted: k.refutes,
        revised_statement: null,
        support_lines: [`IT 部门主导采购 [${k.supports[0]}]`],
        counter_lines: [],
        challenge_responses: k.refutes.map((c) => ({ key: c, challenge: '员工会绕开', response: `资料说 IT 部门主导采购，所以员工绕不开 IT [${k.supports[0]}]`, effect: '推不翻' })),
        reasoning: `IT 主导 [${k.supports[0]}]`,
        model_knowledge: [],
        so_what: [],
        gaps: [],
        expert_questions: [],
      });
      const m = scriptedModel({ judge }); // the repair returns the same response: nothing fixes it
      const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
      expect(m.tasks).toContain('repair');
      expect(r.delivered).toBe(true);
      expect(r.failedChecks).toEqual([]);
      const report = await fx.vault.read(r.reportPath);
      expect(report.data.delivery).toBe('已交付');
      expect(report.data.inference_flags).toEqual([expect.objectContaining({ text: expect.stringContaining('所以员工绕不开 IT'), footnotes: [expect.any(String)] })]);
      expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:inference-flagged' && x.change.includes('所以员工绕不开 IT'))).toBe(true);
      const citations = await resolveReportCitations(fx.vault, report.body, r.reportPath);
      const html = renderToString(createElement(ReportViewer, { markdown: report.body, citations })).replace(/<!-- -->/g, '');
      expect(html).toContain('data-testid="inference-warning-tag"');
      expect(html).toContain('⚠ 推论挂了脚注');
    } finally {
      await fx.cleanup();
    }
  });
});
