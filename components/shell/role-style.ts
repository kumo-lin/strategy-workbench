/** How a role looks wherever it is named: a colour per role and a short job title (UI/UX 方案 #1). */
import type { Role } from '@/lib/config/roles';

export interface RoleStyle {
  /** The band across the top of the window. */
  band: string;
  /** A small chip with the role's name. */
  chip: string;
  dot: string;
}

const STYLES: Record<string, RoleStyle> = {
  senior: { band: 'bg-violet-600', chip: 'border-violet-500/40 bg-violet-50 text-violet-800 dark:bg-violet-500/10 dark:text-violet-200', dot: 'bg-violet-600' },
  'junior-a': { band: 'bg-sky-600', chip: 'border-sky-500/40 bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-200', dot: 'bg-sky-600' },
  'junior-b': { band: 'bg-emerald-600', chip: 'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200', dot: 'bg-emerald-600' },
};
const FALLBACK: RoleStyle = { band: 'bg-slate-600', chip: 'border-slate-500/40 bg-slate-50 text-slate-800 dark:bg-slate-500/10 dark:text-slate-200', dot: 'bg-slate-600' };

export const roleStyle = (id: string): RoleStyle => STYLES[id] ?? FALLBACK;

/** Colour of the person named in a note (`owner: Junior A`): the role whose name it is. */
export function roleStyleByName(roles: Pick<Role, 'id' | 'name'>[], name: string): RoleStyle {
  const r = roles.find((x) => x.name === name);
  return r ? roleStyle(r.id) : FALLBACK;
}

export const roleJob = (kind: Role['kind']): string => (kind === 'senior' ? '审批者' : '执行者');
