/**
 * 接手卡 C2：配置页不该因为一份读不到的配置整页报错。
 * 这条测试只钉安全入口：读不到、写坏、指向不存在的 provider 都回 ok=false，不抛。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readModelsConfigSafe } from '@/lib/config/models-safe';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from '../helpers/fixture-vault';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function vaultWith(models: string): Promise<Vault> {
  const made = await makeFixtureVault({ '90_配置/模型.md': models });
  cleanup = made.cleanup;
  return made.vault;
}

const header = `---
id: config-models
type: config
status: 已确认
created: "2026-10-24"
updated: "2026-10-24"
author: Senior
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
`;

const providers = `providers:
  alpha: { label: Alpha, base_url: "https://alpha.example.com/v1", api_key_env: ALPHA_KEY, model: alpha-1 }
  beta: { label: Beta, base_url: "https://beta.example.com/v1", api_key_env: BETA_KEY, model: beta-1 }
`;

const note = (body: string) => `${header}${body}web_tools: { base_url: "https://alpha.example.com", api_key_env: ALPHA_KEY }
---

# 模型
`;

const valid = note(`active: alpha
${providers}roles:
  judgment: alpha
  execution: beta
  review: alpha
`);

describe('readModelsConfigSafe', () => {
  it('正常配置：给出解析后的配置', async () => {
    const got = await readModelsConfigSafe(await vaultWith(valid));
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.config.active).toBe('alpha');
      expect(got.config.providers.beta.model).toBe('beta-1');
    }
  });

  it('文件是空的：回 ok=false，不抛', async () => {
    const got = await readModelsConfigSafe(await vaultWith(''));
    expect(got).toEqual({ ok: false });
  });

  it('YAML 写坏（正在保存）：回 ok=false，不抛', async () => {
    const got = await readModelsConfigSafe(await vaultWith('---\nactive: [没有闭合\n---\n# 模型\n'));
    expect(got).toEqual({ ok: false });
  });

  it('active 指向不存在的 provider：回 ok=false', async () => {
    const got = await readModelsConfigSafe(
      await vaultWith(note(`active: zeta
${providers}roles:
  judgment: alpha
  execution: beta
  review: alpha
`)),
    );
    expect(got).toEqual({ ok: false });
  });

  it('roles 指向不存在的 provider：回 ok=false', async () => {
    const got = await readModelsConfigSafe(
      await vaultWith(note(`active: alpha
${providers}roles:
  judgment: alpha
  execution: beta
  review: ghost
`)),
    );
    expect(got).toEqual({ ok: false });
  });
});
