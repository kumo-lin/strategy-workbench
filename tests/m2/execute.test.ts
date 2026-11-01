/**
 * 2.11 gate tests for the code-scheduled Deep Research run (PRD §6.3.1, §9.5–9.7,
 * CONTRACTS 3-b / 3-c), with a scripted mock model and a fake Search/Fetch client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTool, ToolNotAllowedError } from '@/lib/harness';
import { RESEARCH_LIMITS } from '@/lib/research/constants';
import { evaluatePrompt } from '@/lib/harness/prompts/research-execute';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import type { ProgressEvent } from '@/lib/research/progress';
import { citationFailures, checkReportText } from '@/lib/research/selfcheck';
import { EXPERT, fakeWeb, HYP, scriptedModel, setup } from './research-fixture';

/** The footnote number whose definition cites `ref` (e.g. "访谈（模拟）#^e2"). */
function footnoteOf(body: string, ref: string): string {
  const line = body.split('\n').find((l) => /^\[\^\d+\]:/.test(l) && l.includes(ref));
  if (!line) throw new Error(`no footnote cites ${ref}`);
  return /^\[\^(\d+)\]/.exec(line)![1];
}

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  clearPageCache();
  // ingest's link check must never hit the network in tests
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

async function run(opts: Parameters<typeof setup>[0] & { mode?: 'small' | 'full'; refuting?: boolean; script?: Parameters<typeof scriptedModel>[0] } = {}) {
  const fx = await setup(opts);
  cleanup = fx.cleanup;
  const web = fakeWeb({ refuting: opts.refuting });
  const sm = scriptedModel(opts.script);
  const events: ProgressEvent[] = [];
  const result = await executeResearch({ ctx: fx.ctx, mode: opts.mode ?? 'small', model: sm.model, webClient: web, emit: (e) => events.push(e) });
  const tools = events.filter((e) => e.kind === 'tool-start') as Extract<ProgressEvent, { kind: 'tool-start' }>[];
  const log = await fx.vault.readLog(fx.ctx.logPath);
  return { ...fx, web, sm, events, tools, result, log };
}

describe('gate: no approved plan, no research', () => {
  it('executeResearch refuses an unapproved plan, and web tools are not even in the phase', async () => {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    expect(fx.ctx.phase).toBe('research_plan');
    const web = fakeWeb();
    await expect(executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: web })).rejects.toBeInstanceOf(ToolNotAllowedError);
    await expect(executeTool('web_search', { sub_question_id: 'C1-Q1', query: 'x' }, fx.ctx)).rejects.toBeInstanceOf(ToolNotAllowedError);
    await expect(executeTool('ingest_source', { sub_question_id: 'C1-Q1', url: 'https://a.example.org', name: 'x' }, fx.ctx)).rejects.toBeInstanceOf(ToolNotAllowedError);
    expect(web.searches).toEqual([]);
    // the refusals are logged too
    expect((await fx.vault.readLog(fx.ctx.logPath)).map((r) => r.change).join('\n')).toMatch(/not available in phase/);
  });

  it('a search for a sub-question that is not in the approved plan is refused', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    expect(fx.ctx.phase).toBe('research_execute');
    await expect(executeTool('web_search', { sub_question_id: 'C9-Q1', query: 'x' }, fx.ctx)).rejects.toThrow(/not in the approved plan/);
  });

  it('the AI has no tool that writes a hypothesis while executing (verdict_proposed is system-only, 3-c)', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    await expect(
      executeTool('write_draft', { note_type: 'hypothesis', name: 'WS-A-H1 IT 可管理', frontmatter: { verdict_proposed: '成立' }, body: 'x' }, fx.ctx),
    ).rejects.toBeInstanceOf(ToolNotAllowedError);
  });
});

describe('small run, vault insufficient → web, counter round, report, verdict_proposed', () => {
  it('searches the vault before the web, always runs the counter round, stays in budget, delivers', async () => {
    const r = await run({ mode: 'small', script: { inventQuote: true } });

    // vault first: the first web_search comes after vault_search calls
    const firstWeb = r.tools.findIndex((t) => t.tool === 'web_search');
    const firstKb = r.tools.findIndex((t) => t.tool === 'vault_search');
    expect(firstKb).toBeGreaterThanOrEqual(0);
    expect(firstWeb).toBeGreaterThan(firstKb);

    // small mode: 1 claim, ≤ 2 sub-questions; C1-Q3 (expert-only) is left out
    const searchedSubs = new Set(r.tools.filter((t) => t.tool === 'web_search').map((t) => (t.input as { sub_question_id: string }).sub_question_id));
    expect([...searchedSubs].every((id) => ['C1-Q1', 'C1-Q2'].includes(id))).toBe(true);

    // budget: ≤ 3 searches, ≤ 3 fetches, counted at the client
    expect(r.web.searches.length).toBeLessThanOrEqual(RESEARCH_LIMITS.small.maxSearches);
    expect(r.web.fetches.length).toBeLessThanOrEqual(RESEARCH_LIMITS.small.maxFetches);
    expect(r.result.usage.searches).toBe(r.web.searches.length);

    // the counter round ran, and it searched the web with a counter query
    expect(r.events.some((e) => e.kind === 'step' && e.id === 's6:C1' && e.status === 'done')).toBe(true);
    expect(r.sm.tasks).toContain('queries:counter');
    expect(r.web.searches.some((q) => q.includes('并不'))).toBe(true);

    // the invented quote was dropped by the system and never became a block
    expect(r.result.counts.droppedQuotes).toBeGreaterThan(0);
    const sources = await r.vault.list('10_资料库');
    for (const s of sources) expect((await r.vault.read(s.path)).body).not.toContain('80% 以上');

    // delivered, every citation resolves and its quote matches
    expect(r.result.delivered).toBe(true);
    const report = await r.vault.read(r.result.reportPath);
    expect(report.data).toMatchObject({ type: 'report', delivery: '已交付', exploratory: false, status: '进行中', author: 'AI' });
    const checks = await r.vault.checkCitations(report.body);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.ok && c.quote)).toBe(true);
    expect(report.body.indexOf('## Summary')).toBeLessThan(report.body.indexOf('## 怎么查的'));
    // the run's numbers are in the frontmatter (M4's compare page reads them from here, not from the body text)
    expect(report.data.research_run).toMatchObject({
      mode: 'small',
      searches: r.result.usage.searches,
      fetches: r.result.usage.fetches,
      kbSources: r.result.counts.kbSources,
      webSources: r.result.counts.webSources,
    });
    const rr = report.data.research_run as { durationMs: number; model: string };
    expect(rr.durationMs).toBeGreaterThan(0);
    expect(rr.durationMs).toBeLessThanOrEqual(r.result.durationMs + 50);
    expect(typeof rr.model).toBe('string');
    expect(report.body).not.toMatch(/\[E\d+/); // every evidence key was expanded into a real citation

    // 3-c: system code wrote verdict_proposed; the human verdict is untouched
    const hyp = await r.vault.read(HYP);
    expect(hyp.data.verdict_proposed).toBe(r.result.claims[0].verdict);
    expect(hyp.data.verdict).toBeNull();
    expect(r.log.some((row) => row.action === 'system:verdict_proposed')).toBe(true);

    // every tool call is in the log
    const toolRows = r.log.filter((row) => row.action.startsWith('tool:'));
    expect(toolRows.length).toBe(r.tools.length);
  });

  it('a verdict the evidence does not support is downgraded by the system (§9.5)', async () => {
    const r = await run({
      mode: 'small',
      script: {
        // 不成立 needs an A/B refute of the core premise; the web pages here are C-grade and not core
        judge: () => ({ verdict: '不成立', rebutted: [], support_lines: [], counter_lines: [], reasoning: '直觉', so_what: [], gaps: [], expert_questions: [] }),
      },
    });
    expect(r.result.claims[0]).toMatchObject({ verdict: '证据不足', adjusted: true });
    const report = await r.vault.read(r.result.reportPath);
    expect(report.body).toContain('系统复核');
  });
});

describe('stop rule (§9.6)', () => {
  it('when the vault alone decides, the support rounds do not go to the web — only the counter round does', async () => {
    const r = await run({ mode: 'small', withSourceB: true, refuting: false });
    const steps = r.events.filter((e) => e.kind === 'step');
    expect(steps.filter((e) => e.step === 3).every((e) => e.status === 'skipped')).toBe(true);
    const searches = r.tools.filter((t) => t.tool === 'web_search');
    expect(searches).toHaveLength(1); // the counter round only
    expect(r.result.claims[0].verdict).toBe('成立');
  });

  it('full mode: at most 2 web rounds per sub-question, at most 30 searches in total', async () => {
    const r = await run({
      mode: 'full',
      claims: 3,
      subQuestions: 4,
      // never decidable: no supports at all, so every sub-question wants more
      script: { judge: () => ({ verdict: '证据不足', rebutted: [], support_lines: [], counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'], reasoning: '证据不足', so_what: [], gaps: ['都缺'], expert_questions: ['问谁？'] }) },
    });
    const perSub = new Map<string, number>();
    for (const t of r.tools.filter((x) => x.tool === 'web_search')) {
      const why = String((t.input as { why?: string }).why);
      if (why.includes('反证')) continue;
      const id = (t.input as { sub_question_id: string }).sub_question_id;
      perSub.set(id, (perSub.get(id) ?? 0) + 1);
    }
    expect(Math.max(...perSub.values())).toBeLessThanOrEqual(RESEARCH_LIMITS.full.webRoundsPerSubQuestion);
    expect(r.web.searches.length).toBeLessThanOrEqual(RESEARCH_LIMITS.full.maxSearches);
    // one counter round per claim, each with a web search
    expect(r.events.filter((e) => e.kind === 'step' && e.step === 6 && e.status === 'done')).toHaveLength(3);
  }, 60_000); // 3 claims x 4 sub-questions with the vault on disk: ~5 s alone, over the 5 s default when the whole suite runs in parallel
});

describe('self-check: one failing item ⇒ not delivered', () => {
  it('an uncited number survives the repair rounds → report stays a draft, no verdict_proposed', async () => {
    const r = await run({
      mode: 'small',
      script: {
        judge: () => ({
          verdict: '证据不足',
          rebutted: [],
          support_lines: ['渗透率达到 32%'], // no [E#]
          counter_lines: [],
          reasoning: '缺数据',
          so_what: [],
          gaps: [],
          expert_questions: [],
        }),
      },
    });
    expect(r.result.delivered).toBe(false);
    expect(r.result.failedChecks.join('\n')).toMatch(/没有出处/);
    expect(r.sm.tasks.filter((t) => t === 'repair').length).toBeGreaterThanOrEqual(1);
    const report = await r.vault.read(r.result.reportPath);
    expect(report.data.delivery).toBe('草稿');
    expect((await r.vault.read(HYP)).data.verdict_proposed).toBeNull();
  });

  it('a citation whose quote does not match its block, or whose block is missing, fails the check', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const text = [
      '- a “IT 可管理性是企业采购 AI PC 的首要考量” （B 级）[[资料甲#^c1]]',
      '- b “预算主要来自财务部门” （B 级）[[资料甲#^c2]]',
      '- c “不存在” [[资料甲#^c42]]',
      // (a bare link must be to a block not quoted earlier: M0's checkCitations looks at the first occurrence)
      '- d [[资料甲#^c3]]',
    ].join('\n');
    const f = citationFailures(await fx.vault.checkCitations(text));
    expect(f.map((x) => x.code).sort()).toEqual(['block_not_found', 'missing_quote', 'quote_mismatch']);
  });

  it('structure: Summary must come first; inference must be labelled; no bare numbers', () => {
    const bad = '# R 调查报告 v1\n\n## 怎么查的\n- x\n\n## Summary\n- So what：市场 30% 增长\n\n## 逐个假设\n### H1 x\n- 提议的判断：成立\n\n## 对 workplan 的影响\n- 无\n';
    const codes = checkReportText(bad).map((f) => f.code);
    expect(codes).toContain('missing_section'); // Summary not first, fields missing
    expect(codes).toContain('unlabeled_inference');
    expect(codes).toContain('uncited_number');
  });
});

describe('self-check: evidence keys', () => {
  it('a bare E3 in prose is flagged (bare_evidence_key: a heuristic, not blocking); an E3 inside a source quote is not', () => {
    const head = '# R 调查报告 v1\n\n## Summary\n- So what：x\n\n## 怎么查的\n- x\n\n## 逐个假设\n### H1 x\n- 提议的判断：成立\n- 支持的证据：\n  - a “Microsoft 365 E3 用户占多数” （B 级）[[资料甲#^c1]]\n- 反证：\n  - （无）\n- 推导（推断）：';
    const tail = '\n\n## 对 workplan 的影响\n- 无\n';
    expect(checkReportText(`${head}见 E1、E2${tail}`).map((f) => f.code)).toContain('bare_evidence_key');
    expect(checkReportText(`${head}证据一致${tail}`).filter((f) => f.code === 'bare_evidence_key' || f.code === 'unknown_evidence_key')).toEqual([]);
  });
});

describe('a made-up evidence key (the [E59] bug)', () => {
  it('the report is still delivered; the key is removed, logged and mentioned under 计划之外的调整', async () => {
    const r = await run({
      mode: 'small',
      script: {
        judge: ({ supports, refutes }) => ({
          verdict: '证据不足',
          rebutted: [],
          support_lines: supports.slice(0, 2).map((k) => `IT 部门主导采购 [${k}][E59]`),
          counter_lines: refutes.length ? [`反证 [${refutes[0]}]`] : ['已专门检索反证，没有找到 A/B 级的反证'],
          reasoning: `推断见 [E59]、[${supports[0] ?? 'E1'}]，E58–E60 也一样`,
          model_knowledge: [],
          so_what: ['先对齐 [E59]'],
          gaps: ['缺口'],
          expert_questions: ['问谁？'],
        }),
      },
    });
    expect(r.result.failedChecks).toEqual([]);
    expect(r.result.delivered).toBe(true);
    const body = (await r.vault.read(r.result.reportPath)).body;
    expect(body).not.toMatch(/\bE5[89]\b|\[E\d/);
    expect(body).toContain('系统移除了');
    expect(r.log.some((row) => row.action === 'research:citation-dropped')).toBe(true);
  });
});

describe('research_run in a report that was NOT delivered', () => {
  it('a draft carries the run facts too, and delivery matches the result', async () => {
    const r = await run({
      mode: 'small',
      script: { judge: () => ({ verdict: '证据不足', rebutted: [], support_lines: ['渗透率达到 32%'], counter_lines: [], reasoning: '缺数据', so_what: [], gaps: [], expert_questions: [] }) },
    });
    const data = (await r.vault.read(r.result.reportPath)).data;
    expect(data.delivery).toBe('草稿');
    expect(data.research_run).toMatchObject({ mode: 'small', searches: r.result.usage.searches });
  });
});

describe('evaluation batch size (试水调查 12, 完整调查 30)', () => {
  const many = Array.from({ length: 40 }, (_, i) => `- 「IT 部门在企业 AI PC 采购中的作用之第 ${i + 1} 条观察记录。」— 位置：第 ${i + 1} 段 ^c${i + 1}`).join('\n');
  const bigSource = `---
id: src-big
type: source
status: 已确认
created: "2026-10-24"
updated: "2026-10-24"
author: Senior
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
url: null
publisher: 大型调研机构
published: "2026-06-30"
retrieved: "2026-10-24"
origin: 预置
grade: B
graded_by: 人
authority: null
link_checked: false
---

# 大资料

## 论断

${many}
`;
  const candidatesPerEval = (calls: { prompt: { role: string; content: unknown }[] }[]) =>
    calls
      .map((c) => c.prompt.map((m) => (typeof m.content === 'string' ? m.content : (m.content as { text?: string }[]).map((p) => p.text ?? '').join(''))).join('\n'))
      .filter((t) => t.includes('论断列表：'))
      .map((t) => (t.match(/^\[\d+\] （/gm) ?? []).length);

  async function evalSizes(mode: 'small' | 'full') {
    const fx = await setup({});
    cleanup = fx.cleanup;
    await fx.vault.write('10_资料库/大资料.md', { frontmatter: (await import('js-yaml')).load(bigSource.split('---')[1]) as Record<string, unknown>, body: bigSource.split('---').slice(2).join('---') });
    const sm = scriptedModel();
    await executeResearch({ ctx: fx.ctx, mode, model: sm.model, webClient: fakeWeb() });
    return candidatesPerEval(sm.model.doGenerateCalls as never);
  }

  it('small mode never sends more than 12 claim blocks to one evaluation', async () => {
    const sizes = await evalSizes('small');
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(RESEARCH_LIMITS.small.maxCandidatesPerEval);
    expect(Math.max(...sizes)).toBe(12); // the 40-claim source fills the batch
  });

  it('full mode still sends up to 30', async () => {
    const sizes = await evalSizes('full');
    expect(Math.max(...sizes)).toBe(RESEARCH_LIMITS.full.maxCandidatesPerEval);
  });
});

describe('evidence keys in every model-written field (M4 eval round 2: [E5] in a 缺口 line blocked the report)', () => {
  it('keys in gaps / expert questions / model knowledge / so what are expanded too; the report is delivered with no key left', async () => {
    const r = await run({
      mode: 'small',
      script: {
        judge: ({ supports, refutes }) => ({
          verdict: '证据不足',
          rebutted: [],
          support_lines: supports.slice(0, 2).map((k) => `IT 部门主导采购 [${k}]`),
          counter_lines: refutes.length ? [`反证 [${refutes[0]}]`] : ['已专门检索反证，没有找到 A/B 级的反证'],
          reasoning: `推断见 [${supports[0] ?? 'E1'}]`,
          model_knowledge: [`行业常识 [${supports[0] ?? 'E1'}]，只是线索`],
          so_what: [`先对齐 [${supports[0] ?? 'E1'}]`],
          gaps: [`缺少一手样本：目前只有一条二手转述 [${supports[0] ?? 'E1'}]，无法区分口径`, `[${supports[1] ?? 'E1'}][E99] 只是受访者层面的看法`],
          expert_questions: [`请问 [${supports[0] ?? 'E1'}] 说的是不是真的？`],
        }),
      },
    });
    expect(r.result.failedChecks).toEqual([]);
    expect(r.result.delivered).toBe(true);
    const body = (await r.vault.read(r.result.reportPath)).body;
    const prose = body.replace(/“[^”]*”/g, '').replace(/\[\[[^\]]*\]\]/g, '');
    expect(prose).not.toMatch(/(?<![A-Za-z0-9])E\d{1,3}(?![A-Za-z0-9])/);
    expect(body).toMatch(/缺口：缺少一手样本：目前只有一条二手转述\[\^\d+\]/); // the key became a footnote …
    expect(body).toMatch(/^\[\^\d+\]: “[^”]+”（[^）]+）\[\[[^\]]+#\^c\d+\]\]$/m); // … whose definition is a verified citation
    expect(r.sm.tasks.filter((t) => t === 'repair')).toHaveLength(0); // no LLM repair round was needed
  });
});

describe('the run shows all 9 steps of PRD §6.3.1 (a step that was not needed shows as 跳过：原因)', () => {
  type Step = Extract<ProgressEvent, { kind: 'step' }>;
  const lastById = (events: ProgressEvent[]) => {
    const m = new Map<string, Step>();
    for (const e of events) if (e.kind === 'step') m.set(e.id, e);
    return [...m.values()];
  };
  const numbers = (steps: Step[]) => [...new Set(steps.map((s) => s.step))].sort((a, b) => a - b);

  it('a run that goes to the web: steps 1–9 all appear; 4 (提取) and 5 (评估) report what they did; nothing is left "running"', async () => {
    const r = await run({ mode: 'small' });
    const steps = lastById(r.events);
    expect(numbers(steps)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(steps.filter((s) => s.status === 'running')).toEqual([]);
    const extract = steps.filter((s) => s.step === 4 && s.status === 'done');
    expect(extract.length).toBeGreaterThan(0);
    expect(extract[0].detail).toMatch(/逐字核对/);
    const evaluate = steps.filter((s) => s.step === 5 && s.status === 'done');
    expect(evaluate.length).toBeGreaterThan(0);
    expect(evaluate[0].detail).toMatch(/支持.*反驳.*无关/);
  });

  it('a run where the vault is enough: the steps it did not need are shown as skipped, each with a reason', async () => {
    const r = await run({ mode: 'small', withSourceB: true, refuting: false });
    const steps = lastById(r.events);
    expect(numbers(steps)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const skipped = steps.filter((s) => s.status === 'skipped');
    expect(skipped.some((s) => s.step === 3)).toBe(true); // no web needed
    expect(skipped.some((s) => s.step === 7)).toBe(true); // no gap to fill
    for (const s of skipped) expect((s.detail ?? '').length).toBeGreaterThan(3);
    expect(steps.filter((s) => s.status === 'running')).toEqual([]);
  });

  it('every sub-question has its own row for steps 4 and 7, run or skipped', async () => {
    const r = await run({ mode: 'small', withSourceB: true, refuting: false });
    const steps = lastById(r.events);
    for (const q of ['C1-Q1', 'C1-Q2']) {
      expect(steps.some((s) => s.step === 4 && s.id.includes(q)), `step 4 for ${q}`).toBe(true);
      expect(steps.some((s) => s.step === 7 && s.id.includes(q)), `step 7 for ${q}`).toBe(true);
    }
  });
});

describe('a stuck evaluation call never freezes the run (M4 eval round 3: 3 min 39 s of silence)', () => {
  async function runWith(hang: number) {
    const fx = await setup({});
    cleanup = fx.cleanup;
    const sm = scriptedModel({ hangEvaluate: hang });
    const t0 = Date.now();
    const result = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb(), evalTimeoutMs: 80 });
    return { fx, sm, result, ms: Date.now() - t0, log: await fx.vault.readLog(fx.ctx.logPath) };
  }

  it('one hung call: timed out, retried once, the retry answers, the run is normal', async () => {
    const r = await runWith(1);
    expect(r.sm.tasks.filter((t) => t === 'evaluate:hung')).toHaveLength(1);
    expect(r.log.some((row) => row.action === 'research:llm-timeout')).toBe(true);
    expect(r.log.some((row) => row.action === 'research:evaluate-failed')).toBe(false);
    expect(r.result.delivered).toBe(true);
    expect(r.result.claims[0].evidence).toBeGreaterThan(0);
  });

  it('every evaluation hangs: the batches are recorded as 未评估 (log + report), the run still finishes and the report says so', async () => {
    const r = await runWith(1000);
    expect(r.ms).toBeLessThan(30_000);
    expect(r.log.some((row) => row.action === 'research:evaluate-failed')).toBe(true);
    const body = (await r.fx.vault.read(r.result.reportPath)).body;
    expect(body).toContain('未评估');
    expect(r.result.claims[0].evidence).toBe(0);
    expect(r.result.claims[0].verdict).toBe('证据不足'); // nothing evaluated, nothing proposed beyond that
  });
});

import { createVault } from '@/lib/vault';
import { claimBlocksOf, loadSourceInfo } from '@/lib/research/sources';

describe('every challenge is answered in the reasoning (C’s v3: the expert’s challenge was listed, never answered)', () => {
  it('the judge prompt names the challenges; a reasoning that answers them is delivered and carries the expert’s words', async () => {
    const fx = await setup({ expert: true });
    cleanup = fx.cleanup;
    let seen: string[] = [];
    const sm = scriptedModel({
      judge: (k) => {
        seen = k.challenges;
        return {
          verdict: '需要修改',
          rebutted: [],
          revised_statement: '在管理严格的大企业里，IT 可管理性决定采购',
          revised_assertions: [{ text: '管理严格的大企业里 IT 主导采购', keys: k.supports.slice(0, 2) }],
          support_lines: k.supports.slice(0, 2).map((e) => `IT 部门主导采购 [${e}]`),
          counter_lines: [],
          challenge_responses: k.refutes.map((c) => ({ key: c, challenge: '管得太死员工会绕开', response: `资料说 IT 部门主导采购 [${k.supports[0]}]；推断：所以论点收窄到管理严格的企业`, effect: '收窄' })),
          reasoning: `IT 主导采购 [${k.supports[0]}]，但要收窄到管理严格的企业`,
          model_knowledge: [],
          so_what: ['先打管理严格的大企业'],
          gaps: [],
          expert_questions: [],
        };
      },
    });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    expect(seen.length).toBeGreaterThan(0);
    expect(r.delivered).toBe(true);
    const body = (await fx.vault.read(r.reportPath)).body;
    // the challenge table answers the interview's challenge; its footnote is the verbatim answer
    const n = footnoteOf(body, '访谈（模拟）#^e2');
    expect(body).toMatch(new RegExp(`^\\| 管得太死员工会绕开 \\| 资料说 IT 部门主导采购\\[\\^\\d+\\]；推断：所以论点收窄到管理严格的企业 \\| 假设要改 \\| \\[\\^${n}\\] \\|$`, 'm'));
  });

  it('a reasoning that leaves a challenge out does not get the report delivered (the repair keeps it out, too)', async () => {
    const fx = await setup({ expert: true });
    cleanup = fx.cleanup;
    const sm = scriptedModel({
      judge: (k) => ({
        verdict: '证据不足',
        rebutted: [],
        revised_statement: null,
        support_lines: k.supports.slice(0, 1).map((e) => `IT 部门主导采购 [${e}]`),
        counter_lines: k.refutes.slice(0, 1).map((e) => `员工可能绕开 [${e}]`),
        reasoning: `IT 主导采购 [${k.supports[0]}]`,
        model_knowledge: [],
        so_what: [],
        gaps: [],
        expert_questions: ['管得太死员工会不会绕开？'],
      }),
    });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    expect(r.delivered).toBe(false);
    expect(r.failedChecks.join('\n')).toMatch(/H1 没有回应挑战 \[E\d+\]/);
    expect(sm.tasks).toContain('repair');
  });
});

describe('stance of interview answers', () => {
  it('the evaluate prompt tells the model that a turn or a negation from an interviewee is a challenge (only when interviews are in the batch)', () => {
    const claim = { id: 'C1', statement: 'IT 可管理性决定采购', conditions: [] };
    const q = { id: 'C1-Q1', question: '谁拍板' };
    const withExpert = evaluatePrompt({ claim, subQuestion: q, focus: 'support', candidates: [{ id: 1, grade: '专家意见', origin: '模拟访谈', publisher: 'x', published: null, quote: '管得太死，员工会绕过去。' }] }).prompt;
    expect(withExpert).toMatch(/反面.*但是.*管得太死/);
    expect(withExpert).toContain('优先判 refutes');
    const without = evaluatePrompt({ claim, subQuestion: q, focus: 'support', candidates: [{ id: 1, grade: 'B', origin: '网络', publisher: 'x', published: null, quote: 'IT 部门主导采购。' }] }).prompt;
    expect(without).not.toContain('受访者');
  });

  it('the same answer judged with two stances under two sub-questions is logged, and the report lists it once, as a challenge', async () => {
    const fx = await setup({ expert: true });
    cleanup = fx.cleanup;
    const sm = scriptedModel({ stance: (quote, prompt) => (/管得太死/.test(quote) ? (/子问题 C1-Q1/.test(prompt) ? 'supports' : 'refutes') : undefined) });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    const log = await fx.vault.readLog(fx.ctx.logPath);
    const row = log.find((l) => l.action === 'research:stance-conflict');
    // the two sub-questions run in parallel; the line names them in id order, whichever finished first
    expect(row?.change).toMatch(/#\^e2\]\] 在 C1-Q1 判为支持，在 C1-Q2 判为反驳$/);
    const body = (await fx.vault.read(r.reportPath)).body;
    const n = footnoteOf(body, '访谈（模拟）#^e2');
    expect(body.match(new RegExp(`- (挑战|同向的看法（不算支持证据）)\\[\\^${n}\\]`, 'g'))).toEqual([expect.stringMatching(/^- 挑战/)]);
  });
});

describe('expert input: an answer about something else is not mounted under the claim', () => {
  it('a budget answer in the interview note is filtered out by code before the evaluator sees it, and logged', async () => {
    const fx = await setup({ expert: true });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(EXPERT);
    await fx.vault.write(EXPERT, { frontmatter: note.data, body: `${note.body.trimEnd()}\n\n**受访者**：预算每年 11 月定，由 CFO 批，试点先走小额度。 ^e3\n` }, { overwrite: true });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const body = (await fx.vault.read(r.reportPath)).body;
    expect(body).not.toMatch(/访谈（模拟）#\^e3/);
    expect(body).toMatch(/访谈（模拟）#\^e[12]/);
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((l) => l.action === 'research:expert-offtopic')).toBe(true);
  });
});

describe('expert input (D-18): step 2 finds interviews, ^eN blocks are evidence candidates, labelled apart', () => {
  it('kbLookup searches knowledge/expert-input, reads the interview, and the report marks it 专家意见 (simulated, not an A/B source)', async () => {
    const r = await run({ mode: 'small', expert: true });
    const search = r.tools.filter((t) => t.tool === 'vault_search' && JSON.stringify((t.input as { types?: string[] }).types) === '["knowledge"]');
    expect(search.length).toBeGreaterThan(0);
    expect((search[0].input as { where?: unknown }).where).toEqual({ kind: 'expert-input' });
    expect(r.tools.some((t) => t.tool === 'vault_read' && (t.input as { path?: string }).path === EXPERT)).toBe(true);

    const report = await r.vault.read(r.result.reportPath);
    expect(report.body).toMatch(/专家访谈 1 份（模拟访谈只当挑战或线索，不算证据）/);
    expect(report.body).toContain('专家意见（模拟访谈，只当对假设的挑战或线索');
    const n = footnoteOf(report.body, '访谈（模拟）#^e2');
    expect(report.body).toMatch(new RegExp(`- 挑战\\[\\^${n}\\]：[^\\n]*管得太死`));
    expect(report.body).toMatch(new RegExp(`^\\[\\^${n}\\]: “[^”]*管得太死[^”]*”（专家意见，模拟访谈 · 不计入 A\\/B 级来源）\\[\\[[^\\]]*访谈（模拟）#\\^e2\\]\\]$`, 'm'));
    // verbatim check of the ^eN block, like any citation
    const checks = (await r.vault.checkCitations(report.body)).filter((c) => c.block === 'e2');
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.ok && c.quote)).toBe(true);
    expect(r.result.delivered).toBe(true);
  });

  it('the judge is never shown a simulated interview as support to cite; as a challenge it is shown', async () => {
    const r = await run({ mode: 'small', expert: true });
    const judgePrompts = r.sm.model.doGenerateCalls
      .map((c) => c.prompt.map((m) => (typeof m.content === 'string' ? m.content : (m.content as { text?: string }[]).map((p) => p.text ?? '').join(''))).join('\n'))
      .filter((t) => t.includes('请提出判断'));
    expect(judgePrompts).toHaveLength(1);
    expect(judgePrompts[0]).not.toMatch(/^\[E\d+\] 支持[^\n]*专家意见/m);
    expect(judgePrompts[0]).toMatch(/^\[E\d+\] 反驳[^\n]*专家意见/m);
  });

  it('no interview note, no 专家输入 line', async () => {
    const r = await run({ mode: 'small' });
    expect((await r.vault.read(r.result.reportPath)).body).not.toContain('专家输入：读了');
  });

  it('the real C interview (demo-vault): found by the lookup filter, ^e1–^e6 become candidates, flagged simulated', async () => {
    const vault = createVault('demo-vault');
    const hits = await vault.search({ query: '可管理性', types: ['knowledge'], where: { kind: 'expert-input' } });
    expect(hits.length).toBeGreaterThan(0);
    const info = await loadSourceInfo(vault, hits[0].path);
    expect(info).toMatchObject({ kind: 'expert', origin: '专家访谈', simulated: true, grade: 'C' });
    const drafts = await claimBlocksOf(vault, info!);
    expect(drafts.map((d) => d.block).sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(drafts.every((d) => d.sourceKind === 'expert' && d.simulated)).toBe(true);
    // each block is checkable verbatim
    for (const d of drafts) expect((await vault.checkCitation(d.ref, { quote: d.quote.slice(0, 40) })).ok).toBe(true);
  });
});
