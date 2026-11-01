/**
 * 3.3 (5.0 run-through 3.19): a working note that called itself a decision was offered to a run as one, the
 * report cited it without its words and was not delivered. Now only notes in 决策/ with type decision are
 * context, and a decision cited in a report carries its own words or the self-check fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeResearch } from '@/lib/research/execute';
import { loadResearchContext, renderContext } from '@/lib/research/context';
import { collectOrigins, renderOriginLines } from '@/lib/research/origin';
import { clearPageCache } from '@/lib/research/page-cache';
import { decisionFailures } from '@/lib/research/selfcheck';
import { fakeWeb, PLAN, scriptedModel, setup, WS } from './research-fixture';

const DECISION_BODY = `
# 管理栈保份额

## 决定

在 WS-A 的判断里，把 IT 可管理性当作采购的前置条件，而不是加分项。

## 理由

- 先看管理栈。
`;
const decisionFm = (over: Record<string, unknown> = {}) => ({
  id: `dec-${Math.random().toString(36).slice(2, 8)}`,
  type: 'decision',
  status: '已确认',
  created: '2026-10-24',
  updated: '2026-10-24',
  author: 'AI',
  derived_from: [`[[${WS}/workspace|WS-A]]`],
  relates_to: [`[[${WS}/workspace|WS-A]]`],
  decided_by: 'Senior',
  trigger: `[[${WS}/workspace|WS-A]]`,
  reason: '理由一句话',
  affects: [`[[${WS}/workspace|WS-A]]`],
  ...over,
});

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

const DEC = '20_项目/P/决策/管理栈保份额.md';
const WORKING_NOTE = '20_项目/P/内容决策记录.md';

async function withNotes() {
  const fx = await setup();
  cleanup = fx.cleanup;
  await fx.vault.write(DEC, { frontmatter: decisionFm(), body: DECISION_BODY });
  // a working note that calls itself a decision, in the project root …
  await fx.vault.write(WORKING_NOTE, { frontmatter: decisionFm(), body: '# 记录\n\n## 决定\n\n开发过程里的默认选择。 ^d6\n' });
  // … and one in 决策/ that is not a decision
  await fx.vault.write('20_项目/P/决策/说明.md', { frontmatter: decisionFm({ type: 'log', status: '进行中' }), body: '# 说明\n\n只是一份说明。\n' }).catch(() => undefined);
  return fx;
}

describe('context: only 决策/ notes of type decision', () => {
  it('a decision-typed note outside 决策/ and a non-decision note inside it are not context', async () => {
    const fx = await withNotes();
    const rc = await loadResearchContext(fx.ctx, { sources: false });
    expect(rc.decisions.map((d) => d.name)).toEqual(['管理栈保份额']);
    expect(renderContext(rc)).not.toContain('开发过程里的默认选择');
  });

  it('the origins of a run do not list a decision that is not in 决策/', async () => {
    const fx = await withNotes();
    const plan = { derived_from: [`[[${WS}/workspace|WS-A]]`], relates_to: [`[[${DEC.replace(/\.md$/, '')}]]`, `[[${WORKING_NOTE.replace(/\.md$/, '')}]]`], claims: [] };
    const items = await collectOrigins(fx.vault, PLAN, plan);
    expect(items.map((i) => i.name)).toContain('管理栈保份额');
    expect(items.map((i) => i.name)).not.toContain('内容决策记录');
    // the decision line carries its words, in front of the link
    const line = renderOriginLines(items).find((l) => l.includes('管理栈保份额'))!;
    expect(line).toMatch(/“在 WS-A 的判断里，把 IT 可管理性当作采购的前置条件/);
    expect(await decisionFailures(fx.vault, line)).toEqual([]);
  });
});

describe('decisionFailures', () => {
  it('a bare link to a decision fails; the decision’s own words in front of the link pass', async () => {
    const fx = await withNotes();
    const link = `[[${DEC.replace(/\.md$/, '')}|管理栈保份额]]`;
    expect((await decisionFailures(fx.vault, `这符合 ${link}。`)).map((f) => f.code)).toEqual(['decision_without_quote']);
    expect(await decisionFailures(fx.vault, `“把 IT 可管理性当作采购的前置条件，而不是加分项”（Senior 确认）${link}`)).toEqual([]);
  });

  it('words that are not in the decision fail, and a later bare mention is not hidden by an earlier quoted one', async () => {
    const fx = await withNotes();
    const link = `[[${DEC.replace(/\.md$/, '')}]]`;
    expect((await decisionFailures(fx.vault, `“管理栈不重要”${link}`)).map((f) => f.code)).toEqual(['decision_quote_mismatch']);
    const text = `“把 IT 可管理性当作采购的前置条件”${link}\n\n后面又提到 ${link}。`;
    expect((await decisionFailures(fx.vault, text)).map((f) => f.code)).toEqual(['decision_without_quote']);
  });

  it('links to notes that are not decisions are left alone', async () => {
    const fx = await withNotes();
    expect(await decisionFailures(fx.vault, `见 [[${WS}/workspace|WS-A]]`)).toEqual([]);
  });
});

describe('a run with a confirmed decision', () => {
  it('delivers: the line that names the decision carries its words and passes the self-check', async () => {
    const fx = await withNotes();
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(r.failedChecks).toEqual([]);
    expect(r.delivered).toBe(true);
    const body = (await fx.vault.read(r.reportPath)).body;
    expect(body).toMatch(/遵循的已确认决定[^\n]*“在 WS-A 的判断里，把 IT 可管理性当作采购的前置条件[^\n]*\[\[20_项目\/P\/决策\/管理栈保份额/);
  });

  it('a model that cites the decision without its words does not get the report delivered unless it repairs it', async () => {
    const fx = await withNotes();
    const bare = `[[${DEC.replace(/\.md$/, '')}]]`;
    const sm = scriptedModel({
      judge: (k) => ({
        verdict: '证据不足',
        rebutted: [],
        revised_statement: null,
        support_lines: k.supports.slice(0, 1).map((e) => `IT 部门参与采购 [${e}]`),
        counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'],
        reasoning: `按 ${bare} 的方向看，证据不够`,
        model_knowledge: [],
        so_what: ['先和 IT 负责人确认'],
        gaps: [],
        expert_questions: [],
      }),
    });
    // the scripted repair answers with the same JSON it was given (so the bare link stays)
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    expect(r.delivered).toBe(false);
    expect(r.failedChecks.join('\n')).toContain('引用的决定没有写出原文');
  });
});
