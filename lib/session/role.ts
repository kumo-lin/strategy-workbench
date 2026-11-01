/**
 * Current viewer role (PRD §5.3 角色切换): a cookie, not real auth (§3.3).
 * Server-only (uses next/headers).
 */
import { cookies, headers } from 'next/headers';
import { loadRoles, ROLE_COOKIE, type Role } from '@/lib/config/roles';
import { getVault } from '@/lib/vault';
import { roleIdFromHost } from './role-host';

export async function getRoles(): Promise<Role[]> {
  return loadRoles(getVault());
}

/** The role this window is fixed to by its web address (`junior-b.localhost`), or null on a host that does not name one. */
export async function getWindowRoleId(): Promise<string | null> {
  return roleIdFromHost((await headers()).get('host'), await getRoles());
}

/** The role of the web address if it names one, else the role in the cookie, else the first configured role. */
export async function getCurrentRole(): Promise<Role> {
  const roles = await getRoles();
  const fixed = roleIdFromHost((await headers()).get('host'), roles);
  const id = fixed ?? (await cookies()).get(ROLE_COOKIE)?.value;
  return roles.find((r) => r.id === id) ?? roles[0];
}

/** A page title that starts with this window's role ("[Junior B] WS-B 用户 · 战略协作工作台"), so three windows can be told apart in the tab strip. */
export async function roleTitle(part: string): Promise<{ absolute: string }> {
  return { absolute: `[${(await getCurrentRole()).name}] ${part} · AI 协作战略工作台` };
}
