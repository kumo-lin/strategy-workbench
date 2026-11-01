import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getModel, ModelConfigError } from '@/lib/models/provider';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from './helpers/fixture-vault';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

const env = { ALPHA_KEY: 'a', BETA_KEY: 'b' } as unknown as NodeJS.ProcessEnv;

describe('model layer', () => {
  it('uses the active provider from 90_配置/模型.md', async () => {
    const r = await getModel({ vault, env });
    expect(r.providerId).toBe('alpha');
    expect(r.model).toMatchObject({ modelId: 'alpha-1', provider: 'alpha.chat' });
  });

  it('switches provider by editing the config only', async () => {
    const n = await vault.read('90_配置/模型.md');
    await vault.write('90_配置/模型.md', { frontmatter: { ...n.data, active: 'beta' }, body: n.body }, { overwrite: true });
    const r = await getModel({ vault, env });
    expect(r.model).toMatchObject({ modelId: 'beta-1', provider: 'beta.chat' });
  });

  it('MODEL_PROVIDER overrides the config', async () => {
    const r = await getModel({ vault, env: { ...env, MODEL_PROVIDER: 'beta' } });
    expect(r.providerId).toBe('beta');
    await expect(getModel({ vault, env: { ...env, MODEL_PROVIDER: 'nope' } })).rejects.toBeInstanceOf(ModelConfigError);
  });

  it('names the missing env var instead of failing at call time', async () => {
    await expect(getModel({ vault, env: {} as NodeJS.ProcessEnv })).rejects.toThrow(/ALPHA_KEY is not set/);
  });
});
