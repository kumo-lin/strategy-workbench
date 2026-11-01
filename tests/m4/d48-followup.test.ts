/**
 * D-48: a split sub-question's answer ("- Q2-1 的回答：") is in its card, written by renderClaimSection; the follow-up
 * no longer adds one after the section. A card written the older way still gets it after, as before. Never twice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, executeFollowUp, withLeafAnswer } from '@/lib/research/followup';
import { clearPageCache } from '@/lib/research/page-cache';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from '../m2/research-fixture';

describe('withLeafAnswer', () => {
  const answer = () => '代码写的回答';

  it('a card that has its answer line: unchanged, the answer not even asked for', () => {
    const card = ['#### 假设 H2-1：…', '- 提议的判断：需要修改（② 不成立）', '- 改了什么：改成只在受监管行业是门槛', '- Q2-1 的回答：只在银行保险这类行业是门槛。', '- 理由：', '  - …[^10]'];
    let asked = false;
    expect(
      withLeafAnswer(card, 'Q2-1', () => {
        asked = true;
        return '';
      }),
    ).toEqual(card);
    expect(asked).toBe(false);
  });

  it('a card written the older way: the line after it, as before', () => {
    const card = ['#### 假设 H2-1：…', '- 提议的判断：需要修改（改成：…）', '- 理由：…'];
    expect(withLeafAnswer(card, 'Q2-1', answer)).toEqual([...card, '- Q2-1 的回答：代码写的回答']);
  });

  it("another sub-question's answer line does not count", () => {
    const card = ['#### 假设 H2-2：…', '- 理由：比 Q2-1 的回答：…'];
    expect(withLeafAnswer(card, 'Q2-2', answer).at(-1)).toBe('- Q2-2 的回答：代码写的回答');
  });
});

describe('a follow-up on a D-48 report: the Summary row\'s 回答 column follows this version', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup?.();
    cleanup = undefined;
  });

  it('H2-1 re-judged with a new answer: its card says it once, and so does its row, after the verdict', async () => {
    vi.setConfig({ testTimeout: 90_000 });
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 3, subQuestions: 2 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c, i) => ({ ...c, question: ['谁决定买，谁出钱？', '"IT 管得住"是不是准入要求？', '几家都管得住的时候，买方按什么选？'][i], parent: i === 0 ? null : 'Q2' }));
    data.question_tree = [{ id: 'Q2', question: '买方按什么标准放行，又按什么标准选？' }];
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    const now = () => new Date('2026-10-26T10:00:00Z');
    const judge = (answer: string) => ({ supports, refutes }: { supports: string[]; refutes: string[] }) => ({
      verdict: '成立', rebutted: refutes, revised_statement: null,
      support_lines: supports.slice(0, 3).map((k) => `IT 部门主导采购 [${k}]`),
      counter_lines: refutes.length ? [] : ['已专门检索反证，没有找到 A/B 级的反证'],
      challenge_responses: refutes.map((k) => ({ key: k, challenge: '说员工会绕开管理', response: `不否定 IT 在采购里的决策角色 [${supports[0] ?? 'E1'}]`, effect: '不影响判断' })),
      reasoning: `多家独立来源都指向 IT 主导 [${supports[0] ?? 'E1'}]`, model_knowledge: [], so_what: ['所以联想先对准 IT'], gaps: ['缺少预算口径'], expert_questions: ['预算由谁批？'],
      answer: `${answer} [${supports[0] ?? 'E1'}]`, reasons: [`IT 部门主导采购 [${supports[0] ?? 'E1'}]`], changed: '没改', short_statement: 'IT 管得住',
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now });
    await executeResearch({ ctx, mode: 'full', model: scriptedModel({ judge: judge('第一版的回答') }).model, webClient: fakeWeb() });
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C2', question: '员工会不会绕开 IT 自己买？' });
    const ctx2 = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now });
    const follow = await executeFollowUp({ ctx: ctx2, claimId: 'C2', subQuestionId: added.subQuestionId, model: scriptedModel({ judge: judge('追加以后的回答') }).model, webClient: fakeWeb() });
    expect(follow.failedChecks).toEqual([]);
    const b = (await fx.vault.read(follow.reportPath)).body;
    const sec = b.slice(b.indexOf('#### 假设 H2-1：'), b.indexOf('### Q2-2 '));
    expect(sec.match(/^- Q2-1 的回答：/gm)).toHaveLength(1);
    expect(sec).toMatch(/^- Q2-1 的回答：追加以后的回答\[\^\d+\]$/m);
    expect(b).toMatch(/^\| Q2-1 \| H2-1 IT 管得住 \| 成立 \| 追加以后的回答\[\^\d+\] \|$/m);
    expect(b).toMatch(/^\| Q2-2 \| H2-2 IT 管得住 \| 成立 \| 第一版的回答\[\^\d+\] \|$/m);
  });
});
