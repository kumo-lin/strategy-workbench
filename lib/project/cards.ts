/** D-64 T32 (ui-0a): one card per project on the home page; every count is read from the vault. */
import type { Vault } from '@/lib/vault';

export interface ProjectCard {
  project: string;
  /** The decision contract's question, else the project note's core question. */
  question: string;
  workspaces: number;
  /** Report versions in all its investigations. */
  reports: number;
  /** Decisions a person confirmed. */
  decisions: number;
}

const list = (vault: Vault, dir: string) => vault.list(dir).catch(() => []);

export async function loadProjectCards(vault: Vault): Promise<ProjectCard[]> {
  const out: ProjectCard[] = [];
  for (const p of (await list(vault, '20_项目')).filter((e) => e.kind === 'dir')) {
    const contract = await vault.read(`${p.path}/决策契约.md`).catch(() => null);
    const note = await vault.read(`${p.path}/项目.md`).catch(() => null);
    let workspaces = 0;
    let reports = 0;
    for (const w of (await list(vault, p.path)).filter((e) => e.kind === 'dir')) {
      if (!(await vault.exists(`${w.path}/workspace.md`))) continue;
      workspaces += 1;
      for (const r of (await list(vault, `${w.path}/调查`)).filter((e) => e.kind === 'dir')) reports += (await list(vault, r.path)).filter((e) => /^报告 v\d+\.md$/.test(e.name)).length;
    }
    let decisions = 0;
    for (const d of (await list(vault, `${p.path}/决策`)).filter((e) => e.kind === 'file')) {
      const n = await vault.read(d.path).catch(() => null);
      if (n?.data.type === 'decision' && n.data.status === '已确认') decisions += 1;
    }
    out.push({ project: p.name, question: String(contract?.data.question ?? note?.data.core_question ?? ''), workspaces, reports, decisions });
  }
  return out;
}
