/** The research grill's safety net: a question in the text instead of an ask_user card gets one nudge (as in the workspace chat). */
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { ASK_USER_NUDGE } from '@/components/chat/chat-state';
import { messageToNudge } from '@/components/research/chat-nudge';
import { runAgent } from '@/lib/harness';
import { step } from '../m1/helpers';
import { setup } from './research-fixture';

const asked = (id: string, t: string) => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: '我想查 IT 可管理性' }] },
  { id, role: 'assistant', parts: [{ type: 'text', text: t }] },
];
// how a grill question looks when the model forgets the card
const IN_TEXT = '先确认范围：你说的"企业"是指有统一机队管理的大中型企业，还是也包括小企业？';

describe('messageToNudge', () => {
  it('right after a turn that ends with a question in the text: that message, once', () => {
    const nudged = new Set<string>();
    expect(messageToNudge({ wasBusy: true, status: 'ready', messages: asked('a1', IN_TEXT), nudged })).toBe('a1');
    expect(messageToNudge({ wasBusy: true, status: 'ready', messages: asked('a1', IN_TEXT), nudged })).toBeNull();
  });
  it('not for history loaded from storage, not while streaming, not after an error, not when the card was sent', () => {
    expect(messageToNudge({ wasBusy: false, status: 'ready', messages: asked('a1', IN_TEXT), nudged: new Set() })).toBeNull();
    expect(messageToNudge({ wasBusy: true, status: 'streaming', messages: asked('a1', IN_TEXT), nudged: new Set() })).toBeNull();
    expect(messageToNudge({ wasBusy: true, status: 'error', messages: asked('a1', IN_TEXT), nudged: new Set() })).toBeNull();
    const withCard = [...asked('a1', IN_TEXT).slice(0, 1), { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: IN_TEXT }, { type: 'tool-ask_user', state: 'input-available' }] }];
    expect(messageToNudge({ wasBusy: true, status: 'ready', messages: withCard, nudged: new Set() })).toBeNull();
  });
  it('a plan written without a question is not nudged', () => {
    expect(messageToNudge({ wasBusy: true, status: 'ready', messages: asked('a1', '已写好 计划 v1，按论点组织。'), nudged: new Set() })).toBeNull();
  });
});

describe('the turn after the nudge on the research track', () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  it('in the plan phase the model can answer the nudge with an ask_user card, and the loop stops for the human', async () => {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    expect(fx.ctx.phase).toBe('research_plan');
    const model = new MockLanguageModelV3({
      doStream: [step({ calls: [{ toolName: 'ask_user', input: { question: '"企业"的范围是？', options: [{ id: 'a', label: '有统一机队管理的大中型企业' }, { id: 'b', label: '也包括小企业' }], why: '范围决定查哪些资料' } }] }), step({ text: 'unreachable' })],
    });
    fx.ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)
    const r = await runAgent({ ctx: fx.ctx, model, messages: [{ role: 'user', content: '我想查 IT 可管理性' }, { role: 'assistant', content: IN_TEXT }, { role: 'user', content: ASK_USER_NUDGE }] });
    await r.consumeStream();
    const steps = await r.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].toolCalls.map((c) => c.toolName)).toEqual(['ask_user']);
  });
});
