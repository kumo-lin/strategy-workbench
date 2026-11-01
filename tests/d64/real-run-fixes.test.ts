/** Problems the real-model walkthrough (T56) showed that the mock script never hit. */
import { afterEach, describe, expect, it } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { setSelectionTool } from '@/lib/harness/tools/set-selection';
import { answerExplanation, classifyExplanationQuestion } from '@/lib/research/explanation-answer';
import type { ExplanationContext } from '@/lib/research/explanation-types';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

describe('real run 2.13: the AI proposed starring the project note', () => {
  it('frame notes (project, contract, plans) are dropped from a proposal, with the reason in words', async () => {
    const fx = await makeFixtureVault();
    cleanup = fx.cleanup;
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: '20_项目/P/WS-A', track: 'workspace' });
    const out = await setSelectionTool.execute!({ star: ['20_项目/P/项目.md', '10_资料库/资料甲.md'], reason: '先读' }, { ...ctx, phase: 'files_chat' });
    expect(out.proposal.starred).toEqual(['10_资料库/资料甲.md']);
    expect(out.changes).toEqual(['优先读：资料甲']);
    expect(out.frame).toEqual(['20_项目/P/项目.md']);
  });
});

describe('real run 2.10: a question that names a judgment the report does not have', () => {
  const ctx: ExplanationContext = { identity: 'a', reportName: '报告 v2', state: 'ready', interviewProvenance: 'unknown', targets: [
    { id: 'h-1', token: 'H1', label: 'H1 跨设备有增量', kind: 'claim', verdict: '证据不足', verdictLabel: '证据不足', members: [], recordedGaps: [], recordedNextSteps: [] },
  ] };
  it('says the report has no K3 and lists what it does have, instead of only "请先选择"', () => {
    const q = classifyExplanationQuestion('K3 能直接改成成立吗？', undefined, ctx);
    expect(q.kind).toBe('clarify');
    expect(q.kind === 'clarify' && q.message).toContain('这份报告里没有 K3');
    expect(q.kind === 'clarify' && q.message).toContain('H1 跨设备有增量');
    expect(answerExplanation(ctx, 'h-1', 'verdict_limit')).toMatch(/^不能/);
  });

  it('says so also when a judgment is already picked (a one-judgment report picks it by itself)', () => {
    const q = classifyExplanationQuestion('K3 能直接改成成立吗？', ctx.targets[0], ctx);
    expect(q.kind === 'clarify' && q.message).toContain('这份报告里没有 K3');
  });
});
