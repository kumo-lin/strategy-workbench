/**
 * D-64 复核 G: the saved chat is read back after the page mounts; a message the person sent before it arrived must
 * survive. Before the fix the late read replaced the conversation with the (empty) history, so the opening message
 * of 2.3 vanished and the next turn reached the model with no user message (the "first attempt" failures of 2.3).
 */
import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { mergeLoadedHistory } from '@/components/workspace/use-chat-log';

const msg = (id: string, role: 'user' | 'assistant', text: string): UIMessage => ({ id, role, parts: [{ type: 'text', text }] });

describe('复核 G: history read back after the person already started', () => {
  it('nothing sent yet: the history is the conversation', () => {
    const history = [msg('h1', 'user', '旧的'), msg('h2', 'assistant', '旧回答')];
    expect(mergeLoadedHistory(history, [])).toEqual(history);
  });
  it('an empty history never wipes what was just sent', () => {
    const now = [msg('n1', 'user', '我们开始共创这个 Workspace 的研究计划吧。'), msg('n2', 'assistant', '问题卡')];
    expect(mergeLoadedHistory([], now)).toEqual(now);
  });
  it('a saved history goes before what was just sent, without duplicates', () => {
    const history = [msg('h1', 'user', '旧的'), msg('n1', 'user', '新的')];
    const now = [msg('n1', 'user', '新的'), msg('n2', 'assistant', '回答')];
    expect(mergeLoadedHistory(history, now).map((m) => m.id)).toEqual(['h1', 'n1', 'n2']);
  });
  it('review: after a switch to another role or workspace the history replaces the conversation (never merges two roles)', () => {
    const history = [msg('b1', 'user', '乙的旧对话')];
    const fromA = [msg('a1', 'user', '甲刚才的对话')];
    expect(mergeLoadedHistory(history, fromA, { switched: true })).toEqual(history);
  });
});
