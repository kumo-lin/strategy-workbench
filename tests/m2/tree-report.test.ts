/**
 * D-39 P2: a run on a question-tree plan writes the question-tree report (C's sample, D-39_报告样稿_WS-A问题树.md):
 * Summary (核心问题, 回答 assembled from the top-level answers, 问题树, 各子问题的回答, 为什么足以回答, the hypotheses'
 * table, the recommendation), then "## Q1" (### 假设 H1, ### Q1 的回答) and "## Q2" (### Q2-1, #### 假设 H2-1, …,
 * ### Q2 的回答). The words follow the 用词对照表 (需要修改（改成：…）, 推翻了假设 / 假设要改 / 不影响判断).
 * An older plan still gets the older report (the rest of tests/m2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { judgePrompt, summaryPrompt, WRITING_SYSTEM } from '@/lib/harness/prompts/research-execute';
import { executeResearch } from '@/lib/research/execute';
import { hypothesisOfHeading, numberMismatches } from '@/lib/research/number-check';
import { isCircularWhyNot, isSoftGap, leafAnswer, recommendationGaps, verdictWithRevision } from '@/lib/research/report';
import { judgmentSchema, responseKeys } from '@/lib/research/schemas';
import { checkReportText, planYears, treeReportFailures } from '@/lib/research/selfcheck';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, RECOMMENDATION, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const MECE = '谁决定买（Q1）和按什么标准放行（Q2）是采购的两道关，不重叠；少了 Q1 不知道该说服谁，少了 Q2 不知道管理栈是不是必需的。';

/** The fixture plan with three claims, made a tree: Q1 / Q2 (→ Q2-1, Q2-2). */
async function treeRun(o: { mode?: 'small' | 'full'; answers?: Record<string, string>; judge?: NonNullable<Parameters<typeof scriptedModel>[0]>['judge'] } = {}) {
  const fx = await setup({ approved: true, claims: 3, subQuestions: 2 });
  cleanup = fx.cleanup;
  const note = await fx.vault.read(PLAN);
  const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
  data.claims = data.claims.map((c, i) => ({ ...c, question: ['谁决定买，谁出钱？', '"IT 管得住"是不是准入要求？', '几家都管得住的时候，买方按什么选？'][i], parent: i === 0 ? null : 'Q2' }));
  data.question_tree = [{ id: 'Q2', question: '买方按什么标准放行，又按什么标准选？' }];
  data.mece_check = MECE;
  await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
  const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-25T10:00:00Z') });
  const m = scriptedModel({ answers: o.answers, judge: o.judge });
  const out = await executeResearch({ ctx, mode: o.mode ?? 'small', model: m.model, webClient: fakeWeb() });
  return { fx, out, m, report: await fx.vault.read(out.reportPath) };
}

describe('the question-tree report', () => {
  it('a small run: the first hypothesis in the tree; the Summary says the tree, each answer, why they are enough; delivered', async () => {
    const { out, report } = await treeRun();
    const b = report.body;
    expect(out.failedChecks).toEqual([]);
    expect(out.delivered).toBe(true);
    expect(b).toMatch(/^- 核心问题：企业为什么为员工的 AI PC 买单？$/m);
    expect(b).toMatch(/^- 回答（一句话）：.*（由 Q1 的回答组装而成）/m);
    expect(b).toContain('- 问题树：核心问题 → Q1 谁决定买，谁出钱？／Q2 买方按什么标准放行，又按什么标准选？（→ Q2-1 "IT 管得住"是不是准入要求？、Q2-2 几家都管得住的时候，买方按什么选？）');
    expect(b).toMatch(/^ {2}- Q1 → IT 决定准入\[\^\d+\]$/m);
    expect(b).toMatch(/^ {2}- Q2 → 本次没有查（试水调查范围）$/m);
    expect(b).toMatch(/^- 为什么这几个回答足以回答核心问题：谁决定、按什么放行/m);
    expect(b).toContain('| 子问题 | 假设 | 提议的判断 | 回答 |'); // D-48: the answer after the verdict
    expect(b).toMatch(/^\| Q1 \| H1 IT 可管理性决定企业是否采购 AI PC 1 \| 成立 \| IT 决定准入\[\^\d+\] \|$/m);
    expect(b).toMatch(/^\| Q2-1 \| H2-1 IT 可管理性决定企业是否采购 AI PC 2 \| 本次没有查（试水调查范围） \| 本次没有查（试水调查范围） \|$/m);
    expect(b).toContain('- AI 的推荐判断（待你拍板）：下面全部是 AI 的提议，状态只有人能改。');
    expect(b).not.toContain('以上全部是 AI 提议');
    expect(b).not.toContain('## 逐个假设');
    // the sections
    expect(b).toMatch(/^## Q1 谁决定买，谁出钱？\n\n### 假设 H1：IT 可管理性决定企业是否采购 AI PC 1/m);
    expect(b).toMatch(/^### Q1 的回答\n\nIT 决定准入\[\^\d+\]$/m);
    expect(b).toMatch(/^## Q2 买方按什么标准放行，又按什么标准选？\n\n### Q2-1 "IT 管得住"是不是准入要求？\n\n- 假设 H2-1：IT 可管理性决定企业是否采购 AI PC 2（本次没有查（试水调查范围））$/m);
    expect(b).toMatch(/^- Q2-1 的回答：本次没有查（试水调查范围）$/m);
    expect(b).toMatch(/^### Q2 的回答\n\n本次没有查（试水调查范围）$/m);
    expect(b).not.toMatch(/^- Q1 的回答：/m); // Q1 is answered once, by its "### Q1 的回答"
    expect(b).toMatch(/^- 理由：/m);
    expect(b).toMatch(/^- So What：/m);
    expect(b).not.toMatch(/^- 推导（推断）：|^- So what 的候选：|（AI 提议，等人拍板后才生效）/m);
    expect(b).toMatch(/H2-1 本次没有查（试水调查范围）/); // the appendix says what was not run, by the labels readers see
    expect(b).toMatch(/^- H1 要查的问题：Q1\.1 /m);
  });

  it('a full run: H2-1 and H2-2 under Q2-1 / Q2-2 (#### 假设), the Q2 answer assembled; an answer the Summary left out is written by code', async () => {
    const { out, report, fx } = await treeRun({ mode: 'full', answers: { Q1: 'IT 决定准入', Q2: '' } });
    const b = report.body;
    expect(out.failedChecks).toEqual([]);
    expect(b).toMatch(/^### Q2-1 "IT 管得住"是不是准入要求？\n\n#### 假设 H2-1：IT 可管理性决定企业是否采购 AI PC 2/m);
    expect(b).toMatch(/^### Q2-2 几家都管得住的时候，买方按什么选？\n\n#### 假设 H2-2：/m);
    expect(b).toMatch(/^- 回答（一句话）：.*（由 Q1、Q2 的回答组装而成）/m);
    // each lowest-level sub-question under Q2 answered by code from its hypothesis (成立 → 是。<假设>)
    expect(b).toMatch(/^- Q2-1 的回答：是。IT 可管理性决定企业是否采购 AI PC 2。$/m);
    expect(b).toMatch(/^- Q2-2 的回答：是。IT 可管理性决定企业是否采购 AI PC 3。$/m);
    // Q2's own answer the Summary left out: code assembles it from the same lines
    expect(b).toMatch(/^ {2}- Q2 → Q2-1：是。IT 可管理性决定企业是否采购 AI PC 2。 Q2-2：是。IT 可管理性决定企业是否采购 AI PC 3。$/m);
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((r) => r.action === 'research:answer-fallback' && r.change.includes('Q2'))).toBe(true);
    expect(report.data.verdicts_proposed).toEqual({ C1: expect.any(String), C2: expect.any(String), C3: expect.any(String) });
    expect(report.data.report_format).toBe('question_tree');
    // the fixture's support blocks back every hypothesis: flagged, not blocking
    expect(report.data.shared_evidence).toEqual(expect.arrayContaining([expect.objectContaining({ hypotheses: expect.arrayContaining(['H1', 'H2-1']) })]));
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((r) => r.action === 'research:evidence-shared')).toBe(true);
  });

  it('需要修改: the revision goes in the brackets; the challenge table says what the challenge does to the hypothesis', async () => {
    const judge = (k: { supports: string[]; refutes: string[] }) => ({
      verdict: '需要修正', // the old word, as a model might still write it
      rebutted: [],
      revised_statement: `只在受监管行业成立：IT 决定准入 [${k.supports[0]}]`,
      revised_assertions: [{ text: 'IT 决定准入', keys: k.supports.slice(0, 2) }],
      support_lines: [`IT 部门主导采购 [${k.supports[0]}]`],
      counter_lines: [],
      challenge_responses: k.refutes.length ? [{ key: k.refutes, challenge: '员工会绕开', response: `资料说 IT 部门主导采购 [${k.supports[0]}]；推断：只在管理严格的企业成立`, effect: '收窄' }] : [],
      reasoning: `IT 主导 [${k.supports[0]}]`,
      model_knowledge: [],
      so_what: ['先打受监管行业', '第二条不渲染'],
      gaps: [],
      expert_questions: [],
    });
    const { report } = await treeRun({ judge });
    const b = report.body;
    expect(b).toMatch(/^- 提议的判断：需要修改（改成：只在受监管行业成立：IT 决定准入\[\^\d+\]）$/m);
    expect(b).toMatch(/^\| Q1 \| H1 .* \| 需要修改（改成：只在受监管行业成立：IT 决定准入\[\^\d+\]） \| .+ \|$/m);
    expect(b).toMatch(/^- So What：先打受监管行业$/m);
    expect(b).toContain('- 修改后的假设拆成几条，逐条对照判断标准');
    expect(b).not.toContain('门槛');
    expect(b).not.toContain('第二条不渲染');
    expect(report.data.verdicts_proposed).toEqual({ C1: '需要修改' });
    if (/\| 挑战 \| 回应 \|/.test(b)) {
      expect(b).toContain('| 挑战 | 回应 | 对判断的影响 | 出处 |');
      expect(b).toMatch(/ \| 假设要改 \| (?:\[\^\d+\])+ \|$/m);
    }
  });
});

describe('the checks of a question-tree report', () => {
  const body = (o: { answer?: string; sufficiency?: string; reason?: boolean } = {}) =>
    [
      '# R 调查报告 v1',
      '',
      '## Summary',
      '- 核心问题：企业会为哪一部分付钱？',
      '- 回答（一句话）：会为管理栈付钱（由 Q1 的回答组装而成）',
      '- 问题树：核心问题 → Q1 谁决定买？',
      '- 各子问题的回答：',
      '  - Q1 → IT 决定准入',
      `- 为什么这几个回答足以回答核心问题：${o.sufficiency ?? '少了 Q1 不知道该说服谁'}`,
      '',
      '## 怎么查的',
      '- 查了：知识库',
      '',
      '## Q1 谁决定买？',
      '',
      '### 假设 H1：IT 决定',
      '- 提议的判断：成立',
      ...(o.reason === false ? [] : ['- 理由：见支持的证据']),
      '- So What：先找 IT',
      '- 支持的证据：',
      '- 反证和挑战（逐条回应）：',
      '',
      '### Q1 的回答',
      '',
      o.answer ?? 'IT 决定准入',
      '',
      '## 对 workplan 的影响',
      '- （无）',
      '',
      '## 引文出处',
      '（没有引用）',
      '',
    ].join('\n');

  it('a lowest-level sub-question split from a top-level one needs its answer line', () => {
    const split = body().replace('## Q1 谁决定买？\n\n### 假设 H1：IT 决定', '## Q1 谁决定买？\n\n### Q1-1 谁拍板？\n\n#### 假设 H1-1：IT 决定').replace('\n### Q1 的回答', '- Q1-1 的回答：是。IT 决定。\n\n### Q1 的回答');
    expect(treeReportFailures(split)).toEqual([]);
    expect(treeReportFailures(split.replace('- Q1-1 的回答：是。IT 决定。', '')).map((f) => f.message)).toEqual(['子问题 Q1-1 没有回答（“- Q1-1 的回答：”这一行）']);
  });

  it('a complete one passes the tree checks', () => {
    expect(treeReportFailures(body())).toEqual([]);
    expect(checkReportText(body()).filter((f) => f.code === 'missing_section')).toEqual([]);
  });

  it('a top-level sub-question without its answer, a Summary without "why they are enough", a hypothesis without 理由', () => {
    expect(treeReportFailures(body({ answer: '' })).map((f) => f.message)).toEqual(['子问题 Q1 没有回答（“### Q1 的回答”下面要写出回答）']);
    expect(treeReportFailures(body({ sufficiency: '（没有写）' })).map((f) => f.message)).toEqual(['Summary 缺少“为什么这几个回答足以回答核心问题”']);
    expect(checkReportText(body({ reason: false })).map((f) => f.message)).toContain('“假设 H1：IT 决定”缺少“理由”');
  });

  it('the labels and the plan text are not data: Q2-1.1, H2-1, the core question\'s years', () => {
    const b = body().replace('企业会为哪一部分付钱？', '2026–2027 年，企业会为哪一部分付钱？').replace('- 理由：见支持的证据', '- 理由：Q2-1.1 和 H2-1 都查过，2026 年也在计划里');
    expect([...planYears(b)].sort()).toEqual(['2026', '2027']);
    expect(checkReportText(b).filter((f) => f.code === 'uncited_number')).toEqual([]);
  });

  it('the number check knows the hypothesis of a "#### 假设 H2-1：" section', () => {
    expect(hypothesisOfHeading('#### 假设 H2-1：可管理性是准入要求')).toBe('H2-1');
    expect(hypothesisOfHeading('### 假设 H1：IT 决定')).toBe('H1');
    expect(hypothesisOfHeading('### H3 旧格式的论点')).toBe('H3');
    expect(hypothesisOfHeading('### Q2-1 是不是准入要求？')).toBeNull();
    const md = ['## Q2 x', '### Q2-1 y？', '#### 假设 H2-1：z', '- 支持的证据：', '| 77% 的 CIO | 77% | B | [^1] |', '', '## 引文出处', '[^1]: “72% of CIOs”（B 级）[[x#^c1]]'].join('\n');
    expect(numberMismatches(md, new Map([['1', '72% of CIOs']]))).toEqual([expect.objectContaining({ claim: 'H2-1', number: '77%' })]);
  });
});

describe('reports written before the rename say 小调查', () => {
  it('the self-check treats "（本次没有查（小调查范围））" like the new "试水调查范围" (the demo vault keeps its old reports)', async () => {
    const { report } = await treeRun();
    const codes = (md: string) => checkReportText(md).map((f) => `${f.code}:${f.excerpt ?? ''}`).sort();
    expect(report.body).toContain('试水调查范围');
    expect(codes(report.body.replace(/试水调查范围/g, '小调查范围'))).toEqual(codes(report.body));
  });
});

describe('the words (D-39 用词对照表)', () => {
  it('a judgment in the old words reads as the new ones; one row may answer several challenges', () => {
    const j = judgmentSchema.parse({ verdict: '需要修正', reasoning: 'r', challenge_responses: [{ key: ['E29', 'E30'], challenge: 'c', response: 'r', effect: '推不翻' }, { key: 'E4', challenge: 'c', response: 'r', effect: '收窄' }, { key: 'E5', challenge: 'c', response: 'r', effect: '推翻' }] });
    expect(j.verdict).toBe('需要修改');
    expect(j.challenge_responses.map((c) => [responseKeys(c), c.effect])).toEqual([
      [['E29', 'E30'], '不影响判断'],
      [['E4'], '假设要改'],
      [['E5'], '推翻了假设'],
    ]);
  });

  it('a lowest-level answer by code from the judgment (D-39 2b): 是 / the revision / 不是 + the reason / 还答不了 + the gap', () => {
    const r = (verdict: string, o: { revised?: string; reasoning?: string; gaps?: string[] } = {}) =>
      ({ verdict, revisedStatement: o.revised ?? null, claim: { statement: '可管理性是准入要求' }, judgment: { reasoning: o.reasoning ?? '', gaps: o.gaps ?? [] } }) as unknown as Parameters<typeof leafAnswer>[0];
    const id = (t: string) => t;
    expect(leafAnswer(r('成立'), id)).toBe('是。可管理性是准入要求。');
    expect(leafAnswer(r('需要修改', { revised: '只在受监管行业成立' }), id)).toBe('只在受监管行业成立。');
    expect(leafAnswer(r('不成立', { reasoning: '监管没有要求。其他行业也没有。' }), id)).toBe('不是。监管没有要求。');
    expect(leafAnswer(r('证据不足', { gaps: ['没有评分表的权重。', '没有中标理由'] }), id)).toBe('现在还答不了，缺评分表的权重。');
    expect(leafAnswer(r('证据不足', { gaps: ['买方的成交价'] }), id)).toBe('现在还答不了，缺买方的成交价。');
  });

  it('verdictWithRevision', () => {
    expect(verdictWithRevision('需要修改', '只在受监管行业成立。')).toBe('需要修改（改成：只在受监管行业成立）');
    expect(verdictWithRevision('成立', null)).toBe('成立');
  });

  it('the prompts that write the report carry the plain-writing rules and the word table; the judge sees its sub-question', () => {
    expect(WRITING_SYSTEM).toContain('写法（说人话）');
    expect(WRITING_SYSTEM).toContain('只删包装');
    expect(WRITING_SYSTEM).toContain('推翻了假设 / 假设要改 / 不影响判断');
    expect(WRITING_SYSTEM).toContain('准入要求');
    const jp = judgePrompt({ claim: { id: 'C2', statement: '可管理性是准入要求', conditions: ['写在资格条款里'], question: '"IT 管得住"是不是准入要求？', qid: 'Q2-1', label: 'H2-1' }, hypothesisLabel: null, evidence: [], subQuestions: [], context: '', exploratory: false });
    expect(jp.system).toBe(WRITING_SYSTEM);
    expect(jp.prompt).toContain('子问题 Q2-1："IT 管得住"是不是准入要求？\n假设 H2-1：可管理性是准入要求\n必须成立的条件：(1) 写在资格条款里');
    expect(jp.prompt).toContain('- so_what：只写一条');
    expect(jp.prompt).not.toMatch(/收窄"三选一|"推不翻"、/);
    const sp = summaryPrompt({ question: 'q', purpose: 'p', claims: [], exploratory: false, tree: { roots: [{ qid: 'Q1', question: '谁决定？', parts: [], labels: ['H1'], ran: true }, { qid: 'Q2', question: '按什么选？', parts: ['Q2-1 a', 'Q2-2 b'], labels: [], ran: false }], meceCheck: MECE } });
    expect(sp.prompt).toContain('- Q1 谁决定？：这次查了，假设 H1');
    expect(sp.prompt).toContain('- Q2 按什么选？（拆成 Q2-1 a、Q2-2 b）：这次没有查（试水调查范围）');
    expect(sp.prompt).toContain(MECE);
    expect(sp.prompt).toContain('"answers":[{"id":"Q1"');
  });

  it('"不选" that only repeats the conclusion is asked about in the repair round, and never keeps a report a draft', () => {
    expect(isCircularWhyNot('之所以不列为主路径，只能作为自研的补充而非替代')).toBe(true);
    expect(isCircularWhyNot('不选为主路径，保留为补充：日志归集可以和终端管理厂商合作补上')).toBe(false);
    expect(isCircularWhyNot('合作方掌握渠道，但毛利太低')).toBe(false);
    const rec = { ...RECOMMENDATION, alternatives: RECOMMENDATION.alternatives.map((a, i) => (i === 1 ? { ...a, why_not: '之所以不列为主路径，只能作为自研的补充而非替代' } : a)) };
    const gaps = recommendationGaps(rec as unknown as Parameters<typeof recommendationGaps>[0]);
    expect(gaps.filter(isSoftGap)).toHaveLength(1);
  });
});
