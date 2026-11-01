/**
 * D-48 第 5 轮（B 加强版）: the one-line answer and 对决策的回答 come from the sub-questions' answers as written, never
 * from the evidence; each clause names its answers, [Q3-1]; code checks tone and direction and only flags. Fixture: WS-A
 * 报告 v8's "各子问题的回答" (tests/fixtures/d48/ws-a-v8-sub-answers.md, copied from C's S3) and its one-line answer,
 * which said "付钱多半落在软件席位" where Q3-1 said "科目上多半没向软件与服务倾斜".
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { clausesOf, conclusionFlags, subAnswersOf, writeConclusion } from '@/lib/research/conclusion';
import { executeResearch } from '@/lib/research/execute';
import { readJudgmentFile } from '@/lib/research/judgment-file';
import { lengthOf } from '@/lib/research/length-check';
import { clearPageCache } from '@/lib/research/page-cache';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, RECOMMENDATION, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

const V8 = readFileSync('tests/fixtures/d48/ws-a-v8-sub-answers.md', 'utf8');
const answers = subAnswersOf(V8);

describe('the answers as WS-A v8 has them', () => {
  it('each top-level answer and each part of a split one, without footnotes', () => {
    expect(answers.map((a) => a.q)).toEqual(['Q1', 'Q2', 'Q2-1', 'Q2-2', 'Q3', 'Q3-1', 'Q3-2', 'Q3-3']);
    expect(answers.find((a) => a.q === 'Q3-1')!.text).toContain('科目上多半没向软件与服务倾斜');
    expect(answers.every((a) => !a.text.includes('[^'))).toBe(true);
  });
});

describe('the checks (code, only flagged)', () => {
  it('direction: v8\'s "付钱多半落在软件席位" on Q3-1\'s "科目上多半没向软件与服务倾斜" is caught', () => {
    const flags = conclusionFlags('准入归 IT[Q1]；付钱多半落在软件席位这类可查计费单元[Q3-1]；', answers);
    expect(flags).toEqual([{ sentence: '付钱多半落在软件席位这类可查计费单元[Q3-1]', q: 'Q3-1', kind: 'direction' }]);
    // said the way Q3-1 says it: nothing
    expect(conclusionFlags('科目上多半没向软件与服务倾斜[Q3-1]', answers)).toEqual([]);
  });

  it('tone: "过关按价格与交付" on Q2-2\'s "过关后多半按价格和交付定胜负" (v8 lost the 多半)', () => {
    expect(conclusionFlags('过关按价格与交付[Q2-2]', answers)).toEqual([{ sentence: '过关按价格与交付[Q2-2]', q: 'Q2-2', kind: 'tone' }]);
    expect(conclusionFlags('过关后多半按价格与交付[Q2-2]', answers)).toEqual([]);
  });

  it('a clause that names no answer: untagged; a recommendation cell is checked before its 依据', () => {
    expect(conclusionFlags('硬件没有 AI 单独条目', answers)).toEqual([{ sentence: '硬件没有 AI 单独条目', q: '', kind: 'untagged' }]);
    expect(clausesOf('提议：押管理栈[Q1]。依据：IT 管准入[Q1]；钱在席位')).toEqual(['提议：押管理栈[Q1]']);
    // "是不是" asks, it does not say no
    expect(conclusionFlags('拍板方多半是 IT[Q1]', [{ q: 'Q1', text: '拍板方多半是 IT，是不是还有业务线，还缺记录' }])).toEqual([]);
  });

  it('M1 验收 4 runs 1 and 2 (试水调查): the sentences that said what Q1 said are not flagged any more', () => {
    // run 1: one clause joining two of Q1's parts; 未 in the first half, "还缺" (about the sources) in the other answer part
    const q1 = [{ q: 'Q1', text: '49% 员工未经批准使用 AI 工具，样本是 500 人以上企业员工；用过的人里近九成先在个人生活接触，还缺第二个独立来源。' }];
    expect(conclusionFlags('49%员工未经批准使用AI工具，用过的人里近九成先在个人生活接触[Q1]；用不起来卡在哪里，本次没有查[Q2]', q1)).toEqual([]);
    // run 2: "还判断不了" and "缺……的证据" are not a no, and they are soft already
    const q2 = [{ q: 'Q1', text: '三分之二办公人员自认用过公司不允许的 AI 工具；来源多半还判断不了，缺员工最早在哪接触的证据（还缺证据）。' }];
    expect(conclusionFlags('三分之二办公人员自认用过公司不允许的 AI 工具[Q1]；来源还判断不了[Q1]；缺员工最早在哪接触的证据[Q1]', q2)).toEqual([]);
    // and the opposite still is
    expect(conclusionFlags('三分之二办公人员自认用过公司允许的 AI 工具[Q1]', q2)).toEqual([{ sentence: '三分之二办公人员自认用过公司允许的 AI 工具[Q1]', q: 'Q1', kind: 'direction' }]);
  });

  it('[Qx] does not count toward 字数', () => {
    expect(lengthOf('准入归 IT[Q1]；付钱多半落在软件席位[Q3-1][Q2-1①]')).toBe(lengthOf('准入归 IT；付钱多半落在软件席位'));
  });
});

describe('the call', () => {
  const fake = (answersInOrder: unknown[]) => {
    const prompts: string[] = [];
    let n = 0;
    return { prompts, run: { signal: undefined, log: vi.fn(async () => {}), llm: vi.fn(async (_t: string, p: { prompt: string }) => (prompts.push(p.prompt), answersInOrder[n++])) } as never };
  };

  it('given only the answers (no evidence); a clause without [Qx] asked once more', async () => {
    const f = fake([{ so_what: '准入归 IT[Q1]；钱多半在席位', decision_answer: '' }, { so_what: '准入归 IT[Q1]；钱多半在席位[Q3-1]', decision_answer: '' }]);
    const out = await writeConclusion(f.run, { question: '谁为 AI PC 付钱？', decision: null, answers, withDecision: false });
    expect(out?.so_what).toBe('准入归 IT[Q1]；钱多半在席位[Q3-1]');
    expect(f.prompts).toHaveLength(2);
    expect(f.prompts[0]).toContain('- Q3-1：席位 90.45 美元起');
    // the answers as written, no footnote, no evidence list
    expect(f.prompts[0].split('\n').filter((l) => /^- Q/.test(l)).join('\n')).not.toMatch(/\[E\d+\]|\[\^\d+\]/);
    expect(f.prompts[0]).not.toContain('证据列表');
    expect(f.prompts[1]).toContain('上一次有这几个分句没有标 [Qx]，这次每个分句都要标：「钱多半在席位」');
  });
});

describe('[E#] or [^n] in the conclusion (M1 验收 4 runs 3 and 5)', () => {
  const fake = (answersInOrder: unknown[]) => {
    const prompts: string[] = [];
    const logs: string[] = [];
    let n = 0;
    return { prompts, logs, run: { signal: undefined, log: vi.fn(async (a: string) => void logs.push(a)), llm: vi.fn(async (_t: string, p: { prompt: string }) => (prompts.push(p.prompt), answersInOrder[n++])) } as never };
  };
  it('asked once more; still there: taken out, research:model-footnote-dropped', async () => {
    const ok = fake([{ so_what: '占 49% [E2][E3][Q1]', decision_answer: '' }, { so_what: '占 49%[Q1]', decision_answer: '' }]);
    expect((await writeConclusion(ok.run, { question: 'q', decision: null, answers, withDecision: false }))?.so_what).toBe('占 49%[Q1]');
    expect(ok.prompts[1]).toContain('上一次写了 [E#] 或 [^1] 这样的编号');
    const stubborn = fake([{ so_what: '占 49%[^1][Q1]', decision_answer: '' }, { so_what: '占 49% [E2][Q1]', decision_answer: '' }]);
    expect((await writeConclusion(stubborn.run, { question: 'q', decision: null, answers, withDecision: false }))?.so_what).toBe('占 49%[Q1]');
    expect(stubborn.logs).toContain('research:model-footnote-dropped');
  });
});

describe('a mocked full run of a question tree', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup?.();
    cleanup = undefined;
  });

  it('the one-line answer and 对决策的回答 are the conclusion call\'s; a clause against its answer: summary_flags; stored in the judgment file', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 1 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c) => ({ ...c, question: '谁决定买？', parent: null }));
    data.mece_check = '一道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    let given: { q: string; text: string }[] = [];
    const m = scriptedModel({
      judge: ({ supports, conditions }) => ({
        verdict: '成立', rebutted: [], revised_statement: null, support_lines: [`IT 主导 [${supports[0]}]`], counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'], challenge_responses: [], reasoning: `准入在 IT [${supports[0]}]`, model_knowledge: [], so_what: ['所以联想先打 IT'], gaps: [], expert_questions: [],
        ...(conditions.length ? { conditions: conditions.map((n) => ({ n, status: '成立', keys: supports, note: '' })), changed: '没改', answer: `IT 不主导采购 [${supports[0]}]`, reasons: [`准入在 IT [${supports[0]}]`], short_statement: 'IT 把关' } : {}),
      }),
      conclusion: (a) => {
        given = a;
        return { so_what: 'IT 主导采购[Q1]；钱从业务线出', decision_answer: '提议：先押 IT 管理这一层[Q1]。依据：Q1 的回答[Q1]' };
      },
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const r = await executeResearch({ ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(r.reportPath);
    expect(r.delivered).toBe(true);
    expect(given).toEqual([{ q: 'Q1', text: expect.stringContaining('IT 不主导采购') }]);
    expect(m.tasks.filter((t) => t === 'summary:conclusion')).toHaveLength(2); // one clause untagged: asked once more
    expect(report.body).toMatch(/- 回答（一句话）：IT 主导采购\[Q1\]；钱从业务线出/);
    expect(report.data.summary_flags).toEqual([
      { sentence: 'IT 主导采购[Q1]', q: 'Q1', kind: 'direction' },
      { sentence: '钱从业务线出', q: '', kind: 'untagged' },
    ]);
    const file = await readJudgmentFile(fx.vault, r.reportPath);
    expect(file?.summary?.so_what).toBe('IT 主导采购[Q1]；钱从业务线出');
    expect(file?.recommendation?.decision_answer).toBe('提议：先押 IT 管理这一层[Q1]。依据：Q1 的回答[Q1]');
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:summary-flagged' && x.change.includes('方向和子问题的回答相反'))).toBe(true);
  });

  it('a repair round (here the recommendation\'s) does not bring the evidence back into what the conclusion wrote', async () => {
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
      // the first recommendation misses 押别的层: the repair round asks again, and writes 对决策的回答 from the evidence
      recommendation: (prompt: string) =>
        prompt.includes('上一次写的推荐判断没有通过系统检查')
          ? { ...RECOMMENDATION, decision_answer: '押管理和安全栈 [E1]（提议）' }
          : { ...RECOMMENDATION, alternatives: RECOMMENDATION.alternatives.filter((a) => a.dimension !== 'layer') },
      conclusion: () => ({ so_what: 'IT 主导采购[Q1]', decision_answer: '提议：先押 IT 管理这一层[Q1]。依据：Q1 的回答[Q1]' }),
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const r = await executeResearch({ ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    expect(m.tasks).toContain('recommend:repair');
    expect(r.delivered).toBe(true);
    const file = await readJudgmentFile(fx.vault, r.reportPath);
    expect(file?.recommendation?.decision_answer).toBe('提议：先押 IT 管理这一层[Q1]。依据：Q1 的回答[Q1]');
    expect(file?.recommendation?.alternatives.some((a) => a.dimension === 'layer')).toBe(true); // the repair's other parts kept
    expect(file?.summary?.so_what).toBe('IT 主导采购[Q1]');
  });
});
