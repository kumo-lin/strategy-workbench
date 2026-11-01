/**
 * The perspectives a research plan must cover (D-32), from the active team config `90_配置/团队.md`
 * (frontmatter `perspectives`, mirrored in its "必须覆盖的视角" section for people). Another team brings its own
 * list with its own `团队.md`; no code change.
 */
import type { Vault } from '@/lib/vault';

export const TEAM_CONFIG_PATH = '90_配置/团队.md';

/** The active team's perspectives; [] when the config has none (then nothing is checked). */
export async function loadPerspectives(vault: Vault): Promise<string[]> {
  try {
    const n = await vault.read(TEAM_CONFIG_PATH);
    const list = n.data.perspectives;
    return Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))] : [];
  } catch {
    return [];
  }
}
