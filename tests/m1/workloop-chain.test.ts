/**
 * The whole M1 loop with a mock model (M1 task 1.8 ⑤):
 *   共创 (ask_user → write workplan v1 + hypothesis → submit_for_review)
 *   → Junior clicks 提交 → Senior comments → a non-reviewer is refused → Senior approves
 *   → comment intent (ask intent → ask change → a made-up comment link is refused → v2)
 * The model is scripted; everything around it (phase tools, system prompt, write_draft
 * checks, approval events, log) is the real harness.
 */
import type { ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied, buildToolContext, runAgent, toolNamesForPhase } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { addComment, decideReview, recordAnswer, requestReview } from '@/lib/workplan/review-flow';
import { listWorkplans } from '@/lib/workplan/state';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';
import { step } from './helpers';

const WS = '20_项目/P/WS-A';
const LOG = `${WS}/日志.md`;
const WS_LINK = `[[${WS}/workspace|WS-A]]`;

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

type Steps = Parameters<typeof step>[0][];

/** One AI turn: a fresh context (phase from current vault state), the real system prompt, a scripted model. */
async function aiTurn(messages: ModelMessage[], steps: Steps, role: Role = ROLES.juniorA) {
  const ctx = await buildToolContext({ vault, role, workspacePath: WS, track: 'workspace' });
  ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)
  const model = new MockLanguageModelV3({ doStream: steps.map(step) });
  const result = await runAgent({ ctx, model, messages });
  await result.consumeStream();
  return { ctx, model, steps: await result.steps };
}

const systemOf = (model: MockLanguageModelV3) => {
  const sys = model.doStreamCalls[0].prompt.find((m) => m.role === 'system');
  return typeof sys?.content === 'string' ? sys.content : '';
};
const toolsOf = (model: MockLanguageModelV3) => model.doStreamCalls.flatMap((c) => (c.tools ?? []).map((t) => t.name));

/** History after the Junior answered an ask_user card. */
function answered(userText: string, toolCallId: string, input: object, output: object): ModelMessage[] {
  return [
    { role: 'user', content: userText },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName: 'ask_user', input }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName: 'ask_user', output: { type: 'json', value: output as never } }] },
  ];
}

describe('M1 work loop end to end (mock model)', () => {
  it('co-create → submit → approve → interpret comment → v2, every change traced, every step logged', async () => {
    // The shared fixture's v1 is human-authored; co-creation starts from an AI draft it may rewrite.
    const fixtureV1 = await vault.read(`${WS}/workplan v1.md`);
    await vault.write(`${WS}/workplan v1.md`, { frontmatter: { ...fixtureV1.data, author: 'AI' }, body: fixtureV1.body }, { overwrite: true, checkLinks: false });

    // ── 1. 共创: the AI asks first ───────────────────────────────────────────
    const askDecision = { question: '这个 Workspace 要支撑什么决策？', options: [{ id: 'a', label: '明年要不要押注企业端 AI PC' }, { id: 'b', label: '定价策略' }] };
    const t1 = await aiTurn([{ role: 'user', content: '我们开始共创 workplan 吧' }], [
      { calls: [{ toolName: 'ask_user', input: { ...askDecision, why: '先对齐决策' } }] },
      { text: 'unreachable' },
    ]);
    expect(t1.ctx.phase).toBe('workplan');
    // the fixture already has a workplan v1, so this is not a first co-creation: the usual set without the compose tools (gate.ts)
    expect(toolsOf(t1.model).sort()).toEqual(toolNamesForPhase('workplan').filter((n) => n !== 'frame_topic' && n !== 'compose_workplan').sort());
    expect(toolsOf(t1.model)).not.toContain('web_search');
    expect(t1.steps).toHaveLength(1); // stopped for the human
    expect(systemOf(t1.model)).toContain('共创');
    await recordAnswer({ vault, actor: ROLES.juniorA, workspacePath: WS, question: askDecision.question, answer: '明年要不要押注企业端 AI PC' });

    // ── 2. the AI drafts v1 + a hypothesis, then prepares the review ───────────
    const v1Fm = { id: 'ws-a-wp-v1', version: 1, derived_from: ['[[团队]]'], relates_to: [WS_LINK], changes: [] };
    const v1Body = '# WS-A workplan v1\n\n## 要回答的问题与要支撑的决策\n明年要不要押注企业端 AI PC。\n\n## 论点与假设\n- [[WS-A-H1 IT 可管理性]]\n\n## next action\n- 调查 H1\n';
    const h1Fm = {
      id: 'ws-a-h1',
      workspace: WS_LINK,
      statement: '企业买单的首要条件是 IT 能管',
      verdict_proposed: null,
      verdict: null,
      evidence: [],
      counter_evidence: [],
      derived_from: [`[[${WS}/workplan v1|workplan v1]]`],
      relates_to: [WS_LINK],
    };
    const t2 = await aiTurn(answered('我们开始共创 workplan 吧', 'q1', askDecision, { selected: ['a'] }), [
      { calls: [{ toolName: 'write_draft', input: { note_type: 'workplan', name: 'workplan v1', frontmatter: v1Fm, body: v1Body, why: '对齐后起草' } }] },
      { calls: [{ toolName: 'write_draft', input: { note_type: 'hypothesis', name: 'WS-A-H1 IT 可管理性', frontmatter: h1Fm, body: '# H1\n', why: '每个假设一条笔记' } }] },
      { calls: [{ toolName: 'submit_for_review', input: { gate: 'G1', subject: 'workplan v1', summary: '请看拆题', focus: ['H1 是否可证伪'], why: 'Junior 说可以交了' } }] },
      { text: '送审材料准备好了，请点"提交给 Senior"。' },
    ]);
    const prepared = t2.steps[2].toolResults[0].output as { prepared: boolean; subject: string; summary: string; focus: string[] };
    expect(prepared).toMatchObject({ prepared: true, subject: `${WS}/workplan v1.md` });
    // submit_for_review sent nothing
    expect((await vault.readTyped(`${WS}/workspace.md`, 'workspace')).note.stage).toBe('拆题中');

    // ── 3. humans: Junior clicks 提交, Senior comments, only the reviewer decides ──
    const { reviewPath } = await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', ...prepared });
    const m1 = await addComment({ vault, actor: ROLES.senior, reviewPath, text: 'H1 少了反证：会不会只是 Win10 换机潮', target: '论点与假设' });
    await expect(decideReview({ vault, actor: ROLES.juniorA, reviewPath, decision: 'approve' })).rejects.toBeInstanceOf(ApprovalDenied);
    await expect(decideReview({ vault, actor: ROLES.juniorB, reviewPath, decision: 'approve' })).rejects.toBeInstanceOf(ApprovalDenied);
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve' });
    expect((await vault.readTyped(`${WS}/workplan v1.md`, 'workplan')).note).toMatchObject({ status: '已确认', approved_by: 'Senior' });

    // ── 4. interpret the comment: the system prompt carries it, the AI asks for the intent ──
    const ask = `请帮我解读这条 comment：\n「${'H1 少了反证'}」\n${m1.link}`;
    const askIntent = {
      question: 'Senior 这条意见想达成什么？',
      options: [
        { id: 'i1', label: '担心结论被替代解释（换机潮）推翻，要求排除它' },
        { id: 'i2', label: '要求每个论点都写明反证怎么找' },
      ],
    };
    const t3 = await aiTurn([{ role: 'user', content: ask }], [
      { calls: [{ toolName: 'ask_user', input: { ...askIntent, why: '意图要 Junior 确认' } }] },
      { text: 'unreachable' },
    ]);
    const sys = systemOf(t3.model);
    expect(sys).toContain(m1.link);
    expect(sys).toContain('Win10 换机潮');
    expect(sys).toContain('workplan v2'); // v1 is approved, so the next write is a new version
    expect(sys).toContain('不用再发给 Senior');
    expect(t3.steps).toHaveLength(1);

    const askChange = { question: '怎么改？', options: [{ id: 'c1', label: '在 H1 的做法里加"排除换机潮"的检验' }, { id: 'c0', label: '不改' }], multiSelect: true };
    const t4 = await aiTurn(answered(ask, 'q2', askIntent, { selected: ['i1'] }), [
      { calls: [{ toolName: 'ask_user', input: { ...askChange, why: '改哪里由 Junior 定' } }] },
      { text: 'unreachable' },
    ]);
    expect(t4.steps).toHaveLength(1);

    // ── 5. write v2: a made-up comment link is refused inside the loop, the corrected write passes ──
    const v2 = (comment: string) => ({
      note_type: 'workplan',
      name: 'workplan v2',
      frontmatter: {
        id: 'ws-a-wp-v2',
        version: 2,
        derived_from: [`[[${WS}/workplan v1|workplan v1]]`],
        relates_to: [WS_LINK],
        changes: [{ comment, intent: '担心结论被换机潮这种替代解释推翻', change: '论点与假设：H1 加了排除换机潮的检验' }],
      },
      body: `${v1Body.replace('workplan v1', 'workplan v2')}\n- H1 检验：对比 Win10 换机前后的 AI PC 渗透率〔m1〕\n`,
      why: 'Junior 选了 i1 和 c1',
    });
    const t5 = await aiTurn(answered(ask, 'q3', askChange, { selected: ['c1'] }), [
      { calls: [{ toolName: 'write_draft', input: v2(m1.link.replace('^m1', '^m7')) }] },
      { calls: [{ toolName: 'write_draft', input: v2(m1.link) }] },
      { text: '改好了：H1 加了排除换机潮的检验〔m1〕。G1 已通过，不用重新审批。' },
    ]);
    expect(t5.steps[0].content.some((c) => c.type === 'tool-error')).toBe(true);
    expect(t5.steps[1].toolResults[0].output).toMatchObject({ path: `${WS}/workplan v2.md`, created: true });

    // ── acceptance: every change in every version traces to an existing comment block ──
    const versions = await listWorkplans(vault, WS);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    for (const v of versions) {
      for (const c of v.note.changes) {
        const check = await vault.checkCitation(c.comment);
        expect(check.ok).toBe(true);
        expect(check.path).toBe(reviewPath);
        expect(check.blockText).toContain('少了反证');
      }
    }
    expect(versions[1].note.changes).toHaveLength(1);

    // ── acceptance: every tool call the model made is a log row; human events are logged too ──
    const log = await vault.readLog(LOG);
    const toolCalls = [t1, t2, t3, t4, t5].flatMap((t) => t.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)));
    expect(log.filter((r) => r.action.startsWith('tool:')).map((r) => r.action.slice(5))).toEqual(toolCalls);
    expect(log.find((r) => r.action === 'tool:write_draft' && r.change.startsWith('✗'))?.change).toContain('^m7');
    const human = log.filter((r) => r.actor !== 'AI').map((r) => `${r.actor} ${r.action}`);
    expect(human).toEqual([
      'Junior A answer:ask_user',
      'Junior A write:review/' + reviewPath.split('/').pop()!.replace(/\.md$/, ''),
      'Junior A event:review.request',
      `Senior comment:${reviewPath.split('/').pop()!.replace(/\.md$/, '')}`,
      'Senior event:review.approve',
    ]);
    // denied approval attempts change nothing and are not recorded as events
    expect(log.filter((r) => r.action.startsWith('event:review.approve'))).toHaveLength(1);
  });
});
