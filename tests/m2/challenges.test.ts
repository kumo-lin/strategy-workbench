/**
 * D-21: the judge was shown only the 6 strongest refutes (grade × 2 + core), so all four interview challenges of H1
 * were cut off, never answered, and the self-check (which looked only at what the judge saw) let the report through.
 */
import { describe, expect, it } from 'vitest';
import type { Evidence } from '@/lib/research/evidence';
import { challengeFailures, judgeClaim, MAX_ORDINARY_REFUTES, selectEvidence, type KeyCounter } from '@/lib/research/judge';
import { recommendationGaps, renderClaimSection } from '@/lib/research/report';
import type { PlanClaim, ResearchRun } from '@/lib/research/run';
import { queryPlanSchema } from '@/lib/research/schemas';
import { RECOMMENDATION } from './research-fixture';

let n = 0;
const ev = (over: Partial<Evidence>): Evidence => {
  n++;
  return {
    ref: `[[s${n}#^c1]]`, path: `10_资料库/s${n}.md`, block: 'c1', text: 't', quote: `第 ${n} 条反证的原文。`, sourceName: `s${n}`, publisher: `P${n}`, url: `https://p${n}.com/a`,
    grade: 'B', origin: '网络', gradedBy: 'AI', published: null, claimId: 'C1', subQuestionId: 'C1-Q1', round: 'web1', stance: 'refutes', reason: '', core: false, partial: false, ...over,
  };
};
const expert = (i: number, over: Partial<Evidence> = {}) =>
  ev({ ref: `[[访谈（模拟）#^e${i}]]`, block: `e${i}`, quote: `受访者：反面意见 ${i}，管得太死员工会绕过去。`, grade: 'C', origin: '专家访谈', sourceKind: 'expert', simulated: true, publisher: '专家访谈（模拟）', url: null, ...over });

// 8 refutes: 4 interview challenges (grade C, the lowest), 4 B-grade web refutes ranked above them; 2 supports
const evidence = (): Evidence[] => [
  ...[1, 2, 3, 4].map((i) => expert(i)),
  ...[1, 2, 3, 4].map(() => ev({})),
  ev({ stance: 'supports', grade: 'A' }),
  ev({ stance: 'supports', grade: 'B' }),
];
const claim = { id: 'C1', statement: 'IT 可管理性决定采购', conditions: [], hypothesis: null, sub_questions: [{ id: 'C1-Q1', question: '谁拍板', methods: ['知识库', '网络'] }] } as unknown as PlanClaim;

/** A judge that answers exactly the refutes it is shown (as the real one does): one row per "反驳" line in its prompt. */
function stubRun(list: Evidence[]) {
  const prompts: string[] = [];
  const run = {
    evidenceFor: () => list,
    ctx: { vault: { resolveLink: async () => ({ ok: false }) }, workspacePath: 'W', exploratory: false },
    subStates: new Map([['C1-Q1', { stopNote: '证据已经够下判断' }]]),
    claimBrief: (c: PlanClaim) => ({ id: c.id, statement: c.statement, conditions: [] }),
    contextText: '',
    llm: async (_task: string, p: { prompt: string }, schema: { parse: (x: unknown) => unknown }) => {
      prompts.push(p.prompt);
      const supports = [...p.prompt.matchAll(/^\[(E\d+)\] 支持/gm)].map((m) => m[1]);
      // each refute line: "[E5] 反驳（C 级，…）<quote>  ——评估理由：…": the answer names what it answers by its quote
      const refutes = [...p.prompt.matchAll(/^\[(E\d+)\] 反驳[^（]*（[^）]*）(.*?)  ——/gm)].map((m) => ({ k: m[1], quote: m[2] }));
      return schema.parse({
        verdict: '需要修改', rebutted: [], revised_statement: '只在管理严格的大企业成立',
        support_lines: supports.map((k) => `IT 主导采购 [${k}]`),
        challenge_responses: refutes.map((x) => ({ key: x.k, challenge: `针对「${x.quote}」`, response: '论点因此收窄', effect: '收窄' })),
        counter_lines: [], reasoning: '推导', model_knowledge: [], so_what: [], gaps: [], expert_questions: [],
      });
    },
  } as unknown as ResearchRun;
  return { run, prompts };
}

describe('every challenge reaches the judge and the response table', () => {
  it('8 refutes, 4 of them interview challenges: all 4 challenges are in the response table, and the check passes', async () => {
    const list = evidence();
    const { run, prompts } = stubRun(list);
    const r = await judgeClaim(run, claim, 'H1', { n: 0 } as KeyCounter);
    // the judge saw every challenge, and was told to answer each
    for (const i of [1, 2, 3, 4]) expect(prompts[0]).toContain(`受访者：反面意见 ${i}`);
    expect(r.challenges).toHaveLength(4);
    expect(prompts[0]).toMatch(/这几条必须回应：(\[E\d+\]、){3}\[E\d+\]/);
    const md = renderClaimSection(r).md;
    const rows = md.split('\n').filter((l) => /^\| 针对「/.test(l));
    expect(rows).toHaveLength(8);
    for (const i of [1, 2, 3, 4]) expect(rows.filter((l) => l.includes(`受访者：反面意见 ${i}`))).toHaveLength(1);
    expect(challengeFailures([r])).toEqual([]);
  });

  it('the cap applies to ordinary refutes only', () => {
    const many = [...[1, 2, 3].map((i) => expert(i)), ...Array.from({ length: 10 }, () => ev({})), ev({ core: true }), ev({ partial: true })];
    const { keyed } = selectEvidence(many, { n: 0 });
    const shown = [...keyed.values()];
    expect(shown.filter((e) => e.sourceKind === 'expert')).toHaveLength(3);
    expect(shown.filter((e) => e.core || e.partial)).toHaveLength(2);
    expect(shown.filter((e) => e.sourceKind !== 'expert' && !e.core && !e.partial)).toHaveLength(MAX_ORDINARY_REFUTES);
  });

  it('a challenge the judge did not answer, or never saw, fails the self-check (counted on the evidence record)', async () => {
    const list = evidence();
    const { run } = stubRun(list);
    const r = await judgeClaim(run, claim, 'H1', { n: 0 } as KeyCounter);
    const unanswered = { ...r, judgment: { ...r.judgment, challenge_responses: r.judgment.challenge_responses.filter((c) => r.keyed.get(c.key)?.sourceKind !== 'expert') } };
    expect(challengeFailures([unanswered]).map((f) => f.code)).toEqual(Array(4).fill('unanswered_challenge'));
    // a challenge in the record that was not keyed at all (the D-21 hole) is a failure too
    const hidden = { ...r, evidence: [...r.evidence, expert(9)] };
    expect(challengeFailures([hidden]).some((f) => /没有交给判断那一步/.test(f.message))).toBe(true);
  });
});

describe('the recommendation does not stand on simulated interviews', () => {
  it('citing an interview anywhere in the recommendation is a gap; citing a source is not', () => {
    const keyed = new Map<string, Evidence>([['E8', expert(3)], ['E2', ev({ stance: 'supports' })]]);
    const withInterview = { ...RECOMMENDATION, alternatives: [...RECOMMENDATION.alternatives.slice(0, 2), { ...RECOMMENDATION.alternatives[2], why_not: '只是入场券 [E8]' }] };
    expect(recommendationGaps(withInterview as never, keyed).join('\n')).toMatch(/推荐判断引用了模拟访谈 \[E8\]/);
    expect(recommendationGaps({ ...RECOMMENDATION, scale: '2–3 家 [E2]' } as never, keyed)).toEqual([]);
  });
});

describe('too many queries', () => {
  it('extra kb / web queries are cut, the plan is kept (C2-Q4 was dropped for 6 kb_queries)', () => {
    const q = queryPlanSchema.parse({ kb_queries: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], web_queries: ['1', '2', '3', '4'] });
    expect(q.kb_queries).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(q.web_queries).toEqual(['1', '2', '3']);
  });
});

describe('long answers (D-21 live run: 11 challenge responses failed the whole judge call)', () => {
  it('challenge_responses has no cap; other lists are cut to their limit instead of refusing the answer', async () => {
    const { judgmentSchema, extractionSchema } = await import('@/lib/research/schemas');
    const many = Array.from({ length: 14 }, (_, i) => ({ key: `E${i + 1}`, challenge: 'c', response: 'r', effect: '收窄' }));
    const j = judgmentSchema.parse({ verdict: '证据不足', reasoning: 'x', challenge_responses: many, support_lines: Array.from({ length: 12 }, (_, i) => `s${i}`) });
    expect(j.challenge_responses).toHaveLength(14);
    expect(j.support_lines).toHaveLength(8);
    expect(extractionSchema.parse({ claims: Array.from({ length: 13 }, () => ({ quote: 'q' })) }).claims).toHaveLength(10);
  });

  it('a judge answer that never parses leaves the claim 证据不足 with its challenges unanswered (a draft), not a crashed run', async () => {
    const { LlmJsonError } = await import('@/lib/research/llm');
    const logs: string[] = [];
    const run = {
      ...stubRun(evidence()).run,
      log: async (action: string) => void logs.push(action),
      llm: async () => {
        throw new LlmJsonError('judge:C1: model did not return valid JSON');
      },
    } as unknown as ResearchRun;
    const r = await judgeClaim(run, claim, 'H1', { n: 0 } as KeyCounter);
    expect(r.verdict).toBe('证据不足');
    expect(logs).toContain('research:judge-failed');
    expect(challengeFailures([r])).toHaveLength(4);
  });
});
