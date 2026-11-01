/** D-23: a provider's temperature comes from 90_配置/模型.md (Kimi accepts only 1); unset, calls keep 0.2. */
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPERATURE, providerConfigSchema } from '@/lib/config/models';
import { withTemperature } from '@/lib/models/provider';
import { llmJson } from '@/lib/research/llm';
import { z } from 'zod';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
function recordingModel() {
  const seen: (number | undefined)[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      seen.push((options as { temperature?: number }).temperature);
      return { content: [{ type: 'text', text: '{"ok":true}' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
    },
  });
  return { model, seen };
}
const call = (model: Parameters<typeof llmJson>[0]['model']) => llmJson({ model, task: 't', system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }) });

describe('temperature from the provider config', () => {
  it('the config accepts an optional temperature', () => {
    const base = { label: 'Kimi', base_url: 'https://api.moonshot.cn/v1', api_key_env: 'KIMI_API_KEY', model: 'kimi-k2' };
    expect(providerConfigSchema.parse(base).temperature).toBeUndefined();
    expect(providerConfigSchema.parse({ ...base, temperature: 1 }).temperature).toBe(1);
    expect(() => providerConfigSchema.parse({ ...base, temperature: 5 })).toThrow();
  });

  it('no temperature configured: the call sends 0.2, as before', async () => {
    const { model, seen } = recordingModel();
    await call(withTemperature(model, undefined));
    expect(seen).toEqual([DEFAULT_TEMPERATURE]);
    expect(DEFAULT_TEMPERATURE).toBe(0.2);
  });

  it('temperature 1 configured (Kimi): the model receives 1, whatever the caller asked for', async () => {
    const { model, seen } = recordingModel();
    await call(withTemperature(model, 1));
    expect(seen).toEqual([1]);
  });
});
