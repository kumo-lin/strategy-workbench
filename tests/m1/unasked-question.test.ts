/** A question written into the reply text instead of an ask_user card must be noticed (M5 5.0 finding 3.1). */
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASK_USER_NUDGE, unaskedQuestionMessageId } from '@/components/chat/chat-state';
import { buildToolContext, runAgent } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { ROLES } from '../helpers/fixture-vault';
import { makeM1Vault, step, WS } from './helpers';

const text = (t: string) => ({ type: 'text', text: t });
const tool = (name: string, state: string) => ({ type: `tool-${name}`, state });
const assistant = (id: string, ...parts: ReadonlyArray<{ type: string; text?: string; state?: string }>) => ({ id, role: 'assistant', parts });
const user = (id: string, t: string) => ({ id, role: 'user', parts: [text(t)] });

// The text the model really ended the turn with in the 5.0 run (no ask_user call followed).
const ANNOUNCED =
  'c 收到：先 desk 出初步判决，H4 判不出来再补访谈。\n\n第四问是关键：查之前先写一句 Day-1 answer。它不写，后面论点容易退化成"市场怎么样"的描述。我的推荐是 a，因为它把"门槛"和"付钱"分开；b 太顺，c 是目前证据下最该被认真对待的反面。';

describe('unaskedQuestionMessageId', () => {
  it('flags a turn that ends with the question announced in text (the real failure)', () => {
    const msgs = [user('u1', '继续'), assistant('a1', tool('vault_search', 'output-available'), text(ANNOUNCED))];
    expect(unaskedQuestionMessageId(msgs)).toBe('a1');
  });

  it('flags a turn that ends with a plain question mark, full-width or ascii, even inside quotes or brackets', () => {
    for (const q of ['你更认哪句？', 'Which one do you prefer?', '要不要先查优先级（还是留到下一轮）？', '你的意思是"先不查"?"']) {
      expect(unaskedQuestionMessageId([assistant('a', text(q))])).toBe('a');
    }
  });

  it('does not flag a pending or answered ask_user card, nor a turn that ends on any tool', () => {
    expect(unaskedQuestionMessageId([assistant('a', text('第四问是关键：…'), tool('ask_user', 'input-available'))])).toBeNull();
    expect(unaskedQuestionMessageId([assistant('a', text('我的推荐是 a。'), tool('ask_user', 'output-available'))])).toBeNull();
    expect(unaskedQuestionMessageId([assistant('a', text('你更认哪句？'), tool('write_draft', 'output-available'))])).toBeNull();
  });

  it('does not flag an ordinary statement, a report of what was written, or an empty reply', () => {
    expect(unaskedQuestionMessageId([assistant('a', text('已写到 workplan v2，改了论点 2 末尾两段。'))])).toBeNull();
    expect(unaskedQuestionMessageId([assistant('a', text('  '), { type: 'step-start' })])).toBeNull();
    expect(unaskedQuestionMessageId([])).toBeNull();
  });

  it('only looks at the last message: a user message after the question means it was answered by typing', () => {
    const msgs = [assistant('a1', text('你更认哪句？')), user('u2', 'a')];
    expect(unaskedQuestionMessageId(msgs)).toBeNull();
  });

  it('ignores reasoning and step markers after the text', () => {
    expect(unaskedQuestionMessageId([assistant('a', text('你更认哪句？'), { type: 'step-start' }, { type: 'reasoning', text: '…' })])).toBe('a');
  });

  it('the nudge tells the model what to do', () => {
    expect(ASK_USER_NUDGE).toContain('ask_user');
  });
});

describe('the turn after the nudge (mock model, real harness)', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, cleanup } = await makeM1Vault());
  });
  afterEach(async () => cleanup());

  it('a text-only turn is detected; the nudge makes the model call ask_user and the loop stops for the human', async () => {
    const ctx = await buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS, track: 'workspace' });
    ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)

    // Turn 1: the model announces the next question in plain text and ends the turn.
    const first = new MockLanguageModelV3({ doStream: [step({ text: ANNOUNCED })] });
    const r1 = await runAgent({ ctx, model: first, messages: [{ role: 'user', content: '继续' }] });
    await r1.consumeStream();
    const reply = (await r1.steps).flatMap((s) => s.content).filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('');
    expect(reply).toBe(ANNOUNCED);
    expect(unaskedQuestionMessageId([{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: reply }] }])).toBe('a1');

    // Turn 2: the shell sends ASK_USER_NUDGE; the model answers with the card.
    const question = { question: '查之前先写一句 Day-1 answer，你更认哪句？', options: [{ id: 'a', label: '门槛但不带来溢价' }, { id: 'b', label: '门槛且愿意付钱' }] };
    const second = new MockLanguageModelV3({ doStream: [step({ calls: [{ toolName: 'ask_user', input: { ...question, why: '先定 Day-1 answer' } }] }), step({ text: 'unreachable' })] });
    const r2 = await runAgent({
      ctx,
      model: second,
      messages: [
        { role: 'user', content: '继续' },
        { role: 'assistant', content: reply },
        { role: 'user', content: ASK_USER_NUDGE },
      ],
    });
    await r2.consumeStream();
    const steps = await r2.steps;
    expect(steps).toHaveLength(1); // ask_user is a client tool: the loop stops here
    expect(steps[0].toolCalls.map((c) => c.toolName)).toEqual(['ask_user']);
    expect(JSON.stringify(second.doStreamCalls[0].prompt)).toContain('用 ask_user 重发');
    expect((await vault.readLog(`${WS}/日志.md`)).some((r) => r.action === 'tool:ask_user')).toBe(true);
  });
});
