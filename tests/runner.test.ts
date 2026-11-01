/**
 * The agent loop with a mock model: proves at the model-request level that
 * only the current phase's tools are sent, that server tools execute and are
 * logged, and that ask_user stops the run for the human.
 * Pattern for M1/M2 tests: MockLanguageModelV3 + makeFixtureVault.
 */
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildToolContext, runAgent, toolNamesForPhase } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from './helpers/fixture-vault';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** One streamed step that calls `toolName` with `input`, or answers with text. */
function step(part: { toolName: string; input: object } | { text: string }) {
  const chunks =
    'text' in part
      ? [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: part.text },
          { type: 'text-end', id: 't' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]
      : [
          { type: 'tool-call', toolCallId: `call-${part.toolName}`, toolName: part.toolName, input: JSON.stringify(part.input) },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
        ];
  return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
}

describe('runAgent', () => {
  it('sends only the phase tools, executes server tools, stops on ask_user', async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        step({ toolName: 'vault_search', input: { query: '采购', why: '先查知识库' } }),
        step({ toolName: 'ask_user', input: { question: '先验证哪个假设？', options: [{ id: 'h1', label: 'H1' }] } }),
        step({ text: 'unreachable' }),
      ],
    });
    const ctx = await buildToolContext({ vault, role: ROLES.juniorA, workspacePath: '20_项目/P/WS-A', track: 'workspace' });
    ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)
    const result = await runAgent({ ctx, model, system: 'test', messages: [{ role: 'user', content: '开始' }] });
    await result.consumeStream();

    // every model request carried exactly the workplan-phase tools (the fixture has a workplan, so no compose tools: gate.ts)
    expect(model.doStreamCalls).toHaveLength(2);
    for (const call of model.doStreamCalls) {
      expect((call.tools ?? []).map((t) => t.name).sort()).toEqual(toolNamesForPhase('workplan').filter((n) => n !== 'frame_topic' && n !== 'compose_workplan').sort());
    }
    const steps = await result.steps;
    expect(steps[0].toolResults[0]).toMatchObject({ toolName: 'vault_search' });
    // ask_user has no server execute: the run ends waiting for the human
    expect(steps[1].toolCalls[0]).toMatchObject({ toolName: 'ask_user' });
    expect(steps[1].toolResults).toHaveLength(0);

    const log = await vault.readLog(ctx.logPath);
    expect(log.map((r) => r.action)).toEqual(['tool:vault_search', 'tool:ask_user']);
    expect(log[0].reason).toContain('先查知识库');
    expect(log[1].change).toContain('先验证哪个假设');
  });

  it('a hallucinated out-of-phase tool call never executes', async () => {
    const model = new MockLanguageModelV3({
      doStream: [step({ toolName: 'web_search', input: { sub_question_id: 'C1-Q1', query: 'x' } }), step({ text: 'ok' })],
    });
    const ctx = await buildToolContext({ vault, role: ROLES.juniorA, workspacePath: '20_项目/P/WS-A', track: 'workspace' });
    ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)
    const result = await runAgent({ ctx, model, system: 'test', messages: [{ role: 'user', content: '搜一下' }] });
    await result.consumeStream();
    const steps = await result.steps;
    expect(steps[0].toolResults).toHaveLength(0);
    expect(steps[0].content.some((c) => c.type === 'tool-error')).toBe(true);
    expect(await vault.readLog(ctx.logPath)).toEqual([]);
  });
});
