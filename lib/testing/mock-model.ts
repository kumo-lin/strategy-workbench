/**
 * The model behind `MODEL_MOCK=1` (see lib/models/provider.ts). Loaded only through a
 * dynamic import in that branch, so it is not part of any run without the env var.
 *
 * Two kinds of caller, told apart by whether tools were passed:
 *   - the agent chat (streamText, with tools)      → lib/testing/mock-agent.ts
 *   - the orchestrated Deep Research steps (JSON)  → lib/testing/mock-research.ts
 */
import { simulateReadableStream, type LanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { nextStep, readTurn, type PromptMessage } from './mock-agent';
import { answerResearchStep } from './mock-research';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

interface CallOptions {
  prompt: PromptMessage[];
  tools?: { name: string }[];
}

const textOf = (prompt: PromptMessage[]) =>
  prompt.map((m) => (typeof m.content === 'string' ? m.content : (m.content as { text?: string }[]).map((p) => p.text ?? '').join(''))).join('\n');

/**
 * MOCK_MODEL_DELAY_MS: wait this long before every orchestrated model call. With scripted answers a whole small
 * investigation takes well under a second, so a test could never leave the page or reload "while it runs".
 */
const delayMs = () => Number(process.env.MOCK_MODEL_DELAY_MS ?? 0) || 0;

export function createMockModel(): LanguageModel {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      if (delayMs() > 0) await new Promise((r) => setTimeout(r, delayMs()));
      const o = options as unknown as CallOptions;
      const answer = answerResearchStep(textOf(o.prompt));
      return {
        content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }], // a string = markdown (the baseline's report)
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
    doStream: async (options) => {
      const o = options as unknown as CallOptions;
      const step = await nextStep(readTurn(o.prompt, (o.tools ?? []).map((t) => t.name)));
      const chunks =
        'text' in step
          ? [
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: step.text },
              { type: 'text-end', id: 't' },
              { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
            ]
          : [
              { type: 'tool-call', toolCallId: `call-${step.call.toolName}-${Date.now().toString(36)}`, toolName: step.call.toolName, input: JSON.stringify(step.call.input) },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
            ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}
