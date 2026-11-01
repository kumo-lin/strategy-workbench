/** Historical reports use only their declared, version-local plan. No latest-plan fallback. */
import path from 'node:path';
import type { ResearchPlanNote } from '@/lib/notes/schema';
import { parseWikiLink, type Vault, type VaultNote } from '@/lib/vault';
import { hypothesisLabel } from './question-tree';

export function reportPlanPath(dir: string, link: unknown): string | null {
  const p = typeof link === 'string' ? parseWikiLink(link) : null;
  if (!p || p.block || p.heading) return null;
  const target = p.target.replace(/\.md$/, '');
  if (/^计划 v[1-9]\d*$/.test(target)) return `${dir}/${target}.md`;
  return target.startsWith(`${dir}/`) && /^计划 v[1-9]\d*$/.test(target.slice(dir.length + 1)) ? `${target}.md` : null;
}

export function reportClaimsMatch(plan: ResearchPlanNote, claims: { claimId: string; label: string }[]): boolean {
  return claims.length > 0 && new Set(plan.claims.map((c) => c.id)).size === plan.claims.length
    && new Set(claims.map((c) => c.claimId)).size === claims.length
    && new Set(claims.map((c) => c.label)).size === claims.length
    && claims.every((c) => plan.claims.some((p) => p.id === c.claimId) && hypothesisLabel(plan, c.claimId) === c.label);
}

export async function loadReportPlan(vault: Vault, report: Pick<VaultNote, 'path' | 'data'>, claims?: { claimId: string; label: string }[]): Promise<{ path: string; plan: ResearchPlanNote }> {
  const planPath = reportPlanPath(path.posix.dirname(report.path), report.data.research_plan);
  if (!planPath) throw new Error('报告没有有效的同目录计划引用，不能追加分析');
  const note = await vault.readTyped(planPath, 'research_plan').catch(() => null);
  if (!note || (claims && !reportClaimsMatch(note.note, claims))) throw new Error('报告绑定的计划不存在、格式有误或判断对应关系不一致，不能追加分析');
  return { path: planPath, plan: note.note };
}
