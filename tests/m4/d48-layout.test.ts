/**
 * D-48 the report's new layout (格式约定): a hypothesis card is 当时的假设 ①②③ → 提议的判断（the conditions not 成立
 * in brackets）→ 改了什么 → 回答 → 理由 (sub-items) → So What, then the evidence (layer 3, the revision's assertions
 * after the 支持的证据 table); the Summary's 问题树 line says how the question is split; its table has 回答 after the
 * verdict and the model's short name. A judgment without the D-48 fields is written as before. ClaimResults come from
 * judgeClaim on a stub run; their conditions are written by hand (code checks them in M3's next commit).
 */
import { describe, expect, it } from 'vitest';
import type { Evidence } from '@/lib/research/evidence';
import { judgeClaim, type CheckedCondition, type ClaimResult, type KeyCounter } from '@/lib/research/judge';
import { conditionNote } from '@/lib/research/number-check';
import { citationFitLine, conditionLine, expandConditionRefs, renderClaimSection, renderReport, segmentAnswer, verdictWithConditions, withCitationFitLine, type AnswerSegment, type ReportFacts } from '@/lib/research/report';
import type { PlanClaim, ResearchRun } from '@/lib/research/run';
import { recommendationSchema, type SummaryDraft } from '@/lib/research/schemas';
import { checkReportText } from '@/lib/research/selfcheck';
import { RECOMMENDATION } from '../m2/research-fixture';

let n = 0;
const ev = (over: Partial<Evidence>): Evidence => {
  n++;
  return {
    ref: `[[s${n}#^c1]]`, path: `10_资料库/s${n}.md`, block: 'c1', text: 't', quote: `第 ${n} 条的原文，22% 由 IT 集中管。`, sourceName: `s${n}`, publisher: `P${n}`, url: `https://p${n}.com/a`,
    grade: 'A', origin: '网络', gradedBy: 'AI', published: null, claimId: 'C1', subQuestionId: 'C1-Q1', round: 'web1', stance: 'supports', reason: '', core: true, partial: false, ...over,
  };
};

const claimOf = (id: string, statement: string) => ({ id, statement, conditions: ['条件一', '条件二', '条件三'], hypothesis: null, sub_questions: [{ id: `${id}-Q1`, question: '谁拍板', methods: ['知识库', '网络'] }] }) as unknown as PlanClaim;

/** A judge on a stub run: two supports (E1, E2), one refute (E3) answered; `extra` = the D-48 fields. */
async function result(id: string, extra: Record<string, unknown>, verdict = '需要修改'): Promise<ClaimResult> {
  const list = [ev({ claimId: id }), ev({ claimId: id, grade: 'B' }), ev({ claimId: id, stance: 'refutes', grade: 'C' })];
  const run = {
    evidenceFor: () => list,
    ctx: { vault: { resolveLink: async () => ({ ok: false }) }, workspacePath: 'W', exploratory: false },
    subStates: new Map([[`${id}-Q1`, { stopNote: '证据已经够下判断' }]]),
    claimBrief: (c: PlanClaim) => ({ id: c.id, statement: c.statement, conditions: [] }),
    contextText: '',
    llm: async (_task: string, _p: { prompt: string }, schema: { parse: (x: unknown) => unknown }) =>
      schema.parse({
        verdict, rebutted: ['E3'], revised_statement: verdict === '需要修改' ? '改成 IT 管准入、钱由多方出 [E1]' : null,
        support_lines: ['监管要求建准入机制 [E1]', 'IT 侧接入 [E2]'],
        challenge_responses: [{ key: 'E3', challenge: '说预算在业务线', response: '只说明钱由多方出 [E1]', effect: '假设要改' }],
        revised_assertions: verdict === '需要修改' ? [{ text: 'IT 把关准入', keys: ['E1', 'E2'] }] : [],
        counter_lines: [], reasoning: '旧写法的一整段理由 [E1]', model_knowledge: [], so_what: ['所以联想先对准 IT'], gaps: ['缺少预算口径'], expert_questions: ['预算由谁批？'],
        ...extra,
      }),
  } as unknown as ResearchRun;
  return judgeClaim(run, claimOf(id, `${id} 的假设原句`), id === 'C1' ? 'H1' : 'H2-1', { n: 0 } as KeyCounter);
}

const CONDITIONS: CheckedCondition[] = [
  { n: 1, label: '①', text: '员工端 AI 要进机队，必须由 IT 登记', status: '成立', keys: ['E1', 'E2'], note: '' },
  { n: 2, label: '②', text: '30% 以上的采购由 IT 拍板', status: '证据不足', keys: ['E3'], note: 'AI 预算多在 IT 之外', adjusted: '模型判不成立，推翻它的反证只有 C 级' },
  { n: 4, label: '③', text: '影子 AI 能被 IT 收紧', status: '证据不足', keys: [], note: '' },
];
const D48 = { answer: 'IT 管准入；IT 集中管的只占 22% [E1]', reasons: ['监管要求建准入机制 [E1]', '22% 由 IT 集中管 [E2]'], changed: '改成 IT 管准入、钱由多方出', short_statement: 'IT 一手包办' };
const lines = (md: string) => md.split('\n');
const at = (md: string, re: RegExp) => lines(md).findIndex((l) => re.test(l));

describe('a hypothesis card (D-48)', () => {
  it('in order: ①②③, the verdict with the conditions not 成立, 改了什么, the split answer, 理由 as sub-items, So What; then layer 3', async () => {
    const r = { ...(await result('C2', D48)), conditions: CONDITIONS };
    const md = renderClaimSection(r, undefined, { depth: 4, qid: 'Q2-1' }).md;
    const L = lines(md);
    expect(L.slice(0, 13)).toEqual([
      '#### 假设 H2-1：C2 的假设原句',
      '- 当时的假设，逐条对照：',
      '  - ① 员工端 AI 要进机队，必须由 IT 登记 → 成立[^1][^2]',
      '  - ② 30% 以上的采购由 IT 拍板 → 证据不足：（系统复核：模型判不成立，推翻它的反证只有 C 级）AI 预算多在 IT 之外[^3]',
      '  - ③ 影子 AI 能被 IT 收紧 → 证据不足',
      '- 提议的判断：需要修改（② 证据不足、③ 证据不足）',
      '- 改了什么：改成 IT 管准入、钱由多方出',
      '- Q2-1 的回答：IT 管准入；IT 集中管的只占 22%[^1]',
      '- 理由：',
      '  - 监管要求建准入机制[^1]',
      '  - 22% 由 IT 集中管[^2]',
      '- So What：所以联想先对准 IT',
      '- 支持的证据：',
    ]);
    // the revision's assertions in layer 3: after the 支持的证据 table, before 反证和挑战
    const assertions = at(md, /^- 修改后的假设拆成几条/);
    expect(assertions).toBeGreaterThan(at(md, /^\| IT 侧接入/));
    expect(assertions).toBeLessThan(at(md, /^- 反证和挑战/));
    // what the checks read: the verdict word first (decisions/check), only the note of a condition line
    expect(md).toMatch(/提议的判断[^：:\n]*[：:]\s*需要修改/);
    expect(L.slice(2, 5).map(conditionNote)).toEqual(['[^1][^2]', 'AI 预算多在 IT 之外[^3]', '']);
  });

  it('an unsplit sub-question: "- 回答：" in the card; none when the model wrote no answer', async () => {
    const r = await result('C1', D48);
    expect(renderClaimSection(r, undefined, { depth: 3, qid: 'Q1' }).md).toMatch(/^- 改了什么：.*\n- 回答：IT 管准入；IT 集中管的只占 22%\[\^1\]\n- 理由：\n/m);
    const none = await result('C1', { ...D48, answer: '' });
    expect(renderClaimSection(none, undefined, { depth: 3, qid: 'Q1' }).md).not.toMatch(/^- 回答：/m);
  });

  it('成立 without 改了什么 says "没改"; a D-48 judgment without conditions says the bare verdict', async () => {
    const r = await result('C2', { ...D48, changed: '' }, '成立');
    const md = renderClaimSection(r, undefined, { depth: 4, qid: 'Q2-1' }).md;
    expect(md).toMatch(/^- 提议的判断：成立\n- 改了什么：没改\n- Q2-1 的回答：/m);
    expect(verdictWithConditions(await result('C2', D48))).toBe('需要修改');
  });

  it('a judgment written the old way: as before, its split answer now in the card (the follow-up adds none after it)', async () => {
    const r = await result('C2', {});
    const md = renderClaimSection(r, undefined, { depth: 4, qid: 'Q2-1' }).md;
    expect(md).toMatch(/^- 提议的判断：需要修改（改成：改成 IT 管准入、钱由多方出\[\^1\]）\n- Q2-1 的回答：改成 IT 管准入、钱由多方出\[\^1\]。\n- 理由：旧写法的一整段理由\[\^1\]\n- So What：/m);
    expect(md).not.toMatch(/当时的假设|^- 改了什么/m);
    // the older (non-tree) section is unchanged: its assertions before 支持的证据
    const old = renderClaimSection(r).md;
    expect(at(old, /^- 修正后的论断/)).toBeLessThan(at(old, /^- 支持的证据/));
  });

  it('conditionLine: a key the note already cites is not written twice', () => {
    const ex = (t: string) => t.replace(/\s*\[E(\d+)\]/g, '[^$1]');
    expect(conditionLine({ n: 1, label: '①', text: '条件', status: '不成立', keys: ['E3', 'E4'], note: '反证推翻了它 [E3]' }, ex)).toBe('  - ① 条件 → 不成立：反证推翻了它[^3][^4]');
  });
});

const plan = {
  question: '企业会为什么付钱？',
  claims: [
    { ...claimOf('C1', 'C1 的假设原句'), question: '谁决定买、谁出钱？', parent: null },
    { ...claimOf('C2', 'C2 的假设原句'), question: '「管得住」是不是门槛？', parent: 'Q2' },
  ],
  question_tree: [{ id: 'Q2', question: '按什么放行、按什么选？' }],
};
const facts: ReportFacts = {
  title: 'R', version: 5, question: plan.question, purpose: 'p', planLink: '[[计划 v3]]', workplanLink: '[[workplan]]', mode: 'full', exploratory: false,
  kbCount: 1, webCount: 1, searches: 24, fetches: 45, notExecuted: [], droppedQuotes: 0, adjustments: [], skipped: [], counterLines: [], plan: plan as unknown as ReportFacts['plan'],
};
const summary = (split?: string): SummaryDraft => ({
  so_what: '放不放行由 IT 定 [E1]', results: [], workplan_impact: ['和 IT 对齐 [E1]'], answers: [{ id: 'Q2', answer: '只在受监管行业是门槛 [E1]' }], sufficiency: '少一个都答不了',
  recommendation: recommendationSchema.parse(RECOMMENDATION), ...(split === undefined ? {} : { split_basis: split }),
});

describe('the Summary (D-48)', () => {
  it('问题树 opens with how it is split; the table: | 子问题 | 假设 | 提议的判断 | 回答 |, the short name, the verdict in column 3', async () => {
    const c1 = { ...(await result('C1', D48)), conditions: CONDITIONS };
    const c2 = await result('C2', { ...D48, answer: '只在银行保险这类行业是门槛 [E2]', short_statement: '管不住就出局' });
    const keyed = new Map([...c1.keyed, ...c2.keyed]);
    const b = renderReport(facts, [c1, c2], summary('按一笔采购的要素拆：谁拍板、按什么放行。'), keyed).body;
    expect(b).toContain('- 问题树：按一笔采购的要素拆：谁拍板、按什么放行：核心问题 → Q1 谁决定买、谁出钱？／Q2 按什么放行、按什么选？（→ Q2-1 「管得住」是不是门槛？）');
    expect(b).toContain('| 子问题 | 假设 | 提议的判断 | 回答 |');
    expect(b).toMatch(/^\| Q1 \| H1 IT 一手包办 \| 需要修改（② 证据不足、③ 证据不足） \| IT 管准入；IT 集中管的只占 22%\[\^\d+\] \|$/m);
    expect(b).toMatch(/^\| Q2-1 \| H2-1 管不住就出局 \| 需要修改 \| 只在银行保险这类行业是门槛\[\^\d+\] \|$/m);
    // Q1 is not split: its card, its "### Q1 的回答" and its Summary line say the same sentence (the page shows it once)
    const q1 = /^- 回答：(.*)$/m.exec(b)![1];
    expect(b).toContain(`### Q1 的回答\n\n${q1}`);
    expect(b).toContain(`  - Q1 → ${q1}`);
    // the split one answers in its card, once
    expect(b.match(/^- Q2-1 的回答：/gm)).toHaveLength(1);
    expect(checkReportText(b).filter((f) => f.code === 'uncited_number')).toEqual([]);
  });

  it('引用核对 (D-48 round 3): its counts in 附录 after 计划之外的调整, from the facts or put into a written body; none when not run', async () => {
    const c1 = await result('C1', D48);
    const counts = { checked: 12, replaced: 2, removed: 1, flagged: 1 };
    const line = '- 引用核对：查了 12 个，换了 2 个，删了 1 个，标了 1 个';
    expect(citationFitLine(counts)).toBe(line);
    const plain = renderReport(facts, [c1], summary(), c1.keyed).body;
    expect(plain).not.toContain('引用核对');
    const withFacts = renderReport({ ...facts, citationFit: counts }, [c1], summary(), c1.keyed).body;
    expect(withFacts).toMatch(new RegExp(`^- 计划之外的调整：.*\\n${line}\\n`, 'm'));
    expect(withCitationFitLine(plain, counts)).toBe(withFacts);
    // once: a second time replaces it
    expect(withCitationFitLine(withFacts, { ...counts, flagged: 0 }).match(/^- 引用核对：/gm)).toHaveLength(1);
    expect(withCitationFitLine(withFacts, { ...counts, flagged: 0 })).toContain('标了 0 个');
    expect(withCitationFitLine('# R\n\n## Summary\n', counts)).toBe('# R\n\n## Summary\n');
  });

  it('the one-line answer ends with "。" before code\'s brackets, its [Q1①] a pointer to the card (M1 验收 3, round 5 A)', async () => {
    const c1 = { ...(await result('C1', D48)), conditions: CONDITIONS };
    const b = renderReport(facts, [c1], { ...summary(), so_what: '放不放行由 IT 定 [E1]，钱由多方出 [Q1②]' }, c1.keyed).body;
    expect(b).toMatch(/^- 回答（一句话）：放不放行由 IT 定\[\^\d+\]，钱由多方出（见 Q1 ②，待验证）。（由 Q1 的回答组装而成）$/m);
    const ended = renderReport(facts, [c1], { ...summary(), so_what: '放不放行由 IT 定 [E1]。' }, c1.keyed).body;
    expect(ended).toMatch(/^- 回答（一句话）：放不放行由 IT 定\[\^\d+\]。（由 Q1 的回答组装而成）$/m);
  });

  it('no split_basis (optional): the tree line as before; the short name missing: the statement', async () => {
    const c1 = await result('C1', { ...D48, short_statement: '' });
    const b = renderReport(facts, [c1], summary(), c1.keyed).body;
    expect(b).toMatch(/^- 问题树：核心问题 → Q1 /m);
    expect(b).toMatch(/^\| Q1 \| H1 C1 的假设原句 \| /m);
  });

  it('"- 所以联想：" right after 回答（一句话）: the recommendation\'s first sentence, its footnote shared with the table; none without one', async () => {
    const c1 = await result('C1', D48);
    const rec = recommendationSchema.parse({ ...RECOMMENDATION, decision_answer: '提议：联想押管理栈 [E1]。依据：买方把管理写进招标 [E1]' });
    const b = renderReport(facts, [c1], { ...summary(), recommendation: rec }, c1.keyed).body;
    const m = /^- 回答（一句话）：.*\n- 所以联想：押管理栈\[\^(\d+)\]。\n- 问题树：/m.exec(b);
    expect(m).not.toBeNull();
    expect(b).toContain(`| 对决策的回答 | 提议：联想押管理栈[^${m![1]}]<br>依据：买方把管理写进招标[^${m![1]}] |`);
    const none = renderReport(facts, [c1], { ...summary(), recommendation: recommendationSchema.parse({ ...RECOMMENDATION, decision_answer: '' }) }, c1.keyed).body;
    expect(none).not.toContain('所以联想：');
  });

  it('a rewrite: "## 本版变化（v5，只改写法）" right after Summary, the verdicts that moved', async () => {
    const c1 = await result('C1', D48, '成立');
    const b = renderReport({ ...facts, rewrite: { from: 4, fromLink: '[[d/报告 v4|报告 v4]]', plan: '沿用计划 v2', verdictsBefore: { C1: '需要修改' } } }, [c1], summary(), c1.keyed).body;
    expect(b).toContain(
      [
        '## 本版变化（v5，只改写法）',
        '- 本版只改写法，证据沿用 v4（[[d/报告 v4|报告 v4]]），没有重新调查。',
        '- 计划：沿用计划 v2',
        '- 判断变了的：H1：需要修改 → 成立',
        '- 判断每次重跑会有出入（同一个判断模型自己跟自己约 84% 一致），上面如实列出。',
        '',
        '## 怎么查的',
      ].join('\n'),
    );
    // the counts are v4's, said so next to 本版变化
    expect(b).toContain('；联网搜索 24 次、抓取 45 次（v4 当时；本版没有重新调查）；完整调查。');
    expect(renderReport(facts, [c1], summary(), c1.keyed).body).toContain('；联网搜索 24 次、抓取 45 次；完整调查。');
    const same = renderReport({ ...facts, rewrite: { from: 4, fromLink: 'x', plan: 'y', verdictsBefore: { C1: '成立' } } }, [c1], summary(), c1.keyed).body;
    expect(same).toContain('- 判断变了的：各假设的判断都没变');
  });
});

/** M3's schema field, set by hand until judgmentSchema has it. */
const withSegments = (r: ClaimResult, answer_segments: AnswerSegment[]): ClaimResult => ({ ...r, conditions: CONDITIONS, judgment: { ...r.judgment, answer_segments } as ClaimResult['judgment'] });

describe('round 4, S1: the answer from its segments, by code', () => {
  const SEGS: AnswerSegment[] = [
    { text: 'IT 管准入。', cond: '①', keys: ['E1', 'E9'] },
    { text: '30% 以上由 IT 拍板', cond: '②', keys: ['E3'] },
    { text: '影子 AI 多半收得紧', cond: 'Q2-1③', keys: [] },
  ];

  it('each part\'s footnotes at its end, only keys its condition cites; 证据不足 unhedged gets "（还缺证据）"; "；" between, "。" at the end', async () => {
    const r = withSegments(await result('C2', D48), SEGS);
    const log: string[] = [];
    const ex = (t: string) => t.replace(/\s*\[E(\d+)\]/g, '[^$1]');
    // round 5: E3 refutes this hypothesis, so it does not stand behind ②'s positive part (research:role-dropped)
    expect(segmentAnswer(r, ex, (m) => log.push(m))).toBe('IT 管准入[^1]；30% 以上由 IT 拍板（还缺证据）；影子 AI 多半收得紧。');
    expect(log).toEqual(['H2-1 回答的一段（①）引用了 [E9]，不是条件 ① 挂过的编号，去掉了', 'H2-1 回答的一段（②）把反证 [E3] 挂在了正面的说法上，去掉了']);
  });

  it('marks the model wrote in a segment\'s text are taken out; no segments: null, and the card falls back to answer (logged)', async () => {
    const r = withSegments(await result('C2', D48), [{ text: '只在受监管行业[^4] [E2] [Q2-1①]', cond: '①', keys: ['E2'] }]);
    expect(segmentAnswer(r, (t) => t)).toBe('只在受监管行业 [E2]。');
    const old = { ...(await result('C2', D48)), conditions: CONDITIONS };
    expect(segmentAnswer(old, (t) => t)).toBeNull();
    const out = renderClaimSection(old, undefined, { depth: 4, qid: 'Q2-1' });
    expect(out.log).toEqual(['H2-1 没有写回答分段（answer_segments），用了旧的 answer']);
  });

  it('the card and the Summary: the split sub-question\'s answer said once in the card, listed by code in 各子问题的回答', async () => {
    const c2 = withSegments(await result('C2', D48), SEGS);
    const out = renderReport(facts, [c2], summary(), c2.keyed);
    const b = out.body;
    const card = /^- Q2-1 的回答：(.*)$/m.exec(b)![1];
    expect(card).toMatch(/^IT 管准入\[\^\d+\]；30% 以上由 IT 拍板（还缺证据）；影子 AI 多半收得紧。$/);
    expect(b).toContain(`  - Q2 → Q2-1：${card.replace(/。$/, '')}。`);
    expect(b).toContain(`### Q2 的回答\n\nQ2-1：${card.replace(/。$/, '')}。`);
    expect(out.segmentLog).toEqual(['H2-1 回答的一段（①）引用了 [E9]，不是条件 ① 挂过的编号，去掉了']);
    expect(out.roleLog).toEqual(['H2-1 回答的一段（②）把反证 [E3] 挂在了正面的说法上，去掉了']);
  });
});

describe('round 4, S2: [Q2-1①] in the recommendation', () => {
  const conds = new Map([
    ['Q2-1①', CONDITIONS[0]],
    ['Q2-1②', CONDITIONS[1]],
    ['Q1③', CONDITIONS[2]],
  ]);

  it('the condition\'s evidence; 证据不足 says "（靠 Q2-1 ②，待验证）"; another card\'s condition without its keys; an unknown one by name', () => {
    expect(expandConditionRefs('IT 管准入 [Q2-1①]', conds)).toBe('IT 管准入 [E1] [E2]');
    expect(expandConditionRefs('IT 拍板 [Q2-1②]', conds)).toBe('IT 拍板 [E3]（靠 Q2-1 ②，待验证）');
    expect(expandConditionRefs('收紧 [Q1③]', conds)).toBe('收紧（靠 Q1 ③，待验证）');
    expect(expandConditionRefs('IT 管准入 [Q2-1①]', conds, () => false)).toBe('IT 管准入（靠 Q2-1 ①）');
    expect(expandConditionRefs('x [Q9①]', conds)).toBe('x（Q9 ①）');
  });

  it('in the rendered table (round 5 A): a link to the condition in its card, its footnotes not carried; 证据不足 says 待验证', async () => {
    const c2 = { ...(await result('C2', D48)), conditions: CONDITIONS.map((c) => (c.label === '②' ? { ...c, keys: ['E2', 'E3'] } : c)) };
    const rec = recommendationSchema.parse({ ...RECOMMENDATION, action: '先做准入包。依据：IT 拍板 [Q2-1②]' });
    const b = renderReport(facts, [c2], { ...summary(), recommendation: rec }, c2.keyed).body;
    expect(b).toMatch(/^\| 做什么 \| 先做准入包（自研）<br>依据：IT 拍板（见 Q2-1 ②，待验证） \|$/m);
  });
});

