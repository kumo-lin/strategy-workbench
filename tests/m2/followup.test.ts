/** 追加调查 (D-18): report v(N+1) keeps vN, adds the new evidence, says what changed and why; same gates as a first run. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolNotAllowedError } from '@/lib/harness';
import { loadEvidenceRecord } from '@/lib/research/evidence-record';
import { parseMarkdown } from '@/lib/vault/frontmatter';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, claimSectionRange, executeFollowUp, FollowUpDenied, PlanSaveDenied, whyVerdict } from '@/lib/research/followup';
import { clearPageCache } from '@/lib/research/page-cache';
import type { ProgressEvent } from '@/lib/research/progress';
import { checkReportText } from '@/lib/research/selfcheck';
import { buildToolContext } from '@/lib/harness';
import { ROLES } from '../helpers/fixture-vault';
import { EXPERT, fakeWeb, HYP, MEETING, RDIR, scriptedModel, setup, SOURCE_B, WS } from './research-fixture';
import { ev } from './research-evidence';

vi.setConfig({ testTimeout: 60_000 });

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

const EXPERT_FILE = `---
id: expert-it-lead
type: knowledge
status: 推断
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[项目]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
kind: expert-input
approved_by: null
origin_project: "[[项目]]"
simulated: true
---

# 专家访谈：某企业 IT 负责人

**受访者**：可管理性是门槛，不是加分项；IT 部门一票否决采购。 ^e1

**受访者**：反面意见：管得太死，员工会绕过去，采购并不总是 IT 说了算。 ^e2
`;

const QUESTION = '专家的反面意见：管得太死会不会让员工绕开 IT';

type Fx = Awaited<ReturnType<typeof setup>>;

/** The owner's click: the sub-question joins the plan (new version, approved), then the run. */
async function followUp(fx: Fx, o: { claimId?: string; question?: string; model?: ReturnType<typeof scriptedModel>['model']; emit?: (e: ProgressEvent) => void; role?: typeof ROLES.juniorA; ws?: string; dir?: string } = {}) {
  const ws = o.ws ?? WS;
  const dir = o.dir ?? RDIR;
  const role = o.role ?? ROLES.juniorA;
  const claimId = o.claimId ?? 'C1';
  const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: ws, researchDir: dir, role, claimId, question: o.question ?? QUESTION });
  const ctx = await buildToolContext({ vault: fx.vault, role, workspacePath: ws, researchDir: dir, track: 'research', now: () => new Date('2026-10-25T10:00:00Z') });
  const follow = await executeFollowUp({ ctx, claimId, subQuestionId: added.subQuestionId, model: o.model ?? scriptedModel().model, webClient: fakeWeb(), emit: o.emit });
  return { added, ctx, follow };
}

/** v1 from a normal run (no interview in the vault yet), then the interview arrives and the owner adds a sub-question. */
async function firstRunThenFollowUp(question: string) {
  const fx = await setup({ meeting: true, approved: true });
  cleanup = fx.cleanup;
  const plan = (await fx.vault.read(fx.ctx.research!.planPath!)).data;
  await fx.vault.write(fx.ctx.research!.planPath!, { frontmatter: { ...plan, derived_from: ['[[20_项目/P/WS-A/workplan v1|workplan v1]]'] }, body: '# p\n' }, { overwrite: true });
  const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
  expect(first.delivered).toBe(true);
  await fx.vault.write(EXPERT, { frontmatter: (await import('js-yaml')).load(EXPERT_FILE.split('---')[1]) as Record<string, unknown>, body: EXPERT_FILE.split('---').slice(2).join('---') });
  const events: ProgressEvent[] = [];
  const { added, follow, ctx } = await followUp(fx, { question, emit: (e) => events.push(e) });
  return { fx, first, follow, added, ctx, events, v1: await fx.vault.read(first.reportPath), v2: await fx.vault.read(follow.reportPath) };
}

describe('pure helpers', () => {
  it('claimSectionRange finds the ### section up to the next heading', () => {
    const lines = ['## 逐个假设', '### H1 甲 [[x]]', '- a', '', '### H2 乙', '- b', '## 对 workplan 的影响'];
    expect(claimSectionRange(lines, 'H1')).toEqual({ start: 1, end: 4 });
    expect(claimSectionRange(lines, 'H2')).toEqual({ start: 4, end: 6 });
    expect(claimSectionRange(lines, 'H3')).toBeNull();
  });
  it('whyVerdict states §9.5 in numbers', () => {
    expect(whyVerdict('成立', [ev({ grade: 'B' }), ev({ grade: 'C' })])).toMatch(/2 家互相独立.*最高 B 级/);
    expect(whyVerdict('证据不足', [ev({ grade: 'C' })])).toMatch(/只有 1 家.*没有 A\/B 级/);
    expect(whyVerdict('需要修改', [ev({})], '只在大企业成立')).toContain('修正后的假设：只在大企业成立');
  });
});

describe('the follow-up chain with a mock model', () => {
  it('v2 keeps v1, adds the new (interview) evidence, says what changed and why; origins written again; checks pass', async () => {
    const { fx, first, follow, events, v1, v2, added } = await firstRunThenFollowUp(QUESTION);
    expect(follow.reportName).toBe('报告 v2');
    expect(follow.failedChecks).toEqual([]);
    expect(follow.delivered).toBe(true);
    expect(v2.data).toMatchObject({ version: 2, delivery: '已交付', author: 'AI' });
    expect(v2.data.follow_up).toMatchObject({ claim: 'C1', sub_question: 'C1-Q4', question: QUESTION });
    // the new sub-question is in the plan: plan v2, approved by the owner's event, both in the log
    expect(added).toMatchObject({ created: true, subQuestionId: 'C1-Q4' });
    const plan2 = (await fx.vault.readTyped(added.planPath, 'research_plan')).note;
    expect(plan2).toMatchObject({ version: 2, author: 'Junior A', approved_by_owner: 'Junior A' });
    expect(plan2.claims[0].sub_questions.map((q) => q.id)).toEqual(['C1-Q1', 'C1-Q2', 'C1-Q3', 'C1-Q4']);
    expect(plan2.claims[0].sub_questions[3]).toMatchObject({ question: QUESTION, methods: ['知识库', '网络'] });
    const log0 = await fx.vault.readLog(`${WS}/日志.md`);
    expect(log0.some((r) => r.action === 'write:计划 v2')).toBe(true);
    expect(log0.some((r) => r.action === 'event:research_plan.approve' && r.actor === 'Junior A')).toBe(true);
    expect(JSON.stringify(v2.data.research_plan)).toContain('计划 v2');
    expect(JSON.stringify(v2.data.derived_from)).toContain('报告 v1');

    // everything in v1's section for H1 is still in v2 (only the verdict line is relabelled)
    const sectionOf = (body: string) => {
      const lines = body.split('\n');
      const r = claimSectionRange(lines, 'H1')!;
      return lines.slice(r.start + 1, r.end);
    };
    const kept = sectionOf(v1.body).filter((l) => l.trim() && !l.startsWith('- 提议的判断：'));
    const inV2 = sectionOf(v2.body);
    for (const l of kept) expect(inV2, `kept: ${l.slice(0, 40)}`).toContain(l);
    expect(inV2.some((l) => l.startsWith('- v1 的提议判断：'))).toBe(true);
    expect(inV2.filter((l) => l.startsWith('- 提议的判断：'))).toHaveLength(1);
    expect(inV2.join('\n')).toContain(`追加调查（v2）：新增子问题 C1-Q4「${QUESTION}」`);

    // 本版变化 sits right after Summary and lists the NEW evidence (the interview), the verdict move and the why
    const body = v2.body;
    const iSummary = body.indexOf('## Summary');
    const iChange = body.indexOf('## 本版变化（v2，追加调查）');
    const iHow = body.indexOf('## 怎么查的');
    expect(iSummary).toBeLessThan(iChange);
    expect(iChange).toBeLessThan(iHow);
    const change = body.slice(iChange, iHow);
    expect(change).toMatch(/- 判断：.* → .*（(变了|没变)）/);
    expect(change).toContain('为什么：');
    // v1 is in the D-20 format: new citations are footnotes that continue v1's numbering
    const e2 = /^\[\^(\d+)\]: “[^”]*管得太死[^”]*”（专家意见，模拟访谈 · 不计入 A\/B 级来源）\[\[[^\]]*访谈（模拟）#\^e2\]\]$/m.exec(body);
    expect(e2).not.toBeNull();
    expect(change).toContain(`专家意见 · 挑战 · [^${e2![1]}]`);
    const v1Max = Math.max(...[...v1.body.matchAll(/^\[\^(\d+)\]:/gm)].map((m) => Number(m[1])));
    expect(Number(e2![1])).toBeGreaterThan(v1Max);
    expect(follow.followUp.newEvidence).toBeGreaterThan(0);

    // "这次调查的出发点" is written by code again and replaces v1's (one copy, not two)
    expect(body.match(/这次调查的出发点/g)).toHaveLength(1);
    // the expert's challenge is answered in the updated reasoning, not only listed
    // the challenge's footnote sits after the challenge (what the source says), not after the response (Q-F)
    expect(body).toMatch(new RegExp(`^    - [^\\n]*\\[\\^${e2![1]}\\] → (推翻了假设|假设要改|不影响判断)：`, 'm'));
    expect(body).toContain(`[[${MEETING.replace(/\.md$/, '')}#^m1]]`);

    // same gates: every citation resolves, quotes verbatim; the text checks pass; nothing running
    const checks = await fx.vault.checkCitations(body);
    expect(checks.every((c) => c.ok && c.quote)).toBe(true);
    expect(checkReportText(body).filter((f) => f.code !== 'unknown_evidence_key')).toEqual([]);

    // the 9 steps appear for the follow-up too; interviews were searched (D-18); small budget; v1 untouched
    const stepNos = new Set(events.filter((e) => e.kind === 'step').map((e) => (e as Extract<ProgressEvent, { kind: 'step' }>).step));
    expect([...stepNos].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const starts = events.filter((e) => e.kind === 'tool-start') as Extract<ProgressEvent, { kind: 'tool-start' }>[];
    expect(starts.some((t) => t.tool === 'vault_search' && JSON.stringify((t.input as { types?: string[] }).types) === '["knowledge"]')).toBe(true);
    expect(follow.usage.searches).toBeLessThanOrEqual(3);
    expect(follow.usage.fetches).toBeLessThanOrEqual(3);
    expect((await fx.vault.read(first.reportPath)).body).toBe(v1.body);

    // the log has the follow-up; the hypothesis' proposal follows the new verdict, the human verdict is untouched
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.some((r) => r.action === 'research:followup')).toBe(true);
    const hyp = await fx.vault.read(HYP);
    expect(hyp.data.verdict_proposed).toBe(follow.followUp.to);
    expect(hyp.data.verdict).toBeNull();
    // the evidence record now holds old + new
    // (in the file next to each report, not in the frontmatter)
    expect(v2.data.evidence_record).toBeUndefined();
    expect(v2.data.evidence_record_file).toBe('报告 v2.evidence.json');
    const n1 = (await loadEvidenceRecord(fx.vault, first.reportPath, v1.data)).length;
    expect(n1).toBeGreaterThan(0);
    expect((await loadEvidenceRecord(fx.vault, follow.reportPath, v2.data)).length).toBeGreaterThan(n1);
  });

  it('the run is for the NEW sub-question only (the others are not rerun), from step 2, small budget', async () => {
    const { events, follow } = await firstRunThenFollowUp(QUESTION);
    const ids = events.filter((e) => e.kind === 'step').map((e) => (e as Extract<ProgressEvent, { kind: 'step' }>).id);
    expect(ids.some((i) => i.startsWith('s2:C1-Q4'))).toBe(true);
    for (const old of ['C1-Q1', 'C1-Q2', 'C1-Q3']) expect(ids.some((i) => i.startsWith(`s2:${old}`))).toBe(false);
    expect(follow.usage.searches).toBeLessThanOrEqual(3);
  });

  it('asking the same question again reuses the sub-question: no new plan version, no duplicate', async () => {
    const { fx, added } = await firstRunThenFollowUp(QUESTION);
    const again = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: `  ${QUESTION} ` });
    expect(again).toMatchObject({ created: false, subQuestionId: added.subQuestionId, planPath: added.planPath });
  });

  it('a self-check failure in the new part keeps v2 a draft; v1 stays the latest delivered report', async () => {
    const fx = await setup({ meeting: true, approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    // (a citation of a source that is not there: not a number heuristic, so it still blocks; D-21-4 h. A "[^99]" the
    // model writes is taken out now, D-48 第 4 轮 B)
    const bad = scriptedModel({
      judge: () => ({ verdict: '证据不足', rebutted: [], support_lines: [], counter_lines: [], reasoning: '渗透率的说法见 [[不存在的资料#^c9]]', so_what: [], gaps: [], expert_questions: [] }),
    });
    const { follow } = await followUp(fx, { model: bad.model });
    expect(follow.delivered).toBe(false);
    expect(follow.failedChecks.join('\n')).toContain('不存在的资料');
    const v2 = await fx.vault.read(follow.reportPath);
    expect(v2.data.delivery).toBe('草稿');
    expect(v2.body).toContain('没有交付');
    expect((await fx.vault.read(HYP)).data.verdict_proposed).toBe(first.claims[0].verdict); // not overwritten by a draft
  });

  it('D-21-4 (h): an uncited number in the new part goes through the repair rounds, then is flagged; v2 is delivered', async () => {
    const fx = await setup({ meeting: true, approved: true });
    cleanup = fx.cleanup;
    expect((await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() })).delivered).toBe(true);
    const bad = scriptedModel({
      judge: () => ({ verdict: '证据不足', rebutted: [], support_lines: [], counter_lines: [], reasoning: '渗透率达到 32%', so_what: [], gaps: [], expert_questions: [] }),
    });
    const { follow } = await followUp(fx, { model: bad.model });
    expect(bad.tasks).toContain('repair');
    expect(follow.delivered).toBe(true);
    const v2 = await fx.vault.read(follow.reportPath);
    expect(v2.data.delivery).toBe('已交付');
    expect(v2.data.number_flags).toEqual([expect.objectContaining({ check: 'uncited_number', numbers: ['32'], text: expect.stringContaining('渗透率达到 32%') })]);
  });
});

describe('who and what a follow-up may be built on', () => {
  it('needs an approved plan (same gate as a run): the sub-question cannot be added, and executeFollowUp itself refuses', async () => {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    await expect(addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: QUESTION })).rejects.toThrow(/还没有批准/);
    await expect(executeFollowUp({ ctx: fx.ctx, claimId: 'C1', subQuestionId: 'C1-Q1', model: scriptedModel().model, webClient: fakeWeb() })).rejects.toBeInstanceOf(ToolNotAllowedError);
  });
  it('only the owner adds a sub-question (it becomes an approved plan version); nothing is written for a refused request', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    for (const role of [ROLES.juniorB, ROLES.senior]) {
      await expect(addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role, claimId: 'C1', question: QUESTION })).rejects.toBeInstanceOf(PlanSaveDenied);
    }
    expect(await fx.vault.exists(`${RDIR}/计划 v2.md`)).toBe(false);
    await expect(addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: '短' })).rejects.toBeInstanceOf(FollowUpDenied);
    await expect(addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C9', question: QUESTION })).rejects.toThrow(/没有论点 C9/);
    expect(await fx.vault.exists(`${RDIR}/计划 v2.md`)).toBe(false);
  });
  it('needs a delivered report to build on', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    await expect(followUp(fx)).rejects.toBeInstanceOf(FollowUpDenied); // no report at all
    const first = await executeResearch({
      ctx: fx.ctx,
      mode: 'small',
      model: scriptedModel({ judge: () => ({ verdict: '证据不足', rebutted: [], support_lines: ['渗透率达到 32%'], counter_lines: [], reasoning: 'x', so_what: [], gaps: [], expert_questions: [] }) }).model,
      webClient: fakeWeb(),
    });
    expect(first.delivered).toBe(false); // a draft: not a base for a follow-up
    await expect(followUp(fx, { question: '另一个子问题：员工绕开 IT 的真实比例' })).rejects.toThrow(/没有交付/);
  });
  it('only sub-questions that are in the plan', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    await expect(executeFollowUp({ ctx: fx.ctx, claimId: 'C1', subQuestionId: 'C1-Q9', model: scriptedModel().model, webClient: fakeWeb() })).rejects.toThrow(/没有子问题 C1-Q9/);
  });
});

import { evidenceRecordFromSection } from '@/lib/research/followup';
import { readFileSync } from 'node:fs';

describe('reports written before evidence_record existed (the S3 snapshot)', () => {
  it('evidence is read back from the claim section: supports / refutes by sub-section, expert challenge as a refute', () => {
    const body = [
      '### H1 甲',
      '- 提议的判断：成立',
      '- 支持的证据：',
      '  - a “x”（A 级，知识库）[[资料甲#^c1]] 和 [[资料乙#^c2|别名]]',
      '- 反证：',
      '  - b “y”（C 级）[[资料丙#^c3]]',
      '  - 同一条 [[资料甲#^c1]] 不重复',
      '- 专家意见（模拟访谈，只当对假设的挑战或线索）：',
      '  - 挑战：“z”（专家意见）[[访谈#^e2]]',
      '- 推导（推断）：因为 [[资料丁#^c9]]（推导里引用的不算证据）',
      '### H2 乙',
    ];
    const r = evidenceRecordFromSection(bodyLinesOf(body), 'H1', { id: 'C1', sub_questions: [{ id: 'C1-Q1' }] });
    expect(r.map((e) => [e.ref, e.stance])).toEqual([
      ['[[资料甲#^c1]]', 'supports'],
      ['[[资料乙#^c2]]', 'supports'],
      ['[[资料丙#^c3]]', 'refutes'],
      ['[[访谈#^e2]]', 'refutes'],
    ]);
    expect(r.every((e) => e.core === false)).toBe(true);
  });

  it('works on the real S3 报告 v2: H1 has supports and refutes, all of them resolvable blocks', async () => {
    const { createVault } = await import('@/lib/vault');
    const { restoreEvidence } = await import('@/lib/research/evidence-record');
    const root = 'demo-vault/.snapshots/S3-C7-ws-a';
    const f = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/报告 v2.md';
    const lines = readFileSync(`${root}/${f}`, 'utf8').split('\n');
    const rec = evidenceRecordFromSection(lines, 'H1', { id: 'C1', sub_questions: [{ id: 'C1-Q1' }] });
    expect(rec.some((e) => e.stance === 'supports')).toBe(true);
    expect(rec.some((e) => e.stance === 'refutes')).toBe(true);
    const restored = await restoreEvidence(createVault(root), rec, f);
    expect(restored.length).toBe(rec.length); // every cited block is still there, with its grade and quote
    expect(restored.every((e) => e.quote.length > 0 && ['A', 'B', 'C'].includes(e.grade))).toBe(true);
  });
});

const bodyLinesOf = (l: string[]) => l;

import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVault } from '@/lib/vault';

// the starting-point block is rewritten by code in v3 (replaced, not appended): its lines are not expected to survive verbatim
const ORIGIN_LINE = /^- 这次调查的出发点|^\s+- (会议|决定|项目)「/;

describe('a follow-up on the real S3 snapshot (what C7 will do for WS-A-H1)', () => {
  it('builds 报告 v3 on the hand-edited v2: all of v2 kept, the new part checked, the stale confirmation flagged', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'sw-s3-'));
    try {
      await cp(path.resolve('demo-vault/.snapshots/S3-C7-ws-a'), tmp, { recursive: true });
      const vault = createVault(tmp);
      const S3_WS = '20_项目/个人AI战略/WS-A 买方';
      const DIR = `${S3_WS}/调查/买方采购逻辑`;
      // This test is about "v2 → v3": reports above v2 (C may add a v3 to the snapshot) would turn it into "v3 → v4"
      for (const e of await vault.list(DIR)) {
        const n = Number(/^报告 v(\d+)\.md$/.exec(e.name)?.[1] ?? 0);
        if (n > 2) await rm(path.join(tmp, e.path));
      }
      const v2 = await vault.read(`${DIR}/报告 v2.md`);
      const hypPath = '20_项目/个人AI战略/假设/WS-A-H1 选型权在IT不在员工.md';
      const before = (await vault.read(hypPath)).data;

      const { follow } = await followUp({ vault, cleanup: async () => {} } as unknown as Fx, { ws: S3_WS, dir: DIR, question: QUESTION });
      expect(follow.failedChecks).toEqual([]);
      expect(follow.delivered).toBe(true);
      expect(follow.reportName).toBe('报告 v3');
      const v3 = await vault.read(follow.reportPath);

      // v2 is kept: every non-empty v2 line is in v3 (only H1's verdict line is relabelled)
      const v3Lines = new Set(v3.body.split('\n'));
      const missing = v2.body.split('\n').filter((l) => l.trim() && !v3Lines.has(l) && !/^# |^- 提议的判断：需要修改$/.test(l) && !/^\s*- H1 → /.test(l) && !ORIGIN_LINE.test(l));
      expect(missing).toEqual([]);
      expect(v3.body).toContain('## 本版变化（v3，追加调查）');
      // a new version of the same document keeps its status; dates are the local day, written quoted like every other note
      expect(v3.data.status).toBe(['进行中', '推断', '探索性'].includes(String(v2.data.status)) ? v2.data.status : '进行中');
      const raw = await readFile(path.join(tmp, follow.reportPath), 'utf8');
      expect(raw).toMatch(/^created: "\d{4}-\d{2}-\d{2}"$/m);
      expect(raw).toMatch(/^updated: "\d{4}-\d{2}-\d{2}"$/m);
      // The stale-confirmation note only appears when v2 still opens with one (C removed it from S3).
      if (v2.body.includes('内容已由用户确认')) expect(v3.body).toContain('v2 开头写的“内容已由用户确认”只对 v2 的原文有效');
      else expect(v3.body).not.toContain('只对 v2 的原文有效');
      expect(v3.data.content_confirmed_by).toBeUndefined(); // the confirmation does not move to the new version
      // the other claims' verdicts stay as v2 had them; H1's proposal follows the new judgment
      expect((v3.data.verdicts_proposed as Record<string, string>).C2).toBe('需要修改');
      const after = (await vault.read(hypPath)).data;
      expect(after.verdict_proposed).toBe(follow.followUp.to);
      expect(after.verdict).toBe(before.verdict);
      // every citation in the whole report (v2's included) still resolves, quotes verbatim
      expect((await vault.checkCitations(v3.body)).every((c) => c.ok)).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('a follow-up rewrites AI 的推荐判断 on all of v(N+1)\'s judgments (D-21 step 4)', () => {
  async function chain(second: Parameters<typeof scriptedModel>[0]) {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    // a source that arrives after v1: what the follow-up finds that v1 did not have
    const c = parseMarkdown(SOURCE_B.replace('src-b', 'src-c').replace('# 资料乙', '# 资料丙').replace('国家统计机构', '另一家研究机构').replace('企业 AI PC 采购中，IT 部门负责设备管理与安全合规审批。', '管理严格的大企业里，IT 可管理性决定 AI PC 采购。'));
    await fx.vault.write('10_资料库/资料丙.md', { frontmatter: c.data, body: c.body });
    const sm = scriptedModel(second);
    const { follow } = await followUp(fx, { model: sm.model });
    return { fx, first, follow, sm, v1: await fx.vault.read(first.reportPath), v2: await fx.vault.read(follow.reportPath) };
  }
  const section = (body: string, h: RegExp) => {
    const lines = body.split('\n');
    const i = lines.findIndex((l) => h.test(l));
    const j = lines.findIndex((l, k) => k > i && /^## /.test(l));
    return lines.slice(i, j < 0 ? undefined : j).join('\n');
  };

  /** The model rewrites every cell in other words (what deepseek-flash did on D-21 (b)), and says which parts changed. */
  const rewriteAll = (changes: (newKey: string | undefined) => Record<string, { changed: boolean; why: string }>) => (prompt: string) => {
    const newKey = /这次追加调查新增的证据[^\n]*\n\[(E\d+)\]/.exec(prompt)?.[1];
    expect(prompt).toContain('上一版的推荐判断如下');
    return {
      decision_answer: '押管理和安全栈，自研为主，但只在管理严格的大企业里（提议）',
      action: '商用 AI PC 把管理与安全栈做成可写进采购条款的证明物，由商用产品线来牵头',
      action_kind: '自研',
      scale: '先在 2 到 3 家已有机队管理的大客户里试点，6 到 9 个月',
      scale_inferred: true,
      scale_basis: '按一个试点周期覆盖一次采购评审估算，没有资料给出具体数字',
      metrics: ['试点客户 IT 是否把可管理性写进招标条款', '半年之内是否进入下一轮采购'],
      alternatives: [
        { dimension: 'layer', option: '押端侧算力', kind: '其他', why_not: `买方不为 AI 本身付钱${newKey ? ` [${newKey}]` : ''}` },
        { dimension: 'acquire', option: '与现有管理平台厂商合作预装管理能力', kind: '合作', why_not: '差异化会落在对方平台上' },
        { dimension: 'acquire', option: '收购一家终端管理公司', kind: '收购', why_not: '现有证据不足以支撑这么大的投入' },
      ],
      change_if: ['试点客户的 IT 依然只看价格和换机周期'],
      changes: changes(newKey),
    };
  };

  it('the model rewrites all 9 cells but marks 2 as changed: only those 2 are listed (in full, with why), the other 7 are vN word for word', async () => {
    const { follow, v1, v2 } = await chain({
      recommendation: rewriteAll((k) => ({
        decision_answer: { changed: true, why: `新增证据 [${k}] 显示只有管理严格的大企业把可管理性当门槛` },
        action: { changed: false, why: '' },
        scale: { changed: false, why: '' },
        metrics: { changed: false, why: '' },
        alternatives: { changed: true, why: `端侧算力那条改用新证据 [${k}]` },
        change_if: { changed: false, why: '' },
      })),
    });
    expect(follow.delivered).toBe(true);
    const oldRows = section(v1.body, /^## Summary/).split('\n').filter((l) => /^\| (做什么|量级|看什么指标|什么情况下要改) \|/.test(l));
    const newSummary = section(v2.body, /^## Summary/);
    // the 4 single-row parts that did not change are vN's rows, character for character (the model's rewording is not used)
    expect(oldRows).toHaveLength(4);
    for (const row of oldRows) expect(newSummary).toContain(row);
    expect(newSummary).not.toContain('由商用产品线来牵头');
    // the 2 parts that changed are the new text
    expect(newSummary).toContain('| 对决策的回答 | 押管理和安全栈，自研为主，但只在管理严格的大企业里（提议） |');
    expect(newSummary).toMatch(/\| 其他选项（押别的层） \| 押端侧算力：不选，买方不为 AI 本身付钱\[\^\d+\] \|/);
    const change = section(v2.body, /^## 本版变化/);
    expect(change).toContain('  - 对 D1 的回答（变了）：');
    expect(change).toContain('    - 改前：押管理和安全栈，自研为主（提议）');
    expect(change).toContain('    - 改后：押管理和安全栈，自研为主，但只在管理严格的大企业里（提议）');
    expect(change).toMatch(/ {4}- 为什么：新增证据\[\^\d+\] 显示只有管理严格的大企业把可管理性当门槛/);
    expect(change).toContain('  - 其他选项（变了）：');
    expect(change).not.toMatch(/做什么（变了）|量级（变了）|看什么指标（变了）|什么情况下要改（变了）/);
    // the alternatives row by row: only the row that cites the new evidence changed; the other two are vN's rows
    expect(change).toMatch(/ {4}- 改后：其他选项（押别的层）：押端侧算力/);
    expect(change).not.toMatch(/改前：其他选项（换一种拿法：(合作|收购)）/);
    for (const row of section(v1.body, /^## Summary/).split('\n').filter((l) => /^\| 其他选项（换一种拿法/.test(l))) expect(newSummary).toContain(row);
    expect(change).toContain('  - 其余 6 格未变');
    expect(section(v2.body, /^## 附录/)).toContain('- v1 的推荐判断（已被本版替换）：');
    expect(v2.body.match(/^- AI 的推荐判断（提议，待你拍板）：$/gm)).toHaveLength(1);
  });

  it('a part marked changed whose why does not point at the new evidence or a verdict that moved goes back to vN (logged)', async () => {
    const { follow, v1, v2, fx } = await chain({
      recommendation: rewriteAll(() => ({
        decision_answer: { changed: true, why: '换个说法更清楚' },
        action: { changed: true, why: '资料甲一直都这么说，没有新东西' },
      })),
    });
    expect(follow.delivered).toBe(true);
    const oldD1 = section(v1.body, /^## Summary/).split('\n').find((l) => l.startsWith('| 对决策的回答 |'))!;
    const oldDo = section(v1.body, /^## Summary/).split('\n').find((l) => l.startsWith('| 做什么 |'))!;
    expect(section(v2.body, /^## Summary/)).toContain(oldD1);
    expect(section(v2.body, /^## Summary/)).toContain(oldDo);
    expect(section(v2.body, /^## 本版变化/)).toContain('  - 各格都没有变：这次的新证据没有改变推荐判断');
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.filter((r) => r.action === 'research:recommend-reverted')).toHaveLength(2);
  });

  it('the recommendation step fails: vN\'s table stays in Summary, the report is a draft, the run is not interrupted', async () => {
    const { follow, v1, v2 } = await chain({ recommendation: null });
    expect(follow.delivered).toBe(false);
    expect(follow.failedChecks.join('\n')).toMatch(/推荐判断没有通过检查：推荐判断整段没有写/);
    expect(section(v2.body, /^## Summary/)).toContain(section(v1.body, /^- AI 的推荐判断/).split('\n').find((l) => l.startsWith('| 做什么 |'))!);
    expect(section(v2.body, /^## 本版变化/)).toMatch(/推荐判断的变化：这一版没有重写推荐判断/);
  });
});

describe('D-28: a follow-up on the full budget; no first-hand source → 证据不足, as a question for experts', () => {
  it('budget full reaches the run: full limits, the log and the report say so; small stays the default', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: QUESTION });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel().model, webClient: fakeWeb(), budget: 'full' });
    const v2 = await fx.vault.read(follow.reportPath);
    expect((v2.data.research_run as { mode: string }).mode).toBe('full');
    expect((v2.data.follow_up as { budget: string }).budget).toBe('full');
    expect(v2.body).toContain('完整调查的预算');
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.some((r) => r.action === 'research:followup' && r.reason.includes('完整调查预算（搜 30 次、抓 45 次）'))).toBe(true);
    // and the default is still the small budget
    const added2 = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: '另一个子问题：预算由谁批' });
    const ctx2 = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const small = await executeFollowUp({ ctx: ctx2, claimId: 'C1', subQuestionId: added2.subQuestionId, model: scriptedModel().model, webClient: fakeWeb() });
    expect(((await fx.vault.read(small.reportPath)).data.research_run as { mode: string }).mode).toBe('small');
  });

  it('nothing new found for the sub-question: the block says 证据不足 and the question lands on the expert list', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    const web = fakeWeb();
    web.fetch = async (req) => {
      web.fetches.push(req.url);
      throw new Error('HTTP 404');
    };
    const question = '凭什么是联想、不是 Intune 和 Agent 365';
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel().model, webClient: web, budget: 'full' });
    expect(follow.followUp.newEvidence).toBe(0);
    const body = (await fx.vault.read(follow.reportPath)).body;
    expect(body).toContain('  - 这一问的结论：证据不足（这次没有找到一手来源），转成要问专家的问题');
    expect(body).toMatch(new RegExp(`仍要问专家：[^\\n]*「${question}」——这次追加调查没有找到一手来源，需要问专家`));
  });
});
