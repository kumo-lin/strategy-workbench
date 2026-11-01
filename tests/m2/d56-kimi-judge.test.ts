/**
 * D-56 ⑦: the Kimi judge is called with thinking off and temperature 0.6 (150–250 s → 5–6 s a report, same accuracy),
 * a per-call option that leaves every other call on the config's path; and a judge that rejects is logged, never
 * passed silently. The request the OpenAI-compatible client sends is captured with a fake fetch.
 */
import { createOpenAI } from '@ai-sdk/openai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { providerConfigSchema } from '@/lib/config/models';
import { createLanguageModel, withTemperature, withThinkingDisabled } from '@/lib/models/provider';
import { KIMI_JUDGE_CALL, secondJudgeModel, verifyCitations, type CitationVerifyRecord, type FitJudge, type VerifyPair } from '@/lib/research/citation-verify';
import { executeResearch } from '@/lib/research/execute';
import { llmJson } from '@/lib/research/llm';
import { clearPageCache } from '@/lib/research/page-cache';
import { createVault } from '@/lib/vault';
import { makeFixtureVault } from '../helpers/fixture-vault';
import { fakeWeb, scriptedModel, setup } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const kimi = providerConfigSchema.parse({
  label: 'Kimi（Moonshot）',
  base_url: 'https://api.moonshot.cn/v1',
  api_key_env: 'MOONSHOT_API_KEY',
  model: 'kimi-k2.6',
  temperature: 1,
});
const env: NodeJS.ProcessEnv = { ...process.env, MOONSHOT_API_KEY: 'sk-test' };

const completion = {
  id: 'x',
  object: 'chat.completion',
  created: 0,
  model: 'kimi-k2.6',
  choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

/** The bodies the OpenAI-compatible client sends, in call order. */
function captureFetch() {
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return bodies;
}

const ask = (model: Parameters<typeof llmJson>[0]['model']) =>
  llmJson({ model, task: 't', system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }) });

describe('the per-call option on the model layer', () => {
  it('thinking off and temperature 0.6 go into the request body, overriding the config\'s 1', async () => {
    const bodies = captureFetch();
    expect(KIMI_JUDGE_CALL).toEqual({ thinking: 'disabled', temperature: 0.6 });
    const model = createLanguageModel('kimi', kimi, env, { thinking: 'disabled', temperature: 0.6 });
    await ask(model);
    const body = JSON.parse(bodies[0]);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.temperature).toBe(0.6);
    expect(body.model).toBe('kimi-k2.6');
  });

  it('no call option: exactly the old body — no thinking, the config\'s temperature, byte-identical', async () => {
    const bodies = captureFetch();
    const apiKey = env.MOONSHOT_API_KEY;
    const model = createLanguageModel('kimi', kimi, env);
    const oldWay = withTemperature(createOpenAI({ apiKey, baseURL: kimi.base_url, name: 'kimi' }).chat(kimi.model), 1);
    await ask(model);
    await ask(oldWay);
    const body = JSON.parse(bodies[0]);
    expect(body).not.toHaveProperty('thinking');
    expect(body.temperature).toBe(1);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it('a body that is not a JSON string passes through withThinkingDisabled unchanged', () => {
    expect(withThinkingDisabled('not json')).toBe('not json');
    expect(withThinkingDisabled(undefined)).toBeUndefined();
  });
});

describe('secondJudgeModel', () => {
  it('a run on deepseek: the second judge is kimi; a run on kimi: it is deepseek', async () => {
    const vault = createVault('demo-vault');
    vi.stubEnv('MOONSHOT_API_KEY', 'sk-test');
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test');
    const onDeepseek = await secondJudgeModel(vault, 'deepseek');
    expect(onDeepseek.providerId).toBe('kimi');
    const onKimi = await secondJudgeModel(vault, 'kimi');
    expect(onKimi.providerId).toBe('deepseek');
  });

  it('a config with no kimi provider: it throws', async () => {
    const { vault, cleanup } = await makeFixtureVault();
    try {
      await expect(secondJudgeModel(vault, 'deepseek')).rejects.toThrow(/kimi/);
    } finally {
      await cleanup();
    }
  });
});

const four: VerifyPair[] = [
  { id: 'p1', footnote: '[^1]', ref: '[[a#^c1]]', sentence: '微软 49%', quote: '微软 49%', source: '微软 49% 的份额' },
  { id: 'p2', footnote: '[^2]', ref: '[[b#^c2]]', sentence: '微软 49%', quote: '微软 49%', source: '微软 49% 的份额' },
];
const ok: FitJudge = async (items) => new Map(items.map((i) => [i.id, { fit: '撑得住' as const, reason: '' }]));

describe('a judge that rejected', () => {
  it('verifyCitations carries its message in errors, leaves that gate null and nothing verified', async () => {
    const down: FitJudge = async () => {
      throw new Error('401 bad key sk-abc123');
    };
    const r = await verifyCitations(four, { deepseek: ok, kimi: down });
    expect(r.errors).toEqual({ kimi: '401 bad key sk-abc123' });
    expect(r.errors.deepseek).toBeUndefined();
    expect(r.items.every((x) => x.kimi.fit === null && x.kimi.reason === '')).toBe(true);
    expect(r.counts.verified).toBe(0);
  });

  it('runCitationVerify logs it, names no key, and the report is still delivered', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true });
    const first = scriptedModel();
    const down = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error('401 bad key sk-abc123');
      },
    });
    try {
      const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: first.model, verifyModel: down, webClient: fakeWeb() });
      expect(r.delivered).toBe(true);
      const record = (await fx.vault.read(r.reportPath)).data.citation_verify as CitationVerifyRecord;
      expect(record.verified).toBe(0);
      expect(record.items.every((x) => x.kimi.fit === null)).toBe(true);
      const log = (await fx.vault.readLog(fx.ctx.logPath)).filter((x) => x.action === 'research:citation-verify-judge-failed');
      expect(log).toHaveLength(1);
      expect(log[0].change).toContain('第二个模型');
      expect(log[0].change).not.toContain('sk-abc123');
      expect(JSON.stringify(log[0])).not.toMatch(/sk-[A-Za-z0-9]/);
    } finally {
      await fx.cleanup();
    }
  });
});
