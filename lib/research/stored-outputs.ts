/** D-64 T42: only confirmed outputs belonging to the selected report. */
import path from 'node:path';
import { decisionsOfReport } from '@/lib/decisions/review';
import type { Vault } from '@/lib/vault';
import { loadFiles, type GroupFile } from '@/lib/workplan/files-view';

export interface StoredOutput extends GroupFile {
  published: boolean;
}

export async function loadStoredOutputs(vault: Vault, workspacePath: string, reportPath: string, base: string): Promise<StoredOutput[]> {
  const { outputs } = await loadFiles(vault, workspacePath, base);
  if (!outputs.some((o) => o.kind === '报告' && o.path === reportPath)) return [];
  const decisions = new Set((await decisionsOfReport(vault, path.posix.dirname(workspacePath), reportPath)).filter((d) => d.status === '已确认').map((d) => d.path));
  const interviews = new Set<string>();
  const seen = new Set<string>();
  const dir = path.posix.dirname(reportPath);
  const project = path.posix.dirname(workspacePath);
  // Later interview follow-ups inherit the interviews used by earlier versions.
  const visit = async (p: string): Promise<void> => {
    if (seen.has(p)) return;
    seen.add(p);
    const n = await vault.read(p);
    const followup = n.data.interview_followup as { interviews?: unknown } | undefined;
    const links = [...(Array.isArray(n.data.derived_from) ? n.data.derived_from : []), ...(Array.isArray(followup?.interviews) ? followup.interviews : [])];
    for (const raw of links) {
      if (typeof raw !== 'string') continue;
      const r = await vault.resolveLink(raw, p);
      if (!r.ok) continue;
      if (r.path.startsWith(`${project}/访谈/`)) interviews.add(r.path);
      else if (path.posix.dirname(r.path) === dir && /^报告 v\d+\.md$/.test(path.posix.basename(r.path))) await visit(r.path);
    }
  };
  await visit(reportPath);
  const selected = outputs.filter((o) => o.kind === '报告' ? o.path === reportPath : o.kind === '决定' ? decisions.has(o.path) : o.kind === '访谈' && interviews.has(o.path));
  return Promise.all(selected.map(async (o) => ({ ...o, published: Boolean((await vault.read(o.path)).data.published_by) })));
}