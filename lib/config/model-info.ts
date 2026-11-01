/** Which model the current config points at, for display (4.3). Re-read on every call, like getModel(). */
import { loadModelsConfig } from '@/lib/config/models';
import { resolveProviderId } from '@/lib/models/provider';
import type { Vault } from '@/lib/vault';

export interface ModelInfo {
  providerId: string;
  label: string;
  model: string;
}

export async function activeModelInfo(vault: Vault, env: NodeJS.ProcessEnv = process.env): Promise<ModelInfo> {
  const config = await loadModelsConfig(vault);
  const providerId = resolveProviderId(config, env);
  const p = config.providers[providerId];
  return { providerId, label: p.label, model: p.model };
}

export const modelText = (m: Pick<ModelInfo, 'label' | 'model'>) => `${m.label}（${m.model}）`;

/** The model line of a page: the name only (the id is for the config page, 复核 A); a config being saved (read half-written) or left invalid is said, not thrown (T55). */
export const modelLine = (vault: Vault, env: NodeJS.ProcessEnv = process.env): Promise<string> =>
  activeModelInfo(vault, env).then((m) => m.label, () => '模型配置读不出来，请到方法与配置页检查');
