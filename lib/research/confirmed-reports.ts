/**
 * A project's confirmed reports (D-56 ⑤b): a Senior's conclusion review (`gate: 结论`,
 * `result: 通过`) derived from a report turns that report into the team's asset. Every
 * Workspace of the same project lists it on "文件"; a Workspace of another project never
 * does. No file is copied — the list is computed from the review notes, project-scoped by
 * construction: only folders under the caller's project are walked, and a `derived_from`
 * link that resolves elsewhere is ignored.
 */
import path from 'node:path';
import type { Vault } from '@/lib/vault';
import { listReviews } from '@/lib/workplan/state';

export interface ConfirmedReport {
  /** Vault path of the report, e.g. 20_项目/<项目>/<Workspace>/调查/<调查>/报告 v3.md */
  reportPath: string;
  /** "报告 v3" */
  reportName: string;
  /** The investigation folder name, e.g. "买方采购逻辑（问题树）" */
  investigation: string;
  /** The Workspace folder name it comes from, e.g. "WS-A 买方" */
  workspace: string;
  /** The review note that confirmed it */
  reviewPath: string;
  confirmedBy: string;
  /** ISO time: the review note's `updated` */
  confirmedAt: string;
  /** True when it comes from the Workspace asking (the caller's own) */
  own: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listDir(vault: Vault, dir: string) {
  try {
    return await vault.list(dir);
  } catch {
    return [];
  }
}

export async function confirmedReports(vault: Vault, workspacePath: string): Promise<ConfirmedReport[]> {
  const projectPath = path.posix.dirname(workspacePath);
  const found = new Map<string, ConfirmedReport>();

  for (const entry of await listDir(vault, projectPath)) {
    if (entry.kind !== 'dir' || !(await vault.exists(`${entry.path}/workspace.md`))) continue;
    const reportRe = new RegExp(`^${escapeRe(projectPath)}/${escapeRe(entry.name)}/调查/[^/]+/报告 v\\d+\\.md$`);
    for (const review of await listReviews(vault, entry.path)) {
      if (review.note.gate !== '结论' || review.note.result !== '通过') continue;
      const derived = review.note.derived_from[0];
      if (!derived) continue;
      const resolved = await vault.resolveLink(derived, review.path);
      if (!resolved.ok || !reportRe.test(resolved.path)) continue;

      const existing = found.get(resolved.path);
      if (existing && existing.confirmedAt >= review.note.updated) continue;
      found.set(resolved.path, {
        reportPath: resolved.path,
        reportName: path.posix.basename(resolved.path, '.md'),
        investigation: path.posix.basename(path.posix.dirname(resolved.path)),
        workspace: entry.name,
        reviewPath: review.path,
        confirmedBy: review.note.reviewer,
        confirmedAt: review.note.updated,
        own: entry.path === workspacePath,
      });
    }
  }

  return [...found.values()].sort(
    (a, b) => b.confirmedAt.localeCompare(a.confirmedAt) || a.reportPath.localeCompare(b.reportPath),
  );
}
