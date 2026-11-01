import { loadModelsConfig } from '@/lib/config/models';
import { getVault, type Vault } from '@/lib/vault';
import { createWebToolsClient, type WebToolsClient } from './web-tools';

export * from './web-tools';

/** Client configured from 90_配置/模型.md `web_tools`. */
export async function getWebToolsClient(vault: Vault = getVault(), env: NodeJS.ProcessEnv = process.env): Promise<WebToolsClient> {
  // E2E only: fixed pages instead of the network, chosen by env var alone.
  if (env.WEB_TOOLS === 'mock') return (await import('@/lib/testing/mock-web')).createMockWebClient();
  const { web_tools } = await loadModelsConfig(vault);
  const apiKey = env[web_tools.api_key_env];
  if (!apiKey) throw new Error(`${web_tools.api_key_env} is not set; fill it in .env.local`);
  return createWebToolsClient({ baseUrl: web_tools.base_url, apiKey });
}
