'use client';

import { ExternalLink } from 'lucide-react';
import { useSyncExternalStore, type JSX } from 'react';
import { windowUrlFor } from '@/lib/session/role-host';
import { useRoles } from './roles-context';

const noopSubscribe = () => () => undefined;

/**
 * "在 Junior A 的窗口打开这一页 ↗": the same page on that role's web address. Where the host cannot name a role (an IP
 * address) it says what to do in words instead. Decided after hydration, from the address bar.
 */
export function WindowLink({ roleName }: { roleName: string }): JSX.Element {
  const roles = useRoles();
  const target = roles.find((r) => r.name === roleName);
  const href = useSyncExternalStore(
    noopSubscribe,
    () => (target ? windowUrlFor(window.location, target.id, roles) : null),
    () => null,
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5 underline underline-offset-2" data-testid="window-link">
      在 {roleName} 的窗口打开这一页 <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  ) : (
    <span>切换到 {roleName} 的窗口，打开这一页。</span>
  );
}
