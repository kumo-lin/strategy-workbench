/**
 * `90_配置/角色.md` — the roles a viewer can switch between (PRD §4, §5.3).
 * Role names are what notes store in author / owner / reviewer.
 */
import { z } from 'zod';
import type { Vault } from '@/lib/vault';

export const ROLES_CONFIG_PATH = '90_配置/角色.md';

export const roleSchema = z.object({
  /** Cookie value, e.g. `junior-a`. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Display + note name, e.g. `Junior A`. */
  name: z.string().min(1),
  kind: z.enum(['senior', 'junior']),
});
export type Role = z.infer<typeof roleSchema>;

export const rolesConfigSchema = z.object({ roles: z.array(roleSchema).min(1) });

export async function loadRoles(vault: Vault): Promise<Role[]> {
  return rolesConfigSchema.parse((await vault.read(ROLES_CONFIG_PATH)).data).roles;
}

export const ROLE_COOKIE = 'sw-role';
