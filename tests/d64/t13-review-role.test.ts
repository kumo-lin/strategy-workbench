/** D-64 T13: the third citation check (second judge) uses the `review` model role when 模型.md names one (D8). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE, makeFixtureVault } from '../helpers/fixture-vault';
import { secondJudgeModel } from '@/lib/research/citation-verify';

const withReview = FIXTURE['90_配置/模型.md']
  .replace('beta: {', 'deepseek-pro: { label: DeepSeek Pro, base_url: "https://ds.example.com/v1", api_key_env: DS_KEY, model: ds-pro }\n  kimi: { label: Kimi, base_url: "https://kimi.example.com/v1", api_key_env: KIMI_KEY, model: kimi-k2.6 }\n  beta: {')
  .replace('web_tools:', 'roles: { review: deepseek-pro }\nweb_tools:');
const noReview = withReview.replace('roles: { review: deepseek-pro }\n', '');

afterEach(() => vi.unstubAllEnvs());

describe('T13 review role', () => {
  it('roles.review set: the second judge is that provider', async () => {
    vi.stubEnv('MODEL_PROVIDER', '');
    vi.stubEnv('DS_KEY', 'k');
    const { vault, cleanup } = await makeFixtureVault({ '90_配置/模型.md': withReview });
    try {
      expect((await secondJudgeModel(vault, 'alpha')).providerId).toBe('deepseek-pro');
    } finally {
      await cleanup();
    }
  });

  it('no review role: as before (kimi for a run that is not on kimi)', async () => {
    vi.stubEnv('MODEL_PROVIDER', '');
    vi.stubEnv('KIMI_KEY', 'k');
    const { vault, cleanup } = await makeFixtureVault({ '90_配置/模型.md': noReview });
    try {
      expect((await secondJudgeModel(vault, 'alpha')).providerId).toBe('kimi');
    } finally {
      await cleanup();
    }
  });

  it('MODEL_PROVIDER overrides every role, the review role too', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'beta');
    vi.stubEnv('BETA_KEY', 'k');
    const { vault, cleanup } = await makeFixtureVault({ '90_配置/模型.md': withReview });
    try {
      expect((await secondJudgeModel(vault, 'alpha')).providerId).toBe('beta');
    } finally {
      await cleanup();
    }
  });
});
