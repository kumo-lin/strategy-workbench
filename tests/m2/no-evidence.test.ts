/**
 * 3.1 (5.0 run-through): a live small run that found nothing wrote the briefing's own words into the
 * report ("本步下发的材料里证据清单为空"). The words of a no-evidence result are now written by code,
 * and wording from the step prompts is scrubbed from every model-written field. A page that cannot be
 * opened is not "the topic has no evidence".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeResearch } from '@/lib/research/execute';
import { judgeClaim, noEvidenceJudgment, type KeyCounter } from '@/lib/research/judge';
import { clearPageCache } from '@/lib/research/page-cache';
import type { ProgressEvent } from '@/lib/research/progress';
import { expandCitations, renderClaimSection, scrubInternalWording } from '@/lib/research/report';
import type { PlanClaim, ResearchRun } from '@/lib/research/run';
import { fakeWeb, scriptedModel, setup } from './research-fixture';

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

describe('scrubInternalWording', () => {
  it('drops the clause that talks about the briefing and keeps the rest', () => {
    expect(scrubInternalWording('证据不足：本步下发的材料里证据清单为空，无法证明 H1 成立。')).toBe('证据不足：无法证明 H1 成立。');
    expect(scrubInternalWording('只依据我给你的材料，IT 部门主导采购。')).toBe('IT 部门主导采购。');
  });
  it('leaves ordinary prose alone, including 材料 and 清单 used about the topic', () => {
    const t = '采购清单由 IT 部门审批，材料显示预算在 CIO 手里。';
    expect(scrubInternalWording(t)).toBe(t);
  });
  it('never returns an empty field', () => {
    expect(scrubInternalWording('证据清单为空')).toBe('（这一项没有可写的内容）');
  });
  it('runs before citations are expanded, so quotes from sources are never touched', () => {
    const out = expandCitations('本步下发的材料为空，见 [E1]', new Map());
    expect(out.text).not.toMatch(/下发/);
  });
});

describe('a claim with nothing to judge on', () => {
  const claim = { id: 'C1', statement: 'IT 可管理性决定企业是否采购', conditions: [], hypothesis: null, sub_questions: [{ id: 'C1-Q1', question: '谁拍板', methods: ['知识库', '网络'] }] } as unknown as PlanClaim;
  const stubRun = () => {
    const llm = vi.fn();
    const run = {
      evidenceFor: () => [],
      ctx: { vault: { resolveLink: async () => ({ ok: false }) }, workspacePath: 'W', exploratory: false },
      subStates: new Map([['C1-Q1', { stopNote: '最后一轮联网没有新证据，停止' }]]),
      claimBrief: (c: PlanClaim) => ({ id: c.id, statement: c.statement, conditions: [] }),
      contextText: '',
      llm,
    } as unknown as ResearchRun;
    return { run, llm };
  };

  it('does not ask the model; the verdict is 证据不足 and the words are written by code', async () => {
    const { run, llm } = stubRun();
    const counter: KeyCounter = { n: 0 };
    const r = await judgeClaim(run, claim, 'H1', counter);
    expect(llm).not.toHaveBeenCalled();
    expect(r.verdict).toBe('证据不足');
    expect(r.adjusted).toBe(false);
    const md = renderClaimSection(r).md;
    expect(md).toContain('提议的判断：证据不足');
    expect(md).toContain('没有能回答「谁拍板」的证据');
    expect(md).not.toMatch(/C\d+-Q\d+/); // 复核 A: no internal sub-question id for the reader
    expect(md).not.toMatch(/下发|证据清单|材料里/);
  });

  it('T55: the gap says what is missing, not how the search went (that stays in the run steps and the search cards)', () => {
    const notes = ['连续 2 轮联网没有新证据，停止；证据不足的部分转成要问专家的问题', '已联网 2 轮，仍无法判断，停止；转成要问专家的问题'];
    const j = noEvidenceJudgment(claim, notes.map((note, i) => ({ id: `C1-Q${i + 1}`, question: ['谁拍板', '谁付钱'][i], note })));
    expect(j.gaps).toEqual(['没有能回答「谁拍板」的证据', '没有能回答「谁付钱」的证据']);
    expect(j.gaps.join('')).not.toMatch(/联网|轮|\d/);
  });

  it('T55: the question for an expert names the hypothesis and asks for data, not for how a purchase is decided (topics are not all procurement)', () => {
    const j = noEvidenceJudgment({ ...claim, statement: '高频任务能够形成持续使用习惯' } as PlanClaim, []);
    expect(j.expert_questions).toEqual(['「高频任务能够形成持续使用习惯」有没有可核对的数据或一线经验？']);
  });

  it('noEvidenceJudgment is a valid judgment without any citation key', () => {
    const j = noEvidenceJudgment(claim, []);
    expect(JSON.stringify(j)).not.toMatch(/\[E\d+\]/);
    expect(j.gaps.length).toBeGreaterThan(0);
  });
});

describe('a model that leaks the briefing in a judged claim', () => {
  it('the leaked clause never reaches the report', async () => {
    const fx = await setup({ mode: undefined } as never);
    cleanup = fx.cleanup;
    const sm = scriptedModel({
      judge: (k) => ({
        verdict: '证据不足',
        rebutted: [],
        revised_statement: null,
        support_lines: k.supports.slice(0, 1).map((e) => `IT 部门参与采购 [${e}]`),
        counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'],
        reasoning: '本步下发的材料里证据清单不够，只有一条支持',
        model_knowledge: [],
        so_what: ['证据清单为空，先别下结论', '先和 IT 负责人确认'],
        gaps: [],
        expert_questions: [],
      }),
    });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    const body = (await fx.vault.read(r.reportPath!)).body;
    expect(body).not.toMatch(/下发|证据清单/);
    expect(body).toContain('先和 IT 负责人确认');
  });
});

describe('a page that cannot be opened', () => {
  /** The two best-ranked pages of every search are 404s (a paywalled reprint, a PDF): only the third opens. */
  function flakyWeb() {
    const web = fakeWeb();
    const inner = web.fetch.bind(web);
    web.fetch = async (req) => {
      if (Number(/report\/(\d+)/.exec(req.url)?.[1]) % 3 !== 0) {
        web.fetches.push(req.url);
        throw new Error('/v1/tools/fetch failed: HTTP 404 failed to fetch URL');
      }
      return inner(req);
    };
    return web;
  }

  it('full mode: takes the next page from the same search and says how many would not open', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const events: ProgressEvent[] = [];
    const web = flakyWeb();
    const r = await executeResearch({ ctx: fx.ctx, mode: 'full', model: scriptedModel().model, webClient: web, emit: (e) => events.push(e) });
    const rows = events.filter((e) => e.kind === 'step') as Extract<ProgressEvent, { kind: 'step' }>[];
    expect(rows.some((s) => /打不开/.test(s.detail ?? ''))).toBe(true);
    // the third page of a search (k % 3 === 0) was only fetched because the first two failed
    expect(web.fetches.some((u) => Number(/report\/(\d+)/.exec(u)?.[1]) % 3 === 0)).toBe(true);
    expect(r.counts.webSources).toBeGreaterThan(0);
  });

  it('small mode (no spare fetch): a round where every page failed is not reported as "no new evidence"', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const events: ProgressEvent[] = [];
    const web = fakeWeb();
    web.fetch = async (req) => {
      web.fetches.push(req.url);
      throw new Error('HTTP 404');
    };
    await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: web, emit: (e) => events.push(e) });
    const rows = events.filter((e) => e.kind === 'step') as Extract<ProgressEvent, { kind: 'step' }>[];
    expect(rows.some((s) => s.step === 3 && /打不开/.test(s.detail ?? ''))).toBe(true);
    expect(rows.some((s) => /联网没有新证据/.test(s.detail ?? ''))).toBe(false);
  });
});

describe('专家意见 line: one line per interview answer', () => {
  it('an answer judged under two sub-questions with two stances is listed once, as a challenge', () => {
    const base = { path: 'x.md', block: 'e5', text: 't', quote: '管得太死，员工会绕过去。', sourceName: '访谈', publisher: '专家访谈（模拟）', url: null, grade: 'C', origin: '专家访谈', gradedBy: 'AI', sourceKind: 'expert', simulated: true, published: null, claimId: 'C1', round: 'kb', reason: '', core: false, partial: false } as const;
    const e1 = { ...base, ref: '[[访谈#^e5]]', subQuestionId: 'C1-Q1', stance: 'supports' as const };
    const e2 = { ...base, ref: '[[访谈#^e5]]', subQuestionId: 'C1-Q2', stance: 'refutes' as const };
    const claim = { id: 'C1', statement: 'IT 可管理性决定采购', conditions: [], hypothesis: null, sub_questions: [] } as unknown as PlanClaim;
    const r = { claim, label: 'H1', hypothesisPath: null, hypothesisLink: null, evidence: [e1, e2], keyed: new Map(), challenges: [], judgment: noEvidenceJudgment(claim, []), verdict: '证据不足', adjusted: false, adjustNote: '', revisedStatement: null, subNotes: [] } as never;
    const md = renderClaimSection(r).md;
    expect(md.match(/- (挑战|同向的看法（不算支持证据）)\[\^/g)).toHaveLength(1);
    expect(md).toMatch(/- 挑战\[\^1\]：管得太死/);
  });

  it('the race behind the flaky run: one sub-question falling through to a spare page never takes the fetch the other one needs', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const events: ProgressEvent[] = [];
    const web = fakeWeb();
    const search = web.search.bind(web);
    let calls = 0;
    // the second sub-question's search answers later: the first one's failed fetch (and its fall-through) happens first
    web.search = async (req) => {
      const i = ++calls;
      if (i === 2) await new Promise((r) => setTimeout(r, 60));
      return search(req);
    };
    web.fetch = async (req) => {
      web.fetches.push(req.url);
      throw new Error('HTTP 404');
    };
    await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: web, emit: (e) => events.push(e) });
    const rows = events.filter((e) => e.kind === 'step') as Extract<ProgressEvent, { kind: 'step' }>[];
    // both sub-questions got their own page to try (each round says a page would not open) …
    const step3 = rows.filter((s) => s.step === 3 && s.status === 'done');
    expect(step3.map((s) => s.id).sort()).toEqual(['s3:C1-Q1', 's3:C1-Q2']);
    for (const s of step3) expect(s.detail).toMatch(/打不开/);
    // … and neither is told "no new evidence" because it never got to read anything
    expect(rows.some((s) => /联网没有新证据/.test(s.detail ?? ''))).toBe(false);
  });
});

