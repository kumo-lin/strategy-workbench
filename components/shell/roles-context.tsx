'use client';

import { createContext, useContext, type JSX, type ReactNode } from 'react';
import type { Role } from '@/lib/config/roles';

const RolesContext = createContext<Role[]>([]);

/** The configured roles, for client components that name another role's window (WindowLink). */
export function RolesProvider({ roles, children }: { roles: Role[]; children: ReactNode }): JSX.Element {
  return <RolesContext.Provider value={roles}>{children}</RolesContext.Provider>;
}

export const useRoles = (): Role[] => useContext(RolesContext);
