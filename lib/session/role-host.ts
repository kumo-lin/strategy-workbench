/**
 * The web address decides the role (UI/UX 方案 #2): `junior-b.localhost:3001` is Junior B's window, `senior.…` is Senior's.
 * A host with no role in front of it (`localhost`, an IP) falls back to the cookie and the switcher. Pure.
 */
export interface RoleLike {
  id: string;
}

/** The role id a host name starts with (`junior-b.localhost:3001` → `junior-b`), or null. */
export function roleIdFromHost(host: string | null | undefined, roles: RoleLike[]): string | null {
  if (!host || host.startsWith('[')) return null;
  const labels = host.split(':')[0].toLowerCase().split('.');
  if (labels.length < 2) return null;
  return roles.some((r) => r.id === labels[0]) ? labels[0] : null;
}

/**
 * The address of the same page in another role's window, or null when this host cannot have one (an IP address):
 * a role-prefixed host swaps the prefix, bare `localhost` gets one.
 */
export function windowUrlFor(url: { protocol: string; hostname: string; port: string; pathname: string; search: string }, targetId: string, roles: RoleLike[]): string | null {
  const labels = url.hostname.toLowerCase().split('.');
  let host: string;
  if (labels.length >= 2 && roles.some((r) => r.id === labels[0])) host = [targetId, ...labels.slice(1)].join('.');
  else if (url.hostname.toLowerCase() === 'localhost') host = `${targetId}.localhost`;
  else return null;
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${url.pathname}${url.search}`;
}
