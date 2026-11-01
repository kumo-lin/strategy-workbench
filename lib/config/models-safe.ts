/**
 * 接手卡 C2：`90_配置/模型.md` 的安全读入口。
 * 页面在渲染前先问一次「配置现在能不能用」：读不到、写坏、指向不存在的 provider 都只回 ok=false，
 * 不抛异常，也不猜原因——页面据此显示一句中文说明，而不是整页 500。
 */
import type { Vault } from '@/lib/vault';
import { loadModelsConfig, type ModelsConfig } from './models';

export type ModelsConfigRead = { ok: true; config: ModelsConfig } | { ok: false };

export async function readModelsConfigSafe(vault: Vault): Promise<ModelsConfigRead> {
  try {
    return { ok: true, config: await loadModelsConfig(vault) };
  } catch {
    return { ok: false };
  }
}
