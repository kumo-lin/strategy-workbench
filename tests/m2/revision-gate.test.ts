/**
 * D-29: a 需要修改 verdict claims something new (the revised statement), so its core assertions must clear the 成立 bar
 * one by one (H2's revised "入围条件" stood on one C-grade retelling). What fails is 待验证: shown as such, asked of
 * experts; the recommendation may lean on it only openly, with what changes if it fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summaryPrompt } from '@/lib/harness/prompts/research-execute';
import type { Evidence } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import { checkAssertions, type CheckedAssertion } from '@/lib/research/judge';
import { clearPageCache } from '@/lib/research/page-cache';
import { assertionGaps, expandAssertionKeys } from '@/lib/research/report';
import type { Judgment } from '@/lib/research/schemas';
import { fakeWeb, RECOMMENDATION, scriptedModel, setup } from './research-fixture';

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

const ev = (publisher: string, grade: 'A' | 'B' | 'C') =>
  ({ ref: `[[${publisher}#^c1]]`, publisher, url: `https://${publisher}.com/a`, grade, stance: 'supports', sourceKind: 'source', quote: 'q' }) as unknown as Evidence;

describe('checkAssertions: the 成立 bar, per assertion', () => {
  const keyed = new Map<string, Evidence>([
    ['E1', ev('idc', 'B')],
    ['E2', ev('gartner', 'C')],
    ['E3', ev('blog', 'C')],
    ['E4', { ...ev('interview', 'C'), sourceKind: 'expert', simulated: true } as Evidence],
    ['E5', ev('idc2', 'C')],
  ]);
  const judgment = (assertions: Judgment['revised_assertions']) => ({ revised_assertions: assertions }) as Judgment;

  it('2 independent supports with an A/B one: 已验证; one source, only C, or an interview: 待验证', () => {
    const out = checkAssertions('H2', judgment([
      { text: '可管理性是入围条件', keys: ['E1', 'E2'] },
      { text: '溢价不被接受', keys: ['E3'] },
      { text: '只有 C 级', keys: ['E2', 'E3'] },
      { text: '靠模拟访谈', keys: ['E1', 'E4'] },
      { text: '编号不存在', keys: ['E99'] },
    ]), keyed);
    expect(out.map((a) => [a.key, a.status])).toEqual([
      ['H2-A1', '已验证'],
      ['H2-A2', '待验证'],
      ['H2-A3', '待验证'],
      ['H2-A4', '待验证'],
      ['H2-A5', '待验证'],
    ]);
    expect(out[0].basis).toBe('2 个独立来源，最高 B 级');
    expect(out[1].basis).toBe('只有 1 个独立来源，最高 C 级');
    expect(out[4].basis).toBe('没有资料证据支持');
  });
});

describe('a run that revises a claim', () => {
  const revise = (assertions: (s: string[]) => { text: string; keys: string[] }[]) => (k: { supports: string[]; refutes: string[] }) => ({
    verdict: '需要修改',
    rebutted: [],
    revised_statement: '只在管理严格的大企业里，IT 可管理性决定采购',
    revised_assertions: assertions(k.supports),
    support_lines: k.supports.slice(0, 2).map((e) => `IT 部门主导采购 [${e}]`),
    counter_lines: [],
    challenge_responses: k.refutes.map((c) => ({ key: c, challenge: '员工会绕开', response: `资料说 IT 部门主导采购 [${k.supports[0]}]；推断：员工绕开的只是使用，论点要收窄到管理严格的大企业`, effect: '收窄' })),
    reasoning: `IT 主导采购 [${k.supports[0]}]，但要收窄`,
    model_knowledge: [],
    so_what: [],
    gaps: [],
    expert_questions: [],
  });

  it('each assertion is shown with its status; a 待验证 one becomes a question for experts; the report is delivered', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const sm = scriptedModel({ judge: revise((s) => [{ text: 'IT 部门主导采购', keys: [s[0], s[2]] }, { text: '大企业更严格', keys: [s[3]] }]) });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    expect(r.failedChecks).toEqual([]);
    const body = (await fx.vault.read(r.reportPath)).body;
    expect(body).toContain('- 修正后的论断，逐条过证据门槛（至少 2 个独立来源、其中至少 1 个 A/B 级）：');
    expect(body).toMatch(/^ {2}- H1-A1（已验证：2 个独立来源，最高 B 级）：IT 部门主导采购\[\^\d+\]\[\^\d+\]$/m);
    expect(body).toMatch(/^ {2}- H1-A2（待验证：只有 1 个独立来源，最高 C 级；转成要问专家的问题）：大企业更严格\[\^\d+\]$/m);
    expect(body).toContain('  - 要问专家：核实「大企业更严格」（H1-A2 待验证：只有 1 个独立来源，最高 C 级）');
  });

  it('a revision not split into assertions is not delivered (the judge is asked again)', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const sm = scriptedModel({ judge: revise(() => []) });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    expect(r.delivered).toBe(false);
    expect(r.failedChecks.join('\n')).toMatch(/H1 判了“需要修改”，但修正后的假设没有拆成核心断言/);
    expect(sm.tasks).toContain('repair');
  });
});

describe('the recommendation and the summary', () => {
  const a2: CheckedAssertion = { key: 'H2-A2', text: '可管理性是入围条件', keys: ['E6'], status: '待验证', basis: '只有 1 个独立来源，最高 C 级' };
  const a1: CheckedAssertion = { key: 'H2-A1', text: '安全是首要顾虑', keys: ['E1', 'E2'], status: '已验证', basis: '2 个独立来源，最高 B 级' };

  it('leaning on a 待验证 assertion needs "推断：依赖待验证断言" and a change_if for it; a 已验证 one needs nothing', () => {
    const rec = (action: string, change_if: string[]) => ({ ...RECOMMENDATION, action, change_if }) as never;
    expect(assertionGaps(rec('把可管理性做成入围证明物 [H2-A2]', ['价格']), [a1, a2])).toEqual([
      '推荐判断用到了待验证断言 [H2-A2]，但没有标“推断：依赖待验证断言 [H2-A2]”',
      '“什么情况下要改”里没有写待验证断言 [H2-A2] 不成立时推荐改成什么',
    ]);
    expect(assertionGaps(rec('推断：依赖待验证断言 [H2-A2]，把可管理性做成入围证明物', ['若 [H2-A2] 不成立 → 改押生产力度量']), [a1, a2])).toEqual([]);
    expect(assertionGaps(rec('押管理栈 [H2-A1]', ['价格']), [a1, a2])).toEqual([]);
  });

  it('the key reads as words in the report, without the key: 「…」这条还没验证的判断（见 H2）', () => {
    expect(expandAssertionKeys('推断：依赖待验证断言 [H2-A2]', [a2])).toBe('推断：依赖「可管理性是入围条件」这条还没验证的判断（见 H2）');
    expect(expandAssertionKeys('押管理栈 [H2-A1]', [a1])).toBe('押管理栈 「安全是首要顾虑」这条已经验证的判断（见 H2）');
  });

  it('the summary prompt carries the statuses and the rule that 待验证 is not a fact', () => {
    const p = summaryPrompt({ question: 'q', purpose: 'p', exploratory: false, claims: [{ label: 'H2', statement: 's', verdict: '需要修改', adjustedNote: '', reasoning: 'r', soWhat: [], gaps: [], expertQuestions: [], keyEvidence: [], assertions: [a1, a2] }] }).prompt;
    expect(p).toContain('[H2-A2] 待验证（只有 1 个独立来源，最高 C 级）可管理性是入围条件');
    expect(p).toContain('"待验证"的论断不能写成事实');
  });
});
