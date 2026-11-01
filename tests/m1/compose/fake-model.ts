/** A model that answers the compose pipeline's JSON calls by the `任务：` line of the system prompt (lib/testing/mock-contract.ts). */
import { MockLanguageModelV3 } from 'ai/test';
import { taskOf, type MockTask } from '@/lib/testing/mock-contract';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** One answer per task, or a function of how many times that task was already asked (0-based). */
export type Script = Partial<Record<MockTask, unknown | ((n: number) => unknown)>>;

export function scriptedModel(script: Script) {
  const asked: Partial<Record<MockTask, number>> = {};
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const prompt = options.prompt as { role: string; content: unknown }[];
      const system = prompt.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
      const task = taskOf(system);
      if (!task) throw new Error(`no 任务： line in the system prompt: ${system.slice(0, 80)}`);
      const n = asked[task] ?? 0;
      asked[task] = n + 1;
      const a = script[task];
      if (a === undefined) throw new Error(`the script has no answer for ${task}`);
      const answer = typeof a === 'function' ? (a as (n: number) => unknown)(n) : a;
      return { content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
    },
  });
  return { model, asked };
}
