/**
 * Model layer: config → AI SDK LanguageModel. Every provider goes through the
 * OpenAI-compatible Chat Completions API (`.chat()`, not the Responses API,
 * which DeepSeek/OpenRouter don't implement). Switching provider = edit
 * `active` in 90_配置/模型.md, or set MODEL_PROVIDER. No code change.
 * A per-call option (thinking, temperature) exists for one judge; the config is unchanged.
 *
 * CONTRACT (frozen after M0).
 */
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import { loadModelsConfig, type ModelRole, type ModelsConfig, type ProviderConfig } from '@/lib/config/models';
import { getVault, type Vault } from '@/lib/vault';
import { withUsageLog } from './usage-log';

export interface ResolvedModel {
  providerId: string;
  provider: ProviderConfig;
  model: LanguageModel;
}

export class ModelConfigError extends Error {
  name = 'ModelConfigError';
}

export interface CallOptions {
  /** Moonshot: "disabled" puts thinking: {type: 'disabled'} into the request body. */
  thinking?: 'disabled';
  /** Overrides the provider's configured temperature for these calls. */
  temperature?: number;
}

/** `thinking: {type: 'disabled'}` merged into a JSON request body; anything that is not a JSON string passes unchanged. */
export function withThinkingDisabled(body: BodyInit | null | undefined): BodyInit | null | undefined {
  if (typeof body !== 'string') return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return body;
  return JSON.stringify({ ...parsed, thinking: { type: 'disabled' } });
}

export function resolveProviderId(config: ModelsConfig, env: NodeJS.ProcessEnv = process.env, role?: ModelRole): string {
  const override = env.MODEL_PROVIDER?.trim();
  if (override) {
    if (!(override in config.providers)) {
      throw new ModelConfigError(`MODEL_PROVIDER=${override} is not in 90_配置/模型.md providers`);
    }
    return override;
  }
  return (role ? config.roles?.[role] : undefined) ?? config.active;
}

export function createLanguageModel(
  providerId: string,
  provider: ProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  call?: CallOptions,
): LanguageModel {
  const apiKey = env[provider.api_key_env];
  if (!apiKey) {
    throw new ModelConfigError(`${provider.api_key_env} is not set (provider "${providerId}"); fill it in .env.local`);
  }
  const openai = createOpenAI({
    apiKey,
    baseURL: provider.base_url,
    name: providerId,
    ...(call?.thinking === 'disabled'
      ? { fetch: (url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => globalThis.fetch(url, { ...init, body: withThinkingDisabled(init?.body) }) }
      : {}),
  });
  return withMinOutputTokens(withTemperature(openai.chat(provider.model), call?.temperature ?? provider.temperature), provider.max_output_tokens);
}

/**
 * A provider that sets `temperature` in 90_配置/模型.md gets it on every call, whatever the caller passed
 * (D-23: Kimi rejects anything but 1 with "invalid temperature: only 1 is allowed"). Unset: unchanged.
 */
export function withTemperature(model: LanguageModel, temperature: number | undefined): LanguageModel {
  if (temperature === undefined || typeof model === 'string' || model.specificationVersion !== 'v3') return model;
  return wrapLanguageModel({ model, middleware: { specificationVersion: 'v3', transformParams: async ({ params }) => ({ ...params, temperature }) } });
}

/** Raise every call's output token limit to the provider's configured floor. */
export function withMinOutputTokens(model: LanguageModel, floor: number | undefined): LanguageModel {
  if (floor === undefined || typeof model === 'string' || model.specificationVersion !== 'v3') return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({ ...params, maxOutputTokens: Math.max(params.maxOutputTokens ?? 0, floor) }),
    },
  });
}

/** The model for the current config. Re-reads the config each call so edits apply without restart. */
export async function getModel(opts: { vault?: Vault; providerId?: string; env?: NodeJS.ProcessEnv; call?: CallOptions; role?: ModelRole } = {}): Promise<ResolvedModel> {
  const env = opts.env ?? process.env;
  const config = await loadModelsConfig(opts.vault ?? getVault());
  const providerId = opts.providerId ?? resolveProviderId(config, env, opts.role);
  const provider = config.providers[providerId];
  if (!provider) throw new ModelConfigError(`unknown provider "${providerId}"`);
  // E2E only: MODEL_MOCK=1 swaps in a scripted model. The provider, its label and model name still come from the
  // config (and MODEL_PROVIDER), so what the pages show follows `active`; no key is needed. Not loaded otherwise.
  const base = env.MODEL_MOCK === '1' ? (await import('@/lib/testing/mock-model')).createMockModel() : createLanguageModel(providerId, provider, env, opts.call);
  // USAGE_LOG=<file.jsonl>: one line per call (tokens, cache hits, time) for scripts/usage-report.ts
  const usageLog = env.USAGE_LOG?.trim();
  const model = usageLog ? withUsageLog(base, { providerId, model: provider.model }, usageLog) : base;
  return { providerId, provider, model };
}
