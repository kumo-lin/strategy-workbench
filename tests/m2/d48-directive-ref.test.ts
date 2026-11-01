/**
 * M1 验收 5, run 3: a draft at the demo. "怎么回应高层指示" cited no [M#]: the 依据 may not use the directive (round 2),
 * code takes an [M#] out of the 依据 (round 5 (a)), and directiveGaps asks for one. Code now adds the directive's key to
 * the conclusion. And the Summary repair, which failed as JSON, no longer carries the recommendation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { directiveGaps, type DirectiveRef } from '@/lib/research/directives';
import { directivesOutOfBasis, executeResearch, repair, withDirectiveRef } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { summarySchema, type Recommendation } from '@/lib/research/schemas';
import { fakeWeb, RECOMMENDATION, scriptedModel, setup } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

const directives = [
  { key: 'M1', kind: '会议', name: '2026-10-16 高层周会（模拟）', quote: '重点看 IT 能不能管', link: '[[会议#^m1]]' },
  { key: 'W1', kind: '决定', name: 'W1决定', quote: '按受控 agent 定义', link: '[[W1决定]]' },
] as DirectiveRef[];
/** Run 3's cell, as the model wrote it (its footnotes [E#] / [W1] before rendering). */
const RUN3 = '支持：IT 能不能管确实是重点，员工自带 AI 已经过三成 [E1][E2]，管控压力是现实的。修正一处：管理只是准入，不是溢价 [E3]；按 [W1] 的受控 agent 定义，管的是 agent 而不是整机';
const rec = (directive_response: string) => ({ ...RECOMMENDATION, directive_response }) as unknown as Recommendation;

describe('the directive row cites the directive (code)', () => {
  it('run 3\'s cell: [M1] after its 支持; the self-check passes', () => {
    expect(directiveGaps(rec(RUN3), directives)).toEqual(['“怎么回应高层指示”没有引用高层指示的原块（写成 [M1] 这样的编号）']);
    const { cell, added } = withDirectiveRef(RUN3, directives);
    expect(added).toEqual(['M1']);
    expect(cell).toBe(`支持[M1]：${RUN3.slice('支持：'.length)}`);
    expect(directiveGaps(rec(cell), directives)).toEqual([]);
  });

  it('a conclusion without 支持 / 修正 / 推翻 first: "针对高层指示[M1]：" in front; one citing it already, or no directive: as it was', () => {
    expect(withDirectiveRef('IT 管准入，但只在受监管行业 [E3]', directives).cell).toBe('针对高层指示[M1]：IT 管准入，但只在受监管行业 [E3]');
    expect(withDirectiveRef('修正 [M1]：只在受监管行业', directives)).toEqual({ cell: '修正 [M1]：只在受监管行业', added: [] });
    expect(withDirectiveRef(RUN3, directives.filter((d) => d.kind !== '会议'))).toEqual({ cell: RUN3, added: [] });
  });

  it('the key it adds is in the conclusion: the 依据 clean-up leaves it', () => {
    const cell = withDirectiveRef('支持：IT 能不能管是重点 [E1]。依据：[M1] 说的三层 [E2]', directives).cell;
    expect(cell).toBe('支持：IT 能不能管是重点 [E1]。依据：[M1] 说的三层 [E2]'); // [M1] cited (in the 依据): nothing added here
    const cleaned = directivesOutOfBasis(cell);
    expect(cleaned).toContain('[M1]');
    expect(directiveGaps(rec(cleaned), directives)).toEqual([]);
    const added = withDirectiveRef(directivesOutOfBasis('支持：IT 能不能管是重点 [E1]。依据：监管要求 [E2]'), directives).cell;
    expect(directivesOutOfBasis(added)).toBe(added);
  });
});

describe('the Summary repair leaves the recommendation out', () => {
  it('not sent to the model, kept as it was (a reply that drops change_if no longer fails the repair)', async () => {
    const prompts: string[] = [];
    const run = {
      signal: undefined,
      log: vi.fn(async () => {}),
      llm: vi.fn(async (_t: string, p: { prompt: string }, schema: { parse: (x: unknown) => unknown }) => {
        prompts.push(p.prompt);
        return schema.parse({ so_what: '改好的一句话', results: ['H1 → x'] });
      }),
    } as never;
    const summary = summarySchema.parse({ so_what: '原来的', results: ['H1 → x'], recommendation: RECOMMENDATION });
    const out = await repair(run, [], summary, [{ code: 'x', message: 'Summary 里有一处要改', excerpt: '原来的' } as never], new Map());
    expect(prompts[0]).not.toContain('change_if');
    expect(out.summary.so_what).toBe('改好的一句话');
    expect(out.summary.recommendation).toEqual(summary.recommendation);
  });
});

describe('a mocked run whose recommendation cites no [M#]', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup?.();
    cleanup = undefined;
  });

  it('delivered: the row cites the directive, research:directive-ref-added', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ meeting: true, approved: true });
    cleanup = fx.cleanup;
    const m = scriptedModel({ recommendation: () => ({ ...RECOMMENDATION, directive_response: '支持：IT 能不能管确实是重点，管控压力是现实的' }) });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    expect(r.failedChecks).toEqual([]);
    expect(r.delivered).toBe(true);
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.some((x) => x.action === 'research:directive-ref-added' && /\[M\d+\]/.test(x.change))).toBe(true);
  });
});
