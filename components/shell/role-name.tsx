import type { JSX } from 'react';
import type { Role } from '@/lib/config/roles';
import { cn } from '@/lib/utils';
import { roleStyleByName } from './role-style';

/** A person's name in the colour of their role (the project page and the Workspace header). */
export function RoleName({ roles, name, className }: { roles: Pick<Role, 'id' | 'name'>[]; name: string; className?: string }): JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0 text-xs font-medium', roleStyleByName(roles, name).chip, className)}>
      {name}
    </span>
  );
}
