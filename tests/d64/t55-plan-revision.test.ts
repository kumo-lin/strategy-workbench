/** T55-2 / T35 regression: a displayed plan follows its own body, including revisions without a sidecar. */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { WorkplanPanel } from '@/components/workspace/workplan-panel';
import { buildToolContext } from '@/lib/harness';
import { writeDraftNote } from '@/lib/harness/tools/write-draft';
import { nextStep } from '@/lib/testing/mock-agent';
import { workplanPrompt } from '@/lib/harness/prompts/workplan';
import { composeWorkplan } from '@/lib/workplan/compose/compose';
import { renderWorkplan } from '@/lib/workplan/compose/render';
import { updateState } from '@/lib/workplan/compose/state';
import { leavesOf, newState, treeSchema } from '@/lib/workplan/compose/types';
import * as planDoc from '@/lib/workplan/plan-doc';
import { addComment, decideReview, requestReview } from '@/lib/workplan/review-flow';
import { buildWorkplanViews } from '@/lib/workplan/view';
import { isM1, M1_CONTRACT, M1_CORE, m1TreeAnswer } from '@/lib/testing/scripts/m1';
import { createVault } from '@/lib/vault';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
const fromBody = (body: string) => (planDoc as typeof planDoc & { planDocFromBody?: (s: string) => planDoc.PlanDoc | null }).planDocFromBody?.(body) ?? null;
const tree = treeSchema.parse(m1TreeAnswer());
const state = { ...newState(), frame: { question: M1_CORE, decision: M1_CONTRACT.decision, scope: M1_CONTRACT.horizon, success: M1_CONTRACT.success, known: M1_CONTRACT.known.join('；'), bar: M1_CONTRACT.bar } };
const body = renderWorkplan({ tree, state, wsCode: 'M1', firstHypothesisNumber: 1 }).body;

it('round-trips the real renderer, including four branches, twelve hypotheses and K1–K4', () => {
  expect(fromBody(body)).toEqual(planDoc.planDocOf(tree));
  const single = treeSchema.parse({ ...tree, subquestions: leavesOf(tree).slice(1, 3).map((l) => l.node) });
  expect(fromBody(renderWorkplan({ tree: single, state, wsCode: 'M1', firstHypothesisNumber: 1 }).body)).toEqual(planDoc.planDocOf(single));
});
it('falls back for old notes and incomplete fields rather than showing a partial document', () => {
  expect(fromBody('# 旧研究计划\n\n原有正文\n')).toBeNull();
  for (const missing of [/^核心问题：.*\n/m, /^决策的全部选项：.*\n/m, /^## Day-1 answer[\s\S]*?(?=^## )/m, /^\*\*假设 H1-1\*\*.*\n/m]) expect(fromBody(body.replace(missing, ''))).toBeNull();
});
it('keeps the real comment trail and structured v2 after compose → opinion → write_draft → view → render', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sw-t55-revision-'));
  try {
    await cp('tests/fixtures/e2e-vault-m1', root, { recursive: true });
    vi.stubEnv('VAULT_DIR', root); vi.stubEnv('MODEL_PROVIDER', ''); vi.stubEnv('MODEL_MOCK', '1');
    const vault = createVault(root);
    const ws = '20_项目/个人AI战略/M1 用户持续使用';
    const actor = { id: 'junior-a', name: '分析师甲', kind: 'junior' as const };
    const senior = { id: 'senior', name: 'Senior', kind: 'senior' as const };
    const contract = await vault.read('20_项目/个人AI战略/决策契约.md');
    await vault.write('20_项目/个人AI战略/决策契约.md', { frontmatter: { ...contract.data, status: '已确认', approved_by: 'Senior', approved_at: '2026-10-29' }, body: contract.body }, { overwrite: true });
    await updateState(vault, ws, (s) => ({ ...s, topic: M1_CORE, frame: state.frame, confirmed: true, pack_frozen: true }));
    const ctx = await buildToolContext({ vault, workspacePath: ws, role: actor, track: 'workspace' });
    expect((await composeWorkplan(ctx)).status).toBe('done');
    const first = await vault.read(`${ws}/workplan v1.md`);
    const now = new Date('2026-10-29T00:00:00Z');
    const { reviewPath } = await requestReview({ vault, actor, workspacePath: ws, gate: 'G1', subject: `${ws}/workplan v1.md`, summary: '请看跨设备的边界', focus: ['K3'], now });
    const comment = await addComment({ vault, actor: senior, reviewPath, text: '不要把跨设备当成所有用户的普遍价值', now });
    await decideReview({ vault, actor: senior, reviewPath, decision: 'reject', now });
    const revised = first.body.replace('跨设备对所有用户都有价值', '跨设备仅在特定任务中有价值，先控制通用助手能力再比较');
    await writeDraftNote({ note_type: 'workplan', name: 'workplan v2', status: '进行中', frontmatter: { id: 'm1-v2', version: 2, derived_from: [`[[${ws}/workplan v1|workplan v1]]`], relates_to: [`[[${ws}/workspace|M1]]`], changes: [{ comment: comment.link, intent: '区分真正受益的用户和任务', change: '收窄 K3，加入通用助手对照' }] }, body: revised }, ctx);
    const views = await buildWorkplanViews(vault, ws);
    expect(views[1].tree?.branches.flatMap((b) => b.children)).toHaveLength(12);
    expect(JSON.stringify(views[1].tree)).toContain('先控制通用助手能力再比较');
    expect(views[1].changes[0].traced).toBe(true);
    const html = renderToString(createElement(WorkplanPanel, { versions: views })).replace(/<!-- -->/g, '');
    for (const text of ['data-testid="plan-doc"', 'data-testid="knockout-line"', 'data-testid="plan-diff-badge"', 'data-testid="change-card"', '对应意见 Senior · 2026-10-29']) expect(html).toContain(text);
    expect(html).not.toMatch(/\[\[|#\^|项目\.md/);
    expect((await vault.read(`${ws}/workplan v1.md`)).body).toBe(first.body);
    // A changed body must never be masked by the old sidecar, even for the same version.
    await vault.write(`${ws}/workplan v1.md`, { frontmatter: first.data, body: revised }, { overwrite: true });
    expect(JSON.stringify((await buildWorkplanViews(vault, ws))[0].tree)).toContain('先控制通用助手能力再比较');
    await vault.write(`${ws}/workplan v1.md`, { frontmatter: first.data, body: first.body }, { overwrite: true });
    const prompt = `Workspace：${ws}。\n${await workplanPrompt(await buildToolContext({ vault, workspacePath: ws, role: actor, track: 'workspace' }))}`;
    expect(prompt).toContain('20_项目/…/workplan v1');
    expect(isM1(prompt)).toBe(true);
    expect(isM1(prompt.replaceAll('20_项目/个人AI战略/', '20_项目/Win10/'))).toBe(false);
    expect(isM1('[[20_项目/…/workplan v1|workplan v1]]')).toBe(false);
    expect(isM1('只有任务标记，没有项目路径')).toBe(true);
    const scripted = await nextStep({ system: prompt, lastUser: `请帮我解读这条 comment：${comment.link}`, calls: ['ask_user', 'ask_user'], results: [], tools: ['ask_user', 'write_draft', 'submit_for_review'] });
    expect(scripted).toMatchObject({ call: { toolName: 'write_draft', input: { body: expect.stringContaining(M1_CORE), frontmatter: { changes: expect.arrayContaining([expect.objectContaining({ comment: comment.link })]) } } } });
    const input = (scripted as { call: { input: { body: string } } }).call.input;
    expect(fromBody(input.body)?.branches.flatMap((b) => b.children)).toHaveLength(12);
    expect(input.body).not.toMatch(/Win10|企业端 AI PC/);
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
