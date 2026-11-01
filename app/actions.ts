'use server';

import { cookies } from 'next/headers';
import { ROLE_COOKIE } from '@/lib/config/roles';
import { getRoles, getWindowRoleId } from '@/lib/session/role';

export async function setRole(id: string): Promise<void> {
  const roles = await getRoles();
  if (!roles.some((r) => r.id === id)) throw new Error(`unknown role ${id}`);
  // a window fixed by its web address cannot change role: the address decides
  if (await getWindowRoleId()) throw new Error('这个窗口的角色由网址决定，要换角色请用对应网址的窗口');
  (await cookies()).set(ROLE_COOKIE, id, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
}
