/** USAGE_LOG: one line per model call (generate and stream), cache hits read from the SDK or DeepSeek's raw usage; runs and cost from the log. */
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateText, simulateReadableStream, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { cacheReadOf, withUsageLog } from '@/lib/models/usage-log';
import { groupRuns, parseUsageLog, usageTable } from '@/lib/models/usage-report';

const file = path.join(tmpdir(), `usage-${process.pid}-${Date.now()}.jsonl`);
afterEach(async () => {
  await rm(file, { force: true });
});

const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 200, text: 150, reasoning: 50 },
  raw: { prompt_cache_hit_tokens: 600 },
};

describe('withUsageLog', () => {
  it('logs a generate call and a stream call with tokens, DeepSeek cache hits and time; the answer is unchanged', async () => {
    const mock = new MockLanguageModelV3({
      doGenerate: async () => ({ content: [{ type: 'text', text: 'hi' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'yo' },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
          ] as never[],
        }),
      }),
    });
    const model = withUsageLog(mock, { providerId: 'deepseek', model: 'deepseek-flash' }, file);
    expect((await generateText({ model, prompt: 'q' })).text).toBe('hi');
    const s = streamText({ model, prompt: 'q' });
    expect(await s.text).toBe('yo');
    const lines = parseUsageLog(await readFile(file, 'utf8'));
    expect(lines.map((l) => l.kind).sort()).toEqual(['generate', 'stream']);
    for (const l of lines) expect(l).toMatchObject({ providerId: 'deepseek', model: 'deepseek-flash', input: 1000, cacheRead: 600, output: 200, reasoning: 50 });
  });

  it('logs a failed call and rethrows', async () => {
    const mock = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('upstream closed'); } });
    await expect(generateText({ model: withUsageLog(mock, { providerId: 'kimi', model: 'k' }, file), prompt: 'q', maxRetries: 0 })).rejects.toThrow();
    const [l] = parseUsageLog(await readFile(file, 'utf8'));
    expect(l.error).toContain('upstream closed');
  });
});

describe('cacheReadOf', () => {
  it('prefers the SDK field, then DeepSeek, then OpenAI details', () => {
    expect(cacheReadOf({ inputTokens: { cacheRead: 5 }, raw: { prompt_cache_hit_tokens: 9 } })).toBe(5);
    expect(cacheReadOf({ raw: { prompt_tokens_details: { cached_tokens: 7 } } })).toBe(7);
    expect(cacheReadOf(undefined)).toBe(0);
  });
});

describe('groupRuns', () => {
  const rec = (at: string, providerId: string, input: number, cacheRead: number, output: number, ms = 1000) => ({ at, providerId, model: 'm', kind: 'generate' as const, ms, input, cacheRead, output, reasoning: 0 });
  it('splits runs at an idle gap and prices cache hits and misses separately', () => {
    const runs = groupRuns(
      [rec('2026-11-01T10:00:00Z', 'deepseek', 1_000_000, 400_000, 100_000), rec('2026-11-01T10:05:00Z', 'kimi', 10, 0, 10), rec('2026-11-01T11:00:00Z', 'deepseek', 1, 0, 1)],
      { deepseek: { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
      10,
    );
    expect(runs).toHaveLength(2);
    expect(runs[0].wallMs).toBe(5 * 60_000 + 1000);
    // 600k misses × 2 + 400k hits × 1 + 100k output × 3, per million
    expect(runs[0].byProvider.deepseek.cost).toBeCloseTo(1.9);
    expect(runs[0].byProvider.kimi.cost).toBeNull();
    expect(usageTable(runs)).toContain('| 1 | 2026-11-01 10:00 | 5.0 分钟 | deepseek | 1（0） | 1000k | 400k（40%） |');
  });
});
