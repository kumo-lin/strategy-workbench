/** T40 supplementary: exercise the existing producer before adding the explanation layer. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readJudgmentFile } from '@/lib/research/judgment-file';
import { executeResearch } from '@/lib/research/execute';
import { executeInterviewFollowUp, saveInterview } from '@/lib/research/interview-followup';
import { createMockModel } from '@/lib/testing/mock-model';
import { M1_GAPS } from '@/lib/testing/scripts/m1';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, scriptedModel, setup, WS } from '../m2/research-fixture';
let cleanup = async () => {};
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 }))));
afterEach(async () => { vi.unstubAllGlobals(); await cleanup(); });
it('probe: versioned T25 output retains K3 membership and its concrete M1 retention gap', async () => {
  const fx = await setup({ keys: ['K3'], subQuestions: 1 });
  cleanup = fx.cleanup;
  const r = await executeResearch({ ctx: fx.ctx, mode: 'full', model: scriptedModel({ judge: ({ supports, refutes }) => ({ verdict: '证据不足', rebutted: refutes, revised_statement: null, support_lines: supports.slice(0, 1).map((k) => `公开资料只能支持口径 [${k}]`), counter_lines: [], challenge_responses: [], reasoning: '还没有可核对的留存数字', model_knowledge: [], so_what: ['先验证'], gaps: ['没有留存对比'], expert_questions: ['留存差异是多少？'] }), summaryExtra: (k) => ({ reasons: [{ title: '先验证', basis: [{ text: '采购由 IT 部门主导', kind: '事实', source: '资料甲', refs: k ? [k] : [] }] }], gaps: [...M1_GAPS], recommendations: [{ title: '先验证', how: '收集产品数据', refs: ['H1'] }] }) }).model, webClient: fakeWeb() });
  expect(r.failedChecks).toEqual([]);
  expect(r.delivered).toBe(true);
  const iv = await saveInterview(fx.vault, ROLES.juniorA, WS, { name: '访谈-多设备重度用户', content: '# 用户\n\n电脑开始、手机继续。', simulated: true });
  const next = await executeInterviewFollowUp({ ctx: fx.ctx, interviews: [iv.path], model: createMockModel() });
  const note = await fx.vault.readTyped(next.reportPath, 'report');
  const plan = await fx.vault.readTyped(fx.ctx.research!.planPath!, 'research_plan');
  expect(plan.note.claims[0].key).toBe('K3');
  expect(note.note.research_plan).toBeTruthy();
  const file = await readJudgmentFile(fx.vault, next.reportPath);
  expect(file?.report).toBe('报告 v2.md');
  expect(file?.summary?.gaps).toContainEqual(M1_GAPS[1]);
  expect(note.body).toContain('没有跨设备与单设备用户的留存对比');
});
