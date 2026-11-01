/**
 * The model calls inside the decomposition pipeline: JSON out, validated by a zod schema, every system prompt starting
 * with its `任务：<标签>` line (lib/testing/mock-contract.ts) so the scripted model of the E2E can answer by task.
 */
import { generateText, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { DEFAULT_TEMPERATURE } from '@/lib/config/models';
import { getModel } from '@/lib/models/provider';
import { LlmJsonError, LlmTimeoutError, LlmTruncatedError, llmJson, MAX_OUTPUT_TOKENS } from '@/lib/research/llm';
import { taskLine, type MockTask } from '@/lib/testing/mock-contract';
import type { ToolContext } from '@/lib/harness/types';
import { metered, type Meter } from './budget';

/** The meter of the compose run that owns this context: every call made through `composeModel(ctx)` is counted against it. */
const meters = new WeakMap<object, Meter>();
export const attachMeter = (ctx: object, meter: Meter): void => void meters.set(ctx, meter);

export async function composeModel(ctx: Pick<ToolContext, 'vault'>): Promise<LanguageModel> {
  const { model } = await getModel({ vault: ctx.vault });
  const meter = meters.get(ctx);
  return meter ? metered(model, meter) : model;
}

export interface ComposeCall<T> {
  model: LanguageModel;
  task: MockTask;
  /** The role and the rules; the `任务：` line is put in front of it here. */
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  /** Default 180 s. */
  timeoutMs?: number;
}

export function composeJson<T>(c: ComposeCall<T>): Promise<T> {
  return llmJson({
    model: c.model,
    task: `compose:${c.task}`,
    system: `${taskLine(c.task)}\n${c.system}`,
    prompt: c.prompt,
    schema: c.schema,
    signal: c.signal,
    timeoutMs: c.timeoutMs ?? 180_000,
  });
}

export interface ComposeTextCall {
  model: LanguageModel;
  task: MockTask;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  /** Default 240 s. */
  timeoutMs?: number;
}

/** A free-form answer (no JSON, no schema): the holistic judgment and its revision. Cut off or empty is an error, never a partial text. */
export async function composeText(c: ComposeTextCall): Promise<string> {
  const timeout = AbortSignal.timeout(c.timeoutMs ?? 240_000);
  const signal = c.signal ? AbortSignal.any([c.signal, timeout]) : timeout;
  try {
    const r = await generateText({
      model: c.model,
      system: `${taskLine(c.task)}\n${c.system}`,
      prompt: c.prompt,
      temperature: DEFAULT_TEMPERATURE,
      abortSignal: signal,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (r.finishReason === 'length') throw new LlmTruncatedError(`compose:${c.task}: 输出到了长度上限（${MAX_OUTPUT_TOKENS} tokens，含模型思考）被截断`);
    if (!r.text.trim()) throw new LlmJsonError(`compose:${c.task}: 模型没有给出正文`);
    return r.text.trim();
  } catch (e) {
    if (timeout.aborted && !c.signal?.aborted) throw new LlmTimeoutError(`compose:${c.task}: no answer within ${c.timeoutMs ?? 240_000} ms`);
    throw e;
  }
}
