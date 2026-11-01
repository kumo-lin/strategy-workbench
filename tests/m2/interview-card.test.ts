/**
 * D-56 ⑤b: the report's 访谈建议 card — who to interview, what to ask, what to do next — assembled by code from the
 * judgment (each claim's expert_questions and its 待验证 assertions), no model call. A frozen report rendered again
 * (--rerender) does not get it.
 */
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoles } from '@/lib/config/roles';
import { buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { DEFAULT_WHO, defaultWho, interviewAsks, NEXT_STEP, parseExpertQuestion, renderInterviewCard, type InterviewAsk } from '@/lib/research/interview-card';
import { renderReport, type ReportFacts } from '@/lib/research/report';
import { rewriteReport } from '@/lib/research/rewrite';
import { judgmentSchema, summarySchema } from '@/lib/research/schemas';
import { createVault } from '@/lib/vault';
import type { ClaimResult } from '@/lib/research/judge';
import { fakeWeb, scriptedModel, setup } from './research-fixture';

vi.setConfig({ testTimeout: 180_000 });

let cleanup: (() => Promise<void>) | null = null;
let root = '';

beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('parseExpertQuestion', () => {
  it('reads "问<who>：<question>" with a full-width or a half-width colon', () => {
    expect(parseExpertQuestion('问企业 IT 负责人：采购评审里可管理性是资格条款还是评分项？')).toEqual({ who: '企业 IT 负责人', question: '采购评审里可管理性是资格条款还是评分项？' });
    expect(parseExpertQuestion('问 企业 IT 负责人: 预算由谁批？')).toEqual({ who: '企业 IT 负责人', question: '预算由谁批？' });
    expect(parseExpertQuestion('  问企业 IT 负责人 ： 预算由谁批？  ')).toEqual({ who: '企业 IT 负责人', question: '预算由谁批？' });
  });

  it('a plain question, or one with no who ("问：x"), stays whole', () => {
    expect(parseExpertQuestion('预算由谁批？')).toEqual({ who: null, question: '预算由谁批？' });
    expect(parseExpertQuestion('问：x')).toEqual({ who: null, question: '问：x' });
  });
});

describe('defaultWho', () => {
  it('the first perspective with an entry wins; unknown or missing falls back', () => {
    expect(defaultWho(['监管'])).toBe('受监管行业的合规负责人');
    expect(defaultWho(['未知'])).toBe('熟悉这个问题的业内人士');
    expect(defaultWho(undefined)).toBe('熟悉这个问题的业内人士');
    expect(defaultWho(['未知', '买方'])).toBe('企业 IT / 采购负责人');
  });

  it('every perspective in the team configs has an entry', () => {
    const perspectivesIn = (file: string): string[] => {
      const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
      const line = /^perspectives:\s*\[(.*)\]\s*$/m.exec(fm)?.[1] ?? '';
      return line.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    };
    for (const file of ['demo-vault/90_配置/团队.md', 'demo-vault/90_配置/团队-市场部.md']) {
      const perspectives = perspectivesIn(file);
      expect(perspectives.length).toBeGreaterThan(0);
      for (const p of perspectives) expect(DEFAULT_WHO[p], `${file} 的视角「${p}」`).toBeTruthy();
    }
  });
});

describe('interviewAsks', () => {
  const claim = (o: { label: string; perspectives?: string[]; expertQuestions?: string[]; unverified?: { key: string; text: string; basis: string }[] }) => ({
    label: o.label,
    perspectives: o.perspectives,
    expertQuestions: o.expertQuestions ?? [],
    unverified: o.unverified ?? [],
  });

  it('keeps the who the model named; a plain question gets the perspective default', () => {
    const asks = interviewAsks([
      claim({ label: 'H1', perspectives: ['买方'], expertQuestions: ['问企业 IT 负责人：采购评审里可管理性是资格条款还是评分项？', '预算由谁批？'] }),
    ]);
    expect(asks).toEqual([
      { claimLabel: 'H1', who: '企业 IT 负责人', whoFromModel: true, question: '采购评审里可管理性是资格条款还是评分项？' },
      { claimLabel: 'H1', who: '企业 IT / 采购负责人', whoFromModel: false, question: '预算由谁批？' },
    ]);
  });

  it('a 待验证 assertion becomes the same 核实 wording the claim section uses', () => {
    const asks = interviewAsks([claim({ label: 'H2', perspectives: ['监管'], unverified: [{ key: 'H2-A2', text: '可管理性是入围条件', basis: '只有 1 个独立来源' }] })]);
    expect(asks).toEqual([{ claimLabel: 'H2', who: '受监管行业的合规负责人', whoFromModel: false, question: '核实「可管理性是入围条件」（H2-A2 待验证：只有 1 个独立来源）' }]);
  });

  it('asks in claim order; the same question twice appears once', () => {
    const asks = interviewAsks([
      claim({ label: 'H1', expertQuestions: ['预算由谁批？'] }),
      claim({ label: 'H2', expertQuestions: ['预算由谁批？', '谁签字？'] }),
    ]);
    expect(asks.map((a) => [a.claimLabel, a.question])).toEqual([
      ['H1', '预算由谁批？'],
      ['H2', '谁签字？'],
    ]);
  });
});

describe('renderInterviewCard', () => {
  it('writes the section in the exact shape, with （按视角推荐） for a who code chose', () => {
    const asks: InterviewAsk[] = [
      { claimLabel: 'H1', who: '企业 IT 负责人', whoFromModel: true, question: '采购评审里可管理性是资格条款还是评分项？' },
      { claimLabel: 'H2', who: '受监管行业的合规负责人', whoFromModel: false, question: '核实「可管理性是入围条件」（H2-A2 待验证：只有 1 个独立来源）' },
    ];
    expect(renderInterviewCard(asks)).toEqual([
      '## 访谈建议',
      '- 找谁 · 问什么（AI 提议，约不约、问不问由人定）：',
      '',
      '| 找谁 | 问什么 | 对应 |',
      '|---|---|---|',
      '| 企业 IT 负责人 | 采购评审里可管理性是资格条款还是评分项？ | H1 |',
      '| 受监管行业的合规负责人（按视角推荐） | 核实「可管理性是入围条件」（H2-A2 待验证：只有 1 个独立来源） | H2 |',
      '',
      `- 下一步：${NEXT_STEP}`,
    ]);
  });

  it('no asks, no section', () => {
    expect(renderInterviewCard([])).toEqual([]);
  });
});

describe('a fresh run gets the card', () => {
  it('the report ends its main part with 访谈建议, before the appendix; the expert question is a row; still delivered', async () => {
    const fx = await setup({ expert: true });
    cleanup = fx.cleanup;
    const r = await runReport(fx, {});
    expect(r.delivered).toBe(true);
    const cardAt = r.body.indexOf('## 访谈建议');
    const appendixAt = r.body.indexOf('## 附录：过程记录');
    expect(cardAt).toBeGreaterThan(-1);
    expect(cardAt).toBeLessThan(appendixAt);
    expect(r.body).toContain('| 熟悉这个问题的业内人士（按视角推荐） | 预算由谁批？ | H1 |');
    expect(r.body).toContain(`- 下一步：${NEXT_STEP}`);
  });
});

describe('a frozen report rendered again stays as it was', () => {
  it('the same results with interviewCard unset have no 访谈建议 (the renderer directly)', () => {
    const claim = { id: 'C1', statement: 'IT 决定采购' } as unknown as ClaimResult['claim'];
    const judgment = judgmentSchema.parse({ verdict: '证据不足', reasoning: '证据还不够', expert_questions: ['预算由谁批？'] });
    const r: ClaimResult = {
      claim,
      label: 'H1',
      hypothesisPath: null,
      hypothesisLink: null,
      evidence: [],
      keyed: new Map(),
      challenges: [],
      assertions: [],
      conditions: [],
      judgment,
      verdict: '证据不足',
      adjusted: false,
      adjustNote: '',
      revisedStatement: null,
      subNotes: [],
    };
    const summary = summarySchema.parse({ so_what: '还答不了', results: ['H1 → 证据不足（提议）：证据还不够'], workplan_impact: [] });
    const facts: ReportFacts = {
      title: 'R',
      version: 1,
      question: '谁决定采购？',
      purpose: '定方向',
      planLink: '[[计划]]',
      workplanLink: '[[workplan]]',
      mode: 'small',
      exploratory: false,
      kbCount: 0,
      webCount: 0,
      searches: 0,
      fetches: 0,
      notExecuted: [],
      droppedQuotes: 0,
      adjustments: [],
      skipped: [],
      counterLines: [],
    };
    expect(renderReport(facts, [r], summary, new Map()).body).not.toContain('## 访谈建议');
    const withCard = renderReport({ ...facts, interviewCard: true }, [r], summary, new Map()).body;
    expect(withCard).toContain('## 访谈建议');
    expect(withCard).toContain('| 熟悉这个问题的业内人士（按视角推荐） | 预算由谁批？ | H1 |');
  });

  it('--rerender of WS-A 报告 v10 has no 访谈建议 and the body is byte for byte the same as the control', async () => {
    const first = await vaultWithV10();
    const a = await rewriteReport({ ctx: first.ctx, reportPath: V10, model: scriptedModel().model, rerender: { note: '访谈建议切换的对照' } });
    const bodyA = (await first.vault.read(a.reportPath)).body;
    expect(a.reportName).toBe('报告 v11');
    expect(a.usage).toMatchObject({ searches: 0, fetches: 0 });
    expect(bodyA).not.toContain('## 访谈建议');

    // the control: the same v10 rendered again, the switch false (the rerender path itself)
    await rm(root, { recursive: true, force: true });
    root = '';
    const second = await vaultWithV10();
    const b = await rewriteReport({ ctx: second.ctx, reportPath: V10, model: scriptedModel().model, rerender: { note: '访谈建议切换的对照' } });
    const bodyB = (await second.vault.read(b.reportPath)).body;
    expect(bodyB).not.toContain('## 访谈建议');
    expect(bodyA).toBe(bodyB);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

async function runReport(fx: Awaited<ReturnType<typeof setup>>, script: Parameters<typeof scriptedModel>[0]) {
  const sm = scriptedModel(script);
  const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
  return { ...r, body: (await fx.vault.read(r.reportPath)).body };
}

const S3 = path.resolve('demo-vault/.snapshots/S3-D48');
const WS = '20_项目/个人AI战略/WS-A 买方';
const DIR = `${WS}/调查/买方采购逻辑（问题树）`;
const V10 = `${DIR}/报告 v10.md`;

async function vaultWithV10() {
  root = await mkdtemp(path.join(tmpdir(), 'interview-card-'));
  await cp(S3, root, { recursive: true });
  const vault = createVault(root);
  const ws = await vault.readTyped(`${WS}/workspace.md`, 'workspace');
  const role = (await loadRoles(vault)).find((r) => r.name === ws.note.owner);
  if (!role) throw new Error('角色配置里没有 workspace 的负责人');
  const ctx = await buildToolContext({ vault, role, workspacePath: WS, researchDir: DIR, track: 'research', now: () => new Date('2026-10-27T10:00:00Z') });
  return { vault, ctx };
}
