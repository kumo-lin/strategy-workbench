/**
 * D-39 P4: a follow-up on a question-tree report. The re-judged hypothesis' section is written again on all of
 * v(N+1)'s evidence (one response per challenge: vN's responses are not kept beside the new ones, sample 备注 2), with
 * its code-written "Q2-1 的回答"; the top-level sub-question's answer, its Summary line and the hypothesis' row follow
 * this version; only this version's judgment is written, the comparison goes to 本版变化 (用词对照表).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, executeFollowUp } from '@/lib/research/followup';
import { clearPageCache } from '@/lib/research/page-cache';
import { treeReportFailures } from '@/lib/research/selfcheck';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = undefined;
});

const now = () => new Date('2026-10-25T10:00:00Z');

/** v1 on the fixture plan made a tree (Q1 / Q2 → Q2-1, Q2-2), then a follow-up on `claimId`. */
async function treeChain(o: { mode: 'small' | 'full'; claimId: string; reasonPrefix?: string }) {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
  const fx = await setup({ approved: true, claims: 3, subQuestions: 2 });
  cleanup = fx.cleanup;
  const note = await fx.vault.read(PLAN);
  const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
  data.claims = data.claims.map((c, i) => ({ ...c, question: ['谁决定买，谁出钱？', '"IT 管得住"是不是准入要求？', '几家都管得住的时候，买方按什么选？'][i], parent: i === 0 ? null : 'Q2' }));
  data.question_tree = [{ id: 'Q2', question: '买方按什么标准放行，又按什么标准选？' }];
  data.mece_check = '谁决定买和按什么标准放行是采购的两道关；少了任何一个都答不了。';
  await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
  const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now });
  const first = await executeResearch({ ctx, mode: o.mode, model: scriptedModel().model, webClient: fakeWeb() });
  const v1 = await fx.vault.read(first.reportPath);
  const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: o.claimId, question: '员工会不会绕开 IT 自己买？' });
  const ctx2 = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now });
  const m = scriptedModel({ summaryReasonPrefix: o.reasonPrefix });
  const follow = await executeFollowUp({ ctx: ctx2, claimId: o.claimId, subQuestionId: added.subQuestionId, model: m.model, webClient: fakeWeb() });
  const v2 = await fx.vault.read(follow.reportPath);
  return { fx, first, v1, follow, v2, added };
}

describe('a follow-up on a question-tree report', () => {
  it('the plan version the follow-up adds keeps the tree', async () => {
    const { fx, added } = await treeChain({ mode: 'full', claimId: 'C2' });
    const plan = (await fx.vault.read(added.planPath)).data as { question_tree?: unknown; claims: { parent?: string }[] };
    expect(plan.question_tree).toEqual([{ id: 'Q2', question: '买方按什么标准放行，又按什么标准选？' }]);
    expect(plan.claims.map((c) => c.parent ?? null)).toEqual([null, 'Q2', 'Q2']);
  });

  it('H2-1 re-judged: its section written again (one response per challenge), its answer line and Q2\'s answer follow this version; delivered', async () => {
    const { v1, follow, v2 } = await treeChain({ mode: 'full', claimId: 'C2', reasonPrefix: 'H2-1 的理由改成：' });
    const b = v2.body;
    expect(follow.failedChecks).toEqual([]);
    expect(follow.delivered).toBe(true);
    expect(b).toMatch(/^# R1 调查报告 v2$/m);
    // one section for H2-1, no "v1 的提议判断" stacking, no follow-up block appended
    expect(b.match(/^#### 假设 H2-1：/gm)).toHaveLength(1);
    const sec = b.slice(b.indexOf('#### 假设 H2-1：'), b.indexOf('### Q2-2 '));
    expect(sec).not.toMatch(/^- v1 的提议判断|^- 追加调查（v2）/m);
    const rows = sec.split('\n').filter((l) => /^\| .* \| (?:推翻了假设|假设要改|不影响判断) \|/.test(l));
    const cites = rows.map((l) => l.split('|').at(-2)!.trim());
    expect(new Set(cites).size).toBe(cites.length); // each challenge answered once
    expect(sec).toMatch(/^- Q2-1 的回答：/m);
    // Q2's answer: the rewrite's (summary_update.reason), in its section and its Summary line; v1's line goes to the appendix
    expect(b).toMatch(/^### Q2 的回答\n\n按这一版的判断重写的理由\[\^\d+\]$/m);
    expect(b).toMatch(/^ {2}- Q2 → 按这一版的判断重写的理由\[\^\d+\]$/m);
    expect(b).toMatch(/^- 回答（一句话）：.*（由 Q1、Q2 的回答组装而成）/m);
    expect(b).toMatch(/^## 本版变化（v2，追加调查）\n- 针对：Q2-1 的假设 H2-1 /m);
    expect(b).toContain('每条挑战只保留这一版的回应');
    expect(b).toContain('- v1 的 Summary 原文（这一版按新的判断重写了的句子）：');
    // the rest of v1 is kept as it was
    const q1 = (s: string) => s.slice(s.indexOf('## Q1 '), s.indexOf('## Q2 '));
    expect(q1(b)).toBe(q1(v1.body));
    expect(treeReportFailures(b)).toEqual([]);
  });

  it('a hypothesis the small run did not reach: its "本次没有查" line becomes its section, and Q2 is answered now', async () => {
    const { v1, follow, v2 } = await treeChain({ mode: 'small', claimId: 'C2' });
    expect(v1.body).toMatch(/^- 假设 H2-1：.*（本次没有查（试水调查范围））$/m);
    const b = v2.body;
    expect(follow.failedChecks).toEqual([]);
    expect(follow.delivered).toBe(true);
    expect(b).toMatch(/^### Q2-1 "IT 管得住"是不是准入要求？\n\n#### 假设 H2-1：/m);
    expect(b).not.toMatch(/^- 假设 H2-1：.*（本次没有查/m);
    expect(b).toMatch(/^- Q2-1 的回答：(?!本次没有查)/m);
    expect(b).toMatch(/^- Q2-2 的回答：本次没有查（试水调查范围）$/m); // H2-2 still not run
    expect(v1.body).toMatch(/^- 计划之外的调整：.*H2-1 本次没有查（试水调查范围）/m);
    expect(b).not.toMatch(/^- 计划之外的调整：.*H2-1 本次没有查/m);
    expect(b).toMatch(/^- 计划之外的调整：.*H2-2 本次没有查（试水调查范围）/m);
    expect(b).toMatch(/^\| Q2-1 \| H2-1 .* \| (?!本次没有查)\S/m);
    expect(b).toMatch(/^- 回答（一句话）：.*（由 Q1、Q2 的回答组装而成）/m);
    expect(treeReportFailures(b)).toEqual([]);
  });
});
