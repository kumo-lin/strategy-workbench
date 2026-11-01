/**
 * Per-call usage log (opt-in): with `USAGE_LOG=<file.jsonl>` every model call appends one line with its tokens, cache
 * hits, reasoning tokens and wall time. `scripts/usage-report.ts` turns the file into a per-run table with cost. Nothing
 * here changes what the model is asked or returns; a failed write only warns.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { wrapLanguageModel, type LanguageModel } from 'ai';

export interface UsageRecord {
  at: string;
  providerId: string;
  model: string;
  kind: 'generate' | 'stream';
  ms: number;
  input: number;
  /** Input tokens served from the provider's prompt cache. */
  cacheRead: number;
  output: number;
  reasoning: number;
  /** Set when the call threw (no usage then). */
  error?: string;
}

interface UsageLike {
  inputTokens?: { total?: number; cacheRead?: number };
  outputTokens?: { total?: number; reasoning?: number };
  raw?: unknown;
}

/** Cache hits as the SDK reports them, else DeepSeek's own field, else OpenAI's `prompt_tokens_details.cached_tokens`. */
export function cacheReadOf(u: UsageLike | undefined): number {
  if (!u) return 0;
  if (typeof u.inputTokens?.cacheRead === 'number') return u.inputTokens.cacheRead;
  const raw = (u.raw ?? {}) as { prompt_cache_hit_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
  if (typeof raw.prompt_cache_hit_tokens === 'number') return raw.prompt_cache_hit_tokens;
  if (typeof raw.prompt_tokens_details?.cached_tokens === 'number') return raw.prompt_tokens_details.cached_tokens;
  return 0;
}

export function usageRecord(base: Pick<UsageRecord, 'providerId' | 'model' | 'kind'>, startedAt: number, u: UsageLike | undefined, error?: unknown): UsageRecord {
  return {
    at: new Date(startedAt).toISOString(),
    ...base,
    ms: Date.now() - startedAt,
    input: u?.inputTokens?.total ?? 0,
    cacheRead: cacheReadOf(u),
    output: u?.outputTokens?.total ?? 0,
    reasoning: u?.outputTokens?.reasoning ?? 0,
    ...(error !== undefined ? { error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) } : {}),
  };
}

async function append(file: string, r: UsageRecord): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(r)}\n`, 'utf8');
  } catch (e) {
    console.warn(`usage log: could not write ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The model, logging each call's usage to `file`. */
export function withUsageLog(model: LanguageModel, info: { providerId: string; model: string }, file: string): LanguageModel {
  if (typeof model === 'string' || model.specificationVersion !== 'v3') return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate }) => {
        const t0 = Date.now();
        try {
          const result = await doGenerate();
          await append(file, usageRecord({ ...info, kind: 'generate' }, t0, result.usage));
          return result;
        } catch (e) {
          await append(file, usageRecord({ ...info, kind: 'generate' }, t0, undefined, e));
          throw e;
        }
      },
      wrapStream: async ({ doStream }) => {
        const t0 = Date.now();
        const { stream, ...rest } = await doStream();
        let usage: UsageLike | undefined;
        const logged = stream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              if (chunk.type === 'finish') usage = chunk.usage;
              controller.enqueue(chunk);
            },
            async flush() {
              await append(file, usageRecord({ ...info, kind: 'stream' }, t0, usage));
            },
          }),
        );
        return { stream: logged, ...rest };
      },
    },
  });
}
