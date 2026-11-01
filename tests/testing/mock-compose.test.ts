/** The e2e mock follows the new workplan co-creation: frame_topic → compose_workplan in chat, and the four compose calls as JSON. */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerResearchStep } from '@/lib/testing/mock-research';
import { taskLine } from '@/lib/testing/mock-contract';
import { nextStep, readTurn, type PromptMessage } from '@/lib/testing/mock-agent';
import { createMockModel } from '@/lib/testing/mock-model';
import { composeWorkplan } from '@/lib/workplan/compose/compose';
import { updateState } from '@/lib/workplan/compose/state';
import { checkTree } from '@/lib/workplan/compose/tree';
import { leavesOf, treeSchema, type PackItem } from '@/lib/workplan/compose/types';
import { listWorkplans } from '@/lib/workplan/state';
import { ctxFor, makeM1Vault, WS } from '../m1/helpers';

const holder = vi.hoisted(() => ({ model: null as unknown }));
vi.mock('@/lib/models/provider', () => ({ getModel: async () => ({ model: holder.model }) }));

const system = `当前角色：Junior A（junior）。当前阶段：拆题中。Workspace：${WS}。\n规则：…`;
const user = (text: string): PromptMessage => ({ role: 'user', content: [{ type: 'text', text }] });
const call = (toolName: string, input: object = {}): PromptMessage => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: toolName, toolName, input }] });
const result = (toolName: string, output: unknown): PromptMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: toolName, toolName, output }] });
const json = (value: unknown) => ({ type: 'json', value });

const CO_CREATE = ['ask_user', 'frame_topic'];
const step = async (prompt: PromptMessage[], tools = CO_CREATE) => nextStep(readTurn(prompt, tools));

/** The history of a full first co-creation, one step at a time (the step is the number of tool calls since the last user message). */
function history() {
  const start: PromptMessage[] = [{ role: 'system', content: system }, user('我们开始共创这个 Workspace 的 workplan 吧。')];
  const asked = [...start, call('ask_user'), result('ask_user', json({ selected: ['a'] }))];
  const framed = [...asked, call('frame_topic'), result('frame_topic', json({ to_mark: [{ id: 'K1' }, { id: 'K2' }] }))];
  const marked = [...framed, call('frame_topic'), result('frame_topic', json({ stage: 'confirm' }))];
  const confirmedCard = [...marked, call('ask_user'), result('ask_user', json({ selected: ['a'] }))];
  const confirmed = [...confirmedCard, call('frame_topic'), result('frame_topic', json({ stage: 'ready' }))];
  const composed = [...confirmed, call('compose_workplan'), result('compose_workplan', json({ say: 'v1 拆好了，右边是 workplan。' }))];
  return { start, asked, framed, marked, confirmedCard, confirmed, composed };
}

describe('the first co-creation chat script', () => {
  it('asks, frames, marks, confirms, records the confirmation, composes, and passes the say on', async () => {
    const h = history();
    expect(await step(h.start)).toMatchObject({ call: { toolName: 'ask_user', input: { question: '这项研究要支撑什么决策？' } } });

    // 1. the frame: the user's words as the topic, four slots and the size
    expect(await step(h.asked)).toMatchObject({
      call: { toolName: 'frame_topic', input: { topic: '我们开始共创这个 Workspace 的 workplan 吧。', decision: '明年要不要押注企业端 AI PC', scope: '2026–2027 年，大中型企业', success: '知道企业买单的首要条件', size: '大题', question: expect.stringMatching(/.+/) } },
    });

    // 2. one 一致 mark per item of the last frame_topic result's to_mark
    expect(await step(h.framed)).toMatchObject({
      call: { toolName: 'frame_topic', input: { marks: [{ ref: 'K1', verdict: '一致' }, { ref: 'K2', verdict: '一致' }] } },
    });

    // 3. the confirm card
    expect(await step(h.marked)).toMatchObject({
      call: { toolName: 'ask_user', input: { options: expect.arrayContaining([expect.objectContaining({ label: '就按这个拆' })]) } },
    });

    // 4. the user said "就按这个拆"
    expect(await step(h.confirmedCard)).toMatchObject({ call: { toolName: 'frame_topic', input: { confirmed: true } } });
    expect(await step(h.confirmed)).toMatchObject({ call: { toolName: 'compose_workplan' } });
  });

  it('the last text is the say of the compose_workplan result when it has one', async () => {
    const h = history();
    expect(await step(h.composed)).toEqual({ text: 'v1 拆好了，右边是 workplan。' });
    const noSay = [...h.confirmed, call('compose_workplan'), result('compose_workplan', json({ status: 'done' }))];
    expect(await step(noSay)).toEqual({ text: '拆好了，右边是研究计划。' });
  });

  it('with submit_for_review among the tools the old write_draft script still runs', async () => {
    const tools = ['ask_user', 'write_draft', 'submit_for_review'];
    const start: PromptMessage[] = [{ role: 'system', content: system }, user('我们开始共创这个 Workspace 的 workplan 吧。')];
    expect(await step(start, tools)).toMatchObject({ call: { toolName: 'ask_user' } });
    const twoAnswers: PromptMessage[] = [...start, call('ask_user'), result('ask_user', json({ selected: ['a'] })), call('ask_user'), result('ask_user', json({ selected: ['h1'] }))];
    expect(await step(twoAnswers, tools)).toMatchObject({ call: { toolName: 'write_draft', input: { note_type: 'workplan', name: 'workplan v1' } } });
  });
});

describe('the compose_workplan JSON calls', () => {
  const pack: PackItem[] = [{ id: 'K4', kind: 'reference', title: '资料', path: 'x.md', gist: '' }];
  const treePrompt = (refs: string) =>
    [`任务：拆 workplan`, '## 问题', '要回答的问题：企业买单的首要条件是不是 IT 能管？', `题目大小：大题`, '', '## 参考资料（编号可以写进 known_by 和 to_verify.where）', refs].join('\n');

  it('answers the task labels by their 任务： line', () => {
    expect(typeof answerResearchStep(`${taskLine('workplan_judgment')}\n## 决策契约`)).toBe('string');
    expect(answerResearchStep(`${taskLine('workplan_eval')}\n## 草案`)).toMatchObject({ answers: expect.any(Array) });

    const tree = treeSchema.parse(answerResearchStep(treePrompt('- K4《资料》：企业采购看 IT 能不能管')));
    expect(tree.core_question).toBe('企业买单的首要条件是不是 IT 能管？');
    expect(leavesOf(tree)).toHaveLength(4);
    expect(leavesOf(tree)[0].node.hypothesis.known_by).toEqual(['K4']);
    expect(checkTree(tree, pack)).toEqual({ errors: [], warnings: expect.any(Array) });

    // no reference in the pack: every hypothesis has an empty known_by and the tree still passes
    const bare = treeSchema.parse(answerResearchStep(treePrompt('（没有命中的资料：假设的 known_by 只能留空，要证实的写"上网"）')));
    expect(leavesOf(bare).every((l) => l.node.hypothesis.known_by.length === 0)).toBe(true);
    expect(checkTree(bare, []).errors).toEqual([]);

    expect(typeof answerResearchStep(`${taskLine('workplan_revise')}\n## 草案`)).toBe('string');
  });
});

describe('a first co-creation through the real pipeline with the mock model', () => {
  let vault: Awaited<ReturnType<typeof makeM1Vault>>['vault'];
  let root: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, root, cleanup } = await makeM1Vault());
    await rm(path.join(root, WS, 'workplan v1.md')); // a first co-creation: no workplan yet
  });
  afterEach(async () => cleanup());

  it('composes a workplan v1 from the mock answers', async () => {
    holder.model = createMockModel();
    await updateState(vault, WS, (s) => ({
      ...s,
      frame: { question: '企业买单的首要条件是不是 IT 能管？', decision: '明年要不要押注企业端 AI PC', scope: '2026–2027 年，大中型企业', success: '知道企业买单的首要条件', known: '资料里还没有现成结论', bar: '内部资料加一个独立外部来源就够' },
      confirmed: true,
      size: '大题',
    }));
    const r = await composeWorkplan(await ctxFor(vault));
    expect(r.status).toBe('done');
    expect((await listWorkplans(vault, WS)).map((v) => v.version)).toEqual([1]);
  });
});

describe('the step right after the confirmation', () => {
  it('is still the compose script when only compose_workplan is offered', async () => {
    const msgs = [
      { role: 'system', content: system },
      user('我们开始共创这个 Workspace 的 workplan 吧。'),
      ...['ask_user', 'frame_topic', 'frame_topic', 'ask_user', 'frame_topic'].flatMap((n) => [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: n, toolName: n, input: {} }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: n, toolName: n, output: {} }] },
      ]),
    ];
    expect(await nextStep(readTurn(msgs, ['compose_workplan']))).toMatchObject({ call: { toolName: 'compose_workplan' } });
  });
});
