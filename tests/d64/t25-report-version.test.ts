/** T25 approved fix: version the report's title, not the first physical line; keep historical references untouched. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeResearch } from '@/lib/research/execute';
import { executeInterviewFollowUp, saveInterview } from '@/lib/research/interview-followup';
import { readJudgmentFile } from '@/lib/research/judgment-file';
import { createMockModel } from '@/lib/testing/mock-model';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, scriptedModel, setup, WS } from '../m2/research-fixture';
let cleanup = async () => {};
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 }))));
afterEach(async () => { vi.unstubAllGlobals(); await cleanup(); });
describe('T25 report title version', () => {
  it.each(['', '\n', '\n\n\n'])('updates the first heading after prefix %j, leaving v1 and history intact', async (prefix) => {
    const fx = await setup({ keys: ['K3'], subQuestions: 1 }); cleanup = fx.cleanup;
    const run = await executeResearch({ ctx: fx.ctx, mode: 'full', model: scriptedModel({ summaryExtra: (k) => ({ reasons: [{ title: '先验证', basis: [{ text: '采购由 IT 部门主导', kind: '事实', source: '资料甲', refs: k ? [k] : [] }] }], gaps: [{ question: 'K3 跨设备是否有增量？', missing: '没有留存对比', how: '产品数据' }], recommendations: [{ title: '先验证', how: '收集产品数据', refs: ['H1'] }] }) }).model, webClient: fakeWeb() });
    expect(run.delivered).toBe(true);
    const old = await fx.vault.read(run.reportPath);
    await fx.vault.write(run.reportPath, { frontmatter: old.data, body: `${prefix}${old.body.trimStart()}\n## 历史备注\n\n记录沿用调查报告 v1。\n` }, { overwrite: true });
    const before = await fx.vault.read(run.reportPath);
    const interview = await saveInterview(fx.vault, ROLES.juniorA, WS, { name: '标题回归访谈', content: '# 访谈\n\n只读授权有边界。', simulated: true });
    const next = await executeInterviewFollowUp({ ctx: fx.ctx, interviews: [interview.path], model: createMockModel() });
    const note = await fx.vault.readTyped(next.reportPath, 'report');
    expect(note.note.version).toBe(2);
    expect((await readJudgmentFile(fx.vault, next.reportPath))?.report).toBe('报告 v2.md');
    expect(note.body.match(/^# .+$/m)?.[0]).toContain('调查报告 v2');
    expect(note.body).toContain('记录沿用调查报告 v1。');
    expect((await fx.vault.read(run.reportPath)).body).toBe(before.body);
  });
});
