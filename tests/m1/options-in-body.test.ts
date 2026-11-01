/** 5.0 walkthrough W1: a question card whose options were written into the question text has no buttons -> send it back. */
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPTIONS_IN_BODY_ERROR, optionsWrittenInBody } from '@/components/chat/chat-state';
import { buildToolContext, runAgent } from '@/lib/harness';
import { renderWorkplanPrompt } from '@/lib/harness/prompts/workplan';
import type { Vault } from '@/lib/vault';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import { recordAnswer } from '@/lib/workplan/review-flow';
import { ROLES } from '../helpers/fixture-vault';
import { ctxFor, LOG, makeM1Vault, step, WS } from './helpers';

// Shapes of the real cards from the walkthrough (text shortened).
const BODY_ABC = 'WS-A 的 Day-1 answer 往哪个方向押？（我推荐 a）\n\na)「可管理性是准入硬门槛、不是溢价理由。」——推荐。\n\nb)「可管理性就是首要决定条件。」\n\nc)「钱落在哪一层才是答案。」';
const BODY_I = 'Senior 这条 m1 你觉得他真正想说的是哪个？（我推荐 i1）\n\ni1）他想让每条论点都接到联想。\n\ni2）他担心读不出单一结论。\n\ni4）这条确实拿不准。';
const BODY_FW = 'Day-1 answer 押哪句？\n（a）门槛是新的\n（b）门槛成立但不是 AI 带来的';

describe('optionsWrittenInBody', () => {
  it('flags an empty options list with a), i1) or （a） lines in the question', () => {
    for (const q of [BODY_ABC, BODY_I, BODY_FW]) expect(optionsWrittenInBody({ question: q })).toBe(true);
    expect(optionsWrittenInBody({ question: BODY_ABC, options: [] })).toBe(true);
  });

  it('does not flag a card that has options, even if the text also mentions them', () => {
    expect(optionsWrittenInBody({ question: BODY_ABC, options: [{ id: 'a', label: '只判门槛' }, { id: 'b', label: '判钱' }] })).toBe(false);
  });

  it('does not flag an ordinary question, a single mention, or a half-streamed input', () => {
    expect(optionsWrittenInBody({ question: '这条 workplan 要支撑什么决策？我推荐把重点放在 IT 可管上。' })).toBe(false);
    expect(optionsWrittenInBody({ question: '先看 a) 这一点：IT 管得住吗？' })).toBe(false); // not at the start of a line, one marker
    expect(optionsWrittenInBody({ question: '要不要先查优先级？\na）可以' })).toBe(false); // one marker only
    expect(optionsWrittenInBody({})).toBe(false);
    expect(optionsWrittenInBody(undefined)).toBe(false);
  });
});

describe('the prompt says where options go', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, cleanup } = await makeM1Vault());
  });
  afterEach(async () => cleanup());

  it('options live in the options parameter; the question text has no list and no ^e3 markers', async () => {
    const p = renderWorkplanPrompt(await gatherWorkplanContext(await ctxFor(vault)));
    expect(p).toContain('选项只放在 ask_user 的');
    expect(p).toContain('不要在 `question` 里再写 a) b) c) 的列表');
    expect(p).toContain('不带 `^e3`');
    expect(p).toContain('改法写在 `options` 里');
  });

  it('a rejected card is logged as the AI\'s row, not as a human answer', async () => {
    await recordAnswer({ vault, actor: ROLES.juniorA, workspacePath: WS, question: BODY_ABC, answer: '选项写在了问题正文里、options 为空，已要求重发', rejected: true });
    const rows = await vault.readLog(LOG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'AI', action: 'reject:ask_user' });
    expect(rows[0].change).toContain('提问卡被退回');
  });

  it('mock model, real harness: after the card is sent back with the error, the model resends it with options', async () => {
    const ctx = await buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS, track: 'workspace' });
    ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)
    const options = [{ id: 'a', label: '只判门槛' }, { id: 'b', label: '连钱一起判' }];
    const model = new MockLanguageModelV3({
      doStream: [step({ calls: [{ toolName: 'ask_user', input: { question: '押哪个方向？我推荐『只判门槛』。', options, why: '重发，选项放进 options' } }] }), step({ text: 'unreachable' })],
    });
    const r = await runAgent({
      ctx,
      model,
      messages: [
        { role: 'user', content: '开始共创' },
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'ask_user', input: { question: BODY_ABC } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'ask_user', output: { type: 'error-text', value: OPTIONS_IN_BODY_ERROR } }] },
      ],
    });
    await r.consumeStream();
    const steps = await r.steps;
    expect(steps).toHaveLength(1); // the new card stops the loop for the human
    const call = steps[0].toolCalls[0];
    expect(call.toolName).toBe('ask_user');
    expect(optionsWrittenInBody(call.input)).toBe(false);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain('options 参数是空的');
  });
});
