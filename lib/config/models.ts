/**
 * `90_配置/模型.md` — provider configuration (PRD §10.2 模型抽象, §10.4).
 * Keys are never stored in the vault: each provider names its env var.
 */
import { z } from 'zod';
import type { Vault } from '@/lib/vault';

export const MODELS_CONFIG_PATH = '90_配置/模型.md';

/** What the structured calls (llmJson, the plain-mode run) ask for when the provider sets no temperature. */
export const DEFAULT_TEMPERATURE = 0.2;

export const providerConfigSchema = z.object({
  label: z.string().min(1),
  /** OpenAI-compatible base URL (Chat Completions lives at `${base_url}/chat/completions`). */
  base_url: z.url(),
  /** Name of the env var holding the API key. */
  api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  model: z.string().min(1),
  /** Sampling temperature this provider requires or prefers (Kimi accepts only 1). Unset: each call's default (0.2). */
  temperature: z.number().min(0).max(2).optional(),
  /** Floor for the output token limit of every call to this provider (reasoning models spend part of it on thinking). */
  max_output_tokens: z.number().int().min(1).max(200000).optional(),
});

/** `review` (D63): the independent check, on another vendor's model (citation verify, third pass). */
export const MODEL_ROLES = ['judgment', 'execution', 'review'] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const modelsConfigSchema = z
  .object({
    active: z.string().min(1),
    providers: z.record(z.string(), providerConfigSchema),
    roles: z
      .object({ judgment: z.string().min(1).optional(), execution: z.string().min(1).optional(), review: z.string().min(1).optional() })
      .optional(),
    web_tools: z.object({ base_url: z.url(), api_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }),
  })
  .refine((c) => c.active in c.providers, { message: 'active must name one of providers', path: ['active'] })
  .superRefine((c, ctx) => {
    for (const role of MODEL_ROLES) {
      const providerId = c.roles?.[role];
      if (providerId && !(providerId in c.providers)) {
        ctx.addIssue({ code: 'custom', message: `roles.${role} must name one of providers`, path: ['roles', role] });
      }
    }
  });
export type ModelsConfig = z.infer<typeof modelsConfigSchema>;

export async function loadModelsConfig(vault: Vault): Promise<ModelsConfig> {
  const note = await vault.read(MODELS_CONFIG_PATH);
  return modelsConfigSchema.parse(note.data);
}
