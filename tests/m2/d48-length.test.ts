/**
 * D-48: 字数 of the short parts of a question-tree report. Counted without [^n], [E#], whitespace and "（推断）"; what is
 * over the limit goes to the model once to be rewritten ([E#] kept, no new number); what is still over is flagged
 * (length_flags), the report is delivered. A mocked full run also covers the conditions judged one by one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { acceptableRewrite, applyRewrites, lengthFlags, lengthItems, lengthOf } from '@/lib/research/length-check';
import type { ClaimResult } from '@/lib/research/judge';
import { judgmentSchema, summarySchema } from '@/lib/research/schemas';
import { clearPageCache } from '@/lib/research/page-cache';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = undefined;
});

describe('字数', () => {
  it('footnotes, keys, whitespace and "（推断）" do not count; 汉字, letters, digits and punctuation count one each', () => {
    expect(lengthOf('IT 管准入[^3]，钱由多方出 [E2][E5]（推断）')).toBe('IT管准入，钱由多方出'.length);
    expect(lengthOf('AI 预算 22% 由 IT 集中管')).toBe(13);
    expect(lengthOf('收不到：价差都能用内存、屏幕、显卡解释。')).toBe(20);
  });

  it('a rewrite keeps every [E#], adds none, adds no number', () => {
    expect(acceptableRewrite('调研里 22% 由 IT 集中管 [E2]，20% 由业务线自管 [E3]', 'IT 集中管 22% [E2]，业务线 20% [E3]')).toBe(true);
    expect(acceptableRewrite('IT 集中管 22% [E2] [E3]', 'IT 集中管 22% [E2]')).toBe(false);
    expect(acceptableRewrite('IT 集中管 [E2]', 'IT 集中管 [E2][E9]')).toBe(false);
    expect(acceptableRewrite('IT 集中管约两成 [E2]', 'IT 集中管 22% [E2]')).toBe(false);
  });
});

describe('the parts with a limit, and the rewrite put back', () => {
  const judgment = judgmentSchema.parse({
    verdict: '需要修改', revised_statement: '改成 IT 管准入、钱由多方出，IT 集中出的只占约两成', reasoning: 'r', support_lines: [], counter_lines: [], challenge_responses: [], model_knowledge: [], so_what: ['所以联想卖管理栈要对准 IT'], gaps: [], expert_questions: [],
    conditions: [{ n: 1, status: '成立', keys: ['E1'], note: '准入由 IT 把关' }], answer: 'IT 管能不能进 [E2]', reasons: ['准入在 IT [E1]'], changed: '改成 IT 管准入、钱由多方出，IT 集中出的只占约两成', short_statement: 'IT 一手包办',
  });
  const r = { claim: { id: 'C1', question: '谁决定买？' }, label: 'H1', judgment, revisedStatement: judgment.changed, conditions: [{ n: 1, label: '①', text: 't', status: '成立', keys: ['E1'], note: '准入由 IT 把关' }] } as unknown as ClaimResult;
  const summary = summarySchema.parse({ so_what: '付钱的是软件席位', results: ['H1 → x'], answers: [{ id: 'Q1', answer: 'IT 管准入' }], split_basis: '按一笔采购的三个要素拆' });

  it('a question-tree hypothesis: its notes, 改了什么, answer, reasons, So What, short name; the Summary parts', () => {
    expect(lengthItems([r], summary).map((i) => `${i.where}:${i.limit}`)).toEqual(['H1 · ①:40', 'H1 · 改了什么:40', 'H1 · 回答:50', 'H1 · 理由 1:40', 'H1 · So What:50', 'H1 · 短名:20', 'Summary · 回答（一句话）:50', 'Summary · 各子问题的回答 Q1:50', 'Summary · 问题树:40']);
    expect(lengthItems([{ ...r, claim: { id: 'C1' } } as unknown as ClaimResult], summary)).toEqual([]); // an older plan
    expect(lengthFlags([r], summary)).toEqual([]);
  });

  it('第 2 轮: a recommendation cell counts only what comes before "依据："; where is "推荐 · 做什么", the lists item by item', () => {
    const long = '在受监管行业的大中型企业投标时，把机队管理、身份管理和日志审计整套能力作为准入材料交给采购和 IT 两方评审，并在服务合同里写明交付范围';
    const rec = {
      decision_answer: '提议：先押管理层。依据：IT 管准入 [E1]',
      directive_response: '',
      action: `${long}。依据：监管要求身份管理 [E3]`,
      scale: '先试点几家客户',
      metrics: ['试点客户把管理列为采购条件。依据：……', `${long}。依据：x`],
      alternatives: [{ dimension: 'layer', option: '押端侧算力', why_not: `${long}。依据：没有溢价证据` }],
      change_if: ['价格成了首要条件'],
    } as unknown as NonNullable<typeof summary.recommendation>;
    const withRec = { ...summary, recommendation: rec };
    expect(lengthFlags([r], withRec).map((f) => [f.where, f.length])).toEqual([
      ['推荐 · 做什么', lengthOf(long)],
      ['推荐 · 看什么指标 2', lengthOf(long)],
      ['推荐 · 其他选项 1', lengthOf(long)],
    ]);
    expect(lengthFlags([r], withRec)[0].text).toBe(long);
    // an older plan's report: not counted
    expect(lengthFlags([{ ...r, claim: { id: 'C1' } } as unknown as ClaimResult], withRec)).toEqual([]);
  });

  it('a rewritten 改了什么 is also the revised statement', () => {
    const out = applyRewrites([r], summary, new Map([['C1:changed', '改成 IT 管准入、钱由多方出'], ['C1:answer', 'IT 管准入 [E2]'], ['summary:answer:Q1', 'IT 管']]));
    expect(out.results[0]).toMatchObject({ revisedStatement: '改成 IT 管准入、钱由多方出', judgment: { changed: '改成 IT 管准入、钱由多方出', revised_statement: '改成 IT 管准入、钱由多方出', answer: 'IT 管准入 [E2]', reasons: ['准入在 IT [E1]'] } });
    expect(out.summary.answers).toEqual([{ id: 'Q1', answer: 'IT 管' }]);
    expect(out.summary.split_basis).toBe('按一笔采购的三个要素拆');
  });
});

describe('a mocked full run of a question tree', () => {
  const LONG_ANSWER = (k: string) => `在有统一机队管理的大中型企业里，员工端个人 AI 工具进不进机队由 IT 把关准入，但钱并不只从 IT 预算出，而是由多方分担 [${k}]`;

  it('conditions judged one by one decide the verdict; the long answer is rewritten, a rewrite that drops its key is not taken and the reason is flagged', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 2 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c, i) => ({
      ...c,
      question: ['谁决定买？', '按什么放行？'][i],
      parent: null,
      conditions: i === 0 ? ['采购由 IT 牵头', '预算由 IT 出', '至少 2 条互相独立的支持证据，其中至少 1 条 A/B 级'] : c.conditions,
    }));
    data.mece_check = '两道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });

    const asked: number[][] = [];
    const m = scriptedModel({
      judge: ({ supports, refutes, conditions }) => {
        asked.push(conditions);
        const [k1, k2] = supports;
        return {
          verdict: conditions.length ? '需要修改' : '成立',
          rebutted: refutes,
          revised_statement: null,
          support_lines: [`IT 部门主导采购 [${k1}]`],
          counter_lines: refutes.length ? [] : ['已专门检索反证，没有找到 A/B 级的反证'],
          challenge_responses: refutes.map((k) => ({ key: k, challenge: '说员工会绕开管理', response: `不否定 IT 的决策角色 [${k1}]`, effect: '不影响判断' })),
          reasoning: `准入在 IT [${k1}]`,
          model_knowledge: [],
          so_what: ['所以联想先打 IT 管理场景'],
          gaps: [],
          expert_questions: [],
          ...(conditions.length
            ? {
                conditions: [
                  { n: 1, status: '成立', keys: supports, note: '' },
                  { n: 2, status: '证据不足', keys: [], note: '没有找到预算归属的证据' },
                ],
                changed: '改成 IT 牵头采购，预算归属还没证实',
                answer: LONG_ANSWER(k1),
                reasons: [`在有统一机队管理、员工人数较多的大中型企业里，多家互相独立的来源都说采购由 IT 部门牵头并且把关准入 [${k1}][${k2}]`, `准入在 IT [${k1}]`],
                short_statement: 'IT 一手包办',
              }
            : {}),
        };
      },
      shorten: (items) => items.map((i) => (i.id.endsWith(':answer') ? { id: i.id, text: `IT 把关准入，钱由多方出 [${/E\d+/.exec(i.text)![0]}]` } : { id: i.id, text: '多家独立来源都说采购由 IT 牵头' })),
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const r = await executeResearch({ ctx, mode: 'full', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(r.reportPath);
    const log = await fx.vault.readLog(fx.ctx.logPath);

    // ③ states the judging standard: not asked; C2 is asked its one condition
    expect(asked).toEqual([[1, 2], [1]]);
    expect(r.claims.find((c) => c.id === 'C1')).toMatchObject({ verdict: '需要修改', adjusted: false });
    expect(report.data.verdicts_proposed).toMatchObject({ C1: '需要修改' });
    expect(r.failedChecks).toEqual([]);
    expect(r.delivered).toBe(true);
    expect(m.tasks).toContain('shorten');
    expect(m.tasks.filter((t) => t === 'shorten')).toHaveLength(1);
    expect(log.some((x) => x.action === 'research:length-rewrite')).toBe(true);
    expect(log.some((x) => x.action === 'research:length-rewrite-rejected' && x.change.includes('H1 · 理由 1'))).toBe(true);
    // H2 answered with the same card (its one condition asked, two answered: judged the old way, see below)
    expect(report.data.length_flags).toEqual([expect.objectContaining({ where: 'H1 · 理由 1', limit: 40, length: 49 }), expect.objectContaining({ where: 'H2 · 理由 1' })]);
    expect((report.data.length_flags as { text: string }[])[0].text).not.toMatch(/E\d+/);
    // C2's answer judged conditions 1 and 2, the plan has one: the old way, logged, delivered all the same
    expect(log.some((x) => x.action === 'research:conditions-fallback' && x.change.startsWith('C2：'))).toBe(true);
    expect(log.some((x) => x.action === 'research:conditions-fallback' && x.change.startsWith('C1：'))).toBe(false);
  });
});
