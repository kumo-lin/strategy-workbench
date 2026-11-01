/**
 * The project list for the Senior home page: every folder directly under 20_项目, in name order.
 */
import { loadProjectOverview, type ProjectOverview } from '@/lib/project/overview';
import { VaultError, type Vault } from '@/lib/vault';

export async function listProjects(vault: Vault): Promise<ProjectOverview[]> {
  let entries;
  try {
    entries = await vault.list('20_项目');
  } catch (e) {
    if (e instanceof VaultError && e.code === 'not_found') return [];
    throw e;
  }
  const names = entries
    .filter((e) => e.kind === 'dir')
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return Promise.all(names.map((name) => loadProjectOverview(vault, name)));
}
