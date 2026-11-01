/**
 * D-64 T32 (ui-2b): what waits on a person — a research plan sent for their opinion (G1, never blocks the work) and a
 * report sent for them to confirm (结论). Read from the open reviews whose reviewer is this person.
 */
import type { Role } from '@/lib/config/roles';
import { parseWikiLink, type Vault } from '@/lib/vault';
import { listReviews } from '@/lib/workplan/state';

export interface InboxItem {
  kind: 'opinion' | 'confirm';
  project: string;
  workspace: string;
  workspacePath: string;
  reviewPath: string;
  reviewName: string;
  requester: string;
  created: string;
  /** Where the item opens: the opinion here in the inbox, the report confirmation on the Workspace. */
  href: string;
}

const GATES: Record<string, InboxItem['kind']> = { G1: 'opinion', 结论: 'confirm' };

/** D-64 T41: a report to confirm opens on its research page, at step 6 (提交确认); null when the report is not under 调查/. */
async function confirmStepOf(vault: Vault, link: string | undefined, from: string, base: string): Promise<string | null> {
  const parsed = link ? parseWikiLink(link) : null;
  const resolved = parsed ? await vault.resolveLink(parsed, from) : null;
  const name = resolved?.ok ? /\/调查\/([^/]+)\/[^/]+\.md$/.exec(resolved.path)?.[1] : undefined;
  return name ? `${base}/research/${encodeURIComponent(name)}?step=confirm` : null;
}

export async function loadInbox(vault: Vault, role: Pick<Role, 'name'>): Promise<InboxItem[]> {
  const out: InboxItem[] = [];
  for (const p of (await vault.list('20_项目').catch(() => [])).filter((e) => e.kind === 'dir')) {
    for (const w of (await vault.list(p.path).catch(() => [])).filter((e) => e.kind === 'dir')) {
      if (!(await vault.exists(`${w.path}/workspace.md`))) continue;
      for (const r of await listReviews(vault, w.path)) {
        const kind = GATES[r.note.gate];
        if (!kind || r.note.result !== null || r.note.reviewer !== role.name) continue;
        const base = `/workspace/${encodeURIComponent(p.name)}/${encodeURIComponent(w.name)}`;
        out.push({
          kind,
          project: p.name,
          workspace: w.name,
          workspacePath: w.path,
          reviewPath: r.path,
          reviewName: r.name,
          requester: r.note.requester,
          created: r.note.created,
          href: kind === 'opinion' ? `/inbox?open=${encodeURIComponent(r.path)}` : ((await confirmStepOf(vault, r.note.derived_from[0], r.path, base)) ?? `${base}/review?r=${encodeURIComponent(r.name)}`),
        });
      }
    }
  }
  // plans first: an opinion is quick and does not block anyone
  return out.sort((a, b) => Number(a.kind === 'confirm') - Number(b.kind === 'confirm') || a.created.localeCompare(b.created));
}
