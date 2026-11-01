import { generateText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModelsConfig } from '@/lib/config/models';
import { createLanguageModel, getModel, ModelConfigError, resolveProviderId, withMinOutputTokens } from '@/lib/models/provider';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from './helpers/fixture-vault';

const env = { ALPHA_KEY: 'a', BETA_KEY: 'b', GAMMA_KEY: 'g' } as unknown as NodeJS.ProcessEnv;

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

async function fixture(extra: Record<string, string> = {}): Promise<Vault> {
  const made = await makeFixtureVault(extra);
  cleanup = made.cleanup;
  return made.vault;
}

const modelsNoteWithRoles = (roles: string) => `---
id: config-models
type: config
status: 已确认
created: "2026-10-24"
updated: "2026-10-24"
author: Senior
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
active: alpha
providers:
  alpha: { label: Alpha, base_url: "https://alpha.example.com/v1", api_key_env: ALPHA_KEY, model: alpha-1 }
  beta: { label: Beta, base_url: "https://beta.example.com/v1", api_key_env: BETA_KEY, model: beta-1 }
  gamma: { label: Gamma, base_url: "https://gamma.example.com/v1", api_key_env: GAMMA_KEY, model: gamma-1, temperature: 1, max_output_tokens: 8000 }
roles:
${roles}
web_tools: { base_url: "https://alpha.example.com", api_key_env: ALPHA_KEY }
---

# 模型
`;

const roleFixture = (roles: string) => fixture({ '90_配置/模型.md': modelsNoteWithRoles(roles) });

describe('model roles', () => {
  it('without roles, every role and the config shape stay unchanged', async () => {
    const vault = await fixture();
    const cfg = await loadModelsConfig(vault);

    expect('roles' in cfg).toBe(false);
    expect(resolveProviderId(cfg, env)).toBe('alpha');
    expect((await getModel({ vault, env })).providerId).toBe('alpha');
    expect((await getModel({ vault, env, role: 'judgment' })).providerId).toBe('alpha');
    expect((await getModel({ vault, env, role: 'execution' })).providerId).toBe('alpha');
  });

  it('routes judgment and execution to their configured providers', async () => {
    const vault = await roleFixture('  judgment: gamma\n  execution: beta');

    await expect(getModel({ vault, env, role: 'judgment' })).resolves.toMatchObject({ providerId: 'gamma', model: { modelId: 'gamma-1' } });
    await expect(getModel({ vault, env, role: 'execution' })).resolves.toMatchObject({ providerId: 'beta', model: { modelId: 'beta-1' } });
    await expect(getModel({ vault, env })).resolves.toMatchObject({ providerId: 'alpha', model: { modelId: 'alpha-1' } });
  });

  it('falls back to active for a role that is not configured', async () => {
    const vault = await roleFixture('  judgment: gamma');

    expect((await getModel({ vault, env, role: 'judgment' })).providerId).toBe('gamma');
    expect((await getModel({ vault, env, role: 'execution' })).providerId).toBe('alpha');
  });

  it('MODEL_PROVIDER beats both roles and still rejects an unknown provider', async () => {
    const vault = await roleFixture('  judgment: gamma\n  execution: alpha');
    const overrideEnv = { ...env, MODEL_PROVIDER: 'beta' };

    expect((await getModel({ vault, env: overrideEnv, role: 'judgment' })).providerId).toBe('beta');
    expect((await getModel({ vault, env: overrideEnv, role: 'execution' })).providerId).toBe('beta');
    await expect(getModel({ vault, env: { ...env, MODEL_PROVIDER: 'nope' }, role: 'judgment' })).rejects.toBeInstanceOf(ModelConfigError);
  });

  it('an explicit providerId beats the role', async () => {
    const vault = await roleFixture('  judgment: gamma');

    expect((await getModel({ vault, env, role: 'judgment', providerId: 'alpha' })).providerId).toBe('alpha');
  });

  it('rejects roles and active values that name no provider', async () => {
    const badRoles = await roleFixture('  judgment: missing');
    await expect(loadModelsConfig(badRoles)).rejects.toThrow(/roles/);
    await cleanup?.();

    const badActive = await fixture({ '90_配置/模型.md': modelsNoteWithRoles('  judgment: gamma').replace('active: alpha', 'active: missing') });
    await expect(loadModelsConfig(badActive)).rejects.toThrow(/active/);
  });

  it('requires the API key belonging to the role provider', async () => {
    const vault = await roleFixture('  judgment: gamma');
    const result = getModel({ vault, env: { ALPHA_KEY: 'a', BETA_KEY: 'b' } as unknown as NodeJS.ProcessEnv, role: 'judgment' });

    await expect(result).rejects.toBeInstanceOf(ModelConfigError);
    await expect(result).rejects.toThrow(/GAMMA_KEY/);
  });
});

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

describe('provider output token floor', () => {
  it('raises smaller or missing limits and leaves larger or unfloored limits unchanged', async () => {
    const cases: { maxOutputTokens?: number; floor?: number; expected?: number }[] = [
      { maxOutputTokens: 100, floor: 8000, expected: 8000 },
      { maxOutputTokens: 20000, floor: 8000, expected: 20000 },
      { floor: 8000, expected: 8000 },
      { floor: undefined, expected: undefined },
    ];

    for (const testCase of cases) {
      const model = new MockLanguageModelV3({
        doGenerate: async () => ({ content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
      });
      await generateText({
        model: withMinOutputTokens(model, testCase.floor),
        prompt: 'x',
        ...(testCase.maxOutputTokens === undefined ? {} : { maxOutputTokens: testCase.maxOutputTokens }),
      });
      expect(model.doGenerateCalls[0].maxOutputTokens).toBe(testCase.expected);
    }
  });

  it('applies provider temperature and output token floor to the request', async () => {
    const vault = await roleFixture('  judgment: gamma');
    const cfg = await loadModelsConfig(vault);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'gamma-1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const model = createLanguageModel('gamma', cfg.providers.gamma, env);

    await generateText({ model, prompt: 'x', temperature: 0.2, maxOutputTokens: 50 });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.temperature).toBe(1);
    expect(body.max_tokens).toBe(8000);
  });
});
