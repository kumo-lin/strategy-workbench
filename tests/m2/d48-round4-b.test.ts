/**
 * D-48 第 4 轮 B: the model writes no footnote marks. It cites only evidence keys [E3] and condition codes [Q2-1①];
 * a writing call that wrote "[^3]" is asked once more, then the marks are taken out (research:model-footnote-dropped).
 * The answer comes in segments, one per condition (answer_segments; M4 renders them).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { conditionCode, judgePrompt, recommendPrompt, summaryPrompt } from '@/lib/harness/prompts/research-execute';
import { executeResearch } from '@/lib/research/execute';
import { readJudgmentFile } from '@/lib/research/judgment-file';
import { clearPageCache } from '@/lib/research/page-cache';
import { withoutFootnoteMarks } from '@/lib/research/run';
import { judgmentSchema } from '@/lib/research/schemas';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = undefined;
});

describe('answer_segments', () => {
  it('parsed as written; keys from a string too; absent: empty (the renderer falls back to answer)', () => {
    const base = { verdict: '需要修改', reasoning: 'r' };
    expect(judgmentSchema.parse({ ...base, answer_segments: [{ text: '准入由 IT 管住', cond: '①', keys: ['E3'] }, { text: '预算多半分散', cond: '②', keys: 'E4, E6' }] }).answer_segments).toEqual([
      { text: '准入由 IT 管住', cond: '①', keys: ['E3'] },
      { text: '预算多半分散', cond: '②', keys: ['E4', 'E6'] },
    ]);
    expect(judgmentSchema.parse(base).answer_segments).toEqual([]);
    // 第 5 轮: contrast, only on a piece that says the other side
    const c = judgmentSchema.parse({ ...base, answer_segments: [{ text: '但员工会绕开', cond: '③', keys: ['E5'], contrast: true }, { text: 'x', cond: '①', keys: [], contrast: 'true' }, { text: 'y', cond: '①', keys: [], contrast: 'maybe' }] }).answer_segments;
    expect(c.map((x) => x.contrast)).toEqual([true, true, undefined]);
  });
});

describe('the prompts: only [E#] and condition codes, never [^n]', () => {
  const claim = { id: 'C1', statement: 's', conditions: ['采购由 IT 牵头', '预算由 IT 出'], question: '谁拍板？', label: 'H2-1', qid: 'Q2-1' };
  it('the card: segments by condition, the codes of this sub-question', () => {
    const p = judgePrompt({ claim: claim as never, hypothesisLabel: null, evidence: [], subQuestions: [], context: '', exploratory: false, conditions: [{ n: 1, text: '采购由 IT 牵头' }] }).prompt;
    expect(p).toContain('- answer_segments：同一个回答，按它靠的条件分段');
    expect(p).toContain('条件编号 [Q2-1①]');
    expect(p).toContain('不要写 [^1] 这样的脚注标记');
    expect(p).toContain('"answer_segments":[{"text":"…","cond":"①","keys":["E1"]},{"text":"但……","cond":"②","keys":["E4"],"contrast":true}]');
    expect(p).toContain('**只有这一段写的是反面**');
  });

  it('the Summary and the recommendation show each condition by its code; the 依据 cites only codes or [E#]', () => {
    expect(conditionCode('H2-1', '①')).toBe('[Q2-1①]');
    expect(conditionCode('H1', '②')).toBe('[Q1②]');
    const claims = [{ label: 'H2-1', statement: 's', verdict: '需要修改', revised: null, reasoning: 'r', soWhat: [], gaps: [], expertQuestions: [], keyEvidence: [], conditions: [{ label: '①', text: '管不住就出局', status: '证据不足' }] }];
    const s = summaryPrompt({ question: 'q', purpose: 'p', claims, exploratory: false, tree: { roots: [{ qid: 'Q2', question: 'q', parts: [], labels: ['H2-1'], ran: true }], meceCheck: '' } } as never).prompt;
    expect(s).toContain('[Q2-1①] 管不住就出局 → 证据不足');
    expect(s).toContain('不要写 [^1] 这样的脚注标记');
    const r = recommendPrompt({ question: 'q', purpose: 'p', soWhat: 's', workplanImpact: [], exploratory: false, claims }).prompt;
    expect(r).toContain('[Q2-1①] 管不住就出局 → 证据不足');
    expect(r).toContain('"推断：依赖待验证断言 <它说的事> [Q2-1①]"');
    expect(r).toContain('"依据："后面只能引用条件编号');
  });
});

describe('a writing call that wrote "[^n]"', () => {
  it('every string of the answer without its marks', () => {
    expect(withoutFootnoteMarks({ a: '准入由 IT 管住[^3][^4]；预算分散 [^5]', b: ['x[^1]'], n: 2 })).toEqual({ a: '准入由 IT 管住；预算分散', b: ['x'], n: 2 });
  });

  it('asked once more; still there: the marks taken out, research:model-footnote-dropped; a call that drops them on the retry is kept as is', async () => {
    for (const stubborn of [true, false]) {
      clearPageCache();
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
      const fx = await setup({ approved: true, claims: 1 });
      cleanup = fx.cleanup;
      const note = await fx.vault.read(PLAN);
      const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
      data.claims = data.claims.map((c) => ({ ...c, question: '谁决定买？', parent: null }));
      data.mece_check = '一道关';
      await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
      let calls = 0;
      const m = scriptedModel({
        judge: ({ supports, conditions }) => {
          calls++;
          const mark = stubborn || calls === 1 ? '[^3]' : '';
          return {
            verdict: '成立', rebutted: [], revised_statement: null, support_lines: [`IT 主导 [${supports[0]}]`], counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'], challenge_responses: [], reasoning: `准入在 IT [${supports[0]}]`, model_knowledge: [], so_what: ['所以联想先打 IT'], gaps: [], expert_questions: [],
            ...(conditions.length ? { conditions: conditions.map((n) => ({ n, status: '成立', keys: supports, note: '' })), changed: '没改', answer: `IT 把关准入${mark} [${supports[0]}]`, answer_segments: [{ text: `IT 把关准入${mark}`, cond: '①', keys: [supports[0]] }], reasons: [`准入在 IT [${supports[0]}]`], short_statement: 'IT 把关' } : {}),
          };
        },
      });
      const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
      const r = await executeResearch({ ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
      const log = await fx.vault.readLog(fx.ctx.logPath);
      expect(calls).toBe(2);
      // what the report was written on (its judgment file): no mark left
      const file = await readJudgmentFile(fx.vault, r.reportPath);
      expect(file?.claims[0].judgment.answer).toMatch(/^IT 把关准入 \[E\d+\]$/);
      expect(file?.claims[0].judgment.answer_segments[0].text).toBe('IT 把关准入');
      expect(log.some((x) => x.action === 'research:model-footnote-dropped' && x.change.startsWith('judge:C1'))).toBe(stubborn);
      await cleanup();
      cleanup = undefined;
    }
  });
});

describe('entity_flags (M4\'s entity-check, run where citation_flags are)', () => {
  it('a name before a footnote that its original does not have: entity_flags in frontmatter, logged, the report delivered', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 1 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c) => ({ ...c, question: '谁决定买？', parent: null }));
    data.mece_check = '一道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    const m = scriptedModel({
      judge: ({ supports, conditions }) => ({
        verdict: '成立', rebutted: [], revised_statement: null, support_lines: [`IT 主导 [${supports[0]}]`], counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'], challenge_responses: [], reasoning: `准入在 IT [${supports[0]}]`, model_knowledge: [], so_what: ['所以联想先打 IT'], gaps: [], expert_questions: [],
        ...(conditions.length ? { conditions: conditions.map((n) => ({ n, status: '成立', keys: supports, note: '' })), changed: '没改', answer: `Gartner 说 IT 把关准入 [${supports[0]}]`, reasons: [`准入在 IT [${supports[0]}]`], short_statement: 'IT 把关' } : {}),
      }),
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const r = await executeResearch({ ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(r.reportPath);
    expect(r.delivered).toBe(true);
    // the check names it by its alias table's first name (高德纳 / Gartner)
    expect(report.data.entity_flags).toEqual([{ key: expect.stringMatching(/^\[\[.+#\^c\d+\]\]$/), footnote: expect.stringMatching(/^\[\^\d+\]$/), sentence: 'Gartner 说 IT 把关准入', missing: ['高德纳'] }]);
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:entity-flagged' && x.change.includes('高德纳'))).toBe(true);
  });
});
