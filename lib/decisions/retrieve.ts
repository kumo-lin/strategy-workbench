/**
 * Follow `relates_to` to the CONFIRMED decisions that bind a piece of research (PRD §6.9,
 * dev plan 3.3). A decision is found when the notes it relates to (or says it affects)
 * include the project, this Workspace, a Workspace this one depends on, or one of this
 * Workspace's hypotheses. Only status 已确认 counts: that status can only be set by a
 * Senior's `decision.confirm`, so an AI draft (推断) is never offered as a constraint.
 */
import type { WorkspaceNote } from '@/lib/notes/schema';
import { parseWikiLink, type Vault } from '@/lib/vault';

export interface RelatedDecision {
  path: string;
  name: string;
  decidedBy: string | null;
  /** Why it was found, one line per matching link, closest first. */
  via: string[];
  /** The decision text (body from "## 决定" to the next heading), for the prompt context. */
  decision: string;
  /** 0 = this Workspace or its hypotheses; 1 = an upstream Workspace; 2 = the project only. */
  rank: 0 | 1 | 2;
}

export interface RetrieveInput {
  vault: Vault;
  projectPath: string;
  workspacePath: string;
  workspace: Pick<WorkspaceNote, 'depends_on'>;
}

interface Anchor {
  label: string;
  rank: 0 | 1 | 2;
}

const baseName = (p: string) => p.replace(/\.md$/, '').split('/').pop() ?? p;

async function resolvePaths(vault: Vault, links: unknown, from: string): Promise<string[]> {
  const out: string[] = [];
  for (const raw of Array.isArray(links) ? links : []) {
    if (typeof raw !== 'string' || !parseWikiLink(raw)) continue;
    const r = await vault.resolveLink(raw, from);
    if (r.ok) out.push(r.path);
  }
  return out;
}

async function anchorsOf(input: RetrieveInput): Promise<Map<string, Anchor>> {
  const { vault, projectPath, workspacePath, workspace } = input;
  const anchors = new Map<string, Anchor>();
  const add = (path: string, a: Anchor) => {
    const prev = anchors.get(path);
    if (!prev || a.rank < prev.rank) anchors.set(path, a);
  };
  add(`${projectPath}/项目.md`, { label: '项目', rank: 2 });
  add(`${workspacePath}/workspace.md`, { label: `本 Workspace「${baseName(workspacePath)}」`, rank: 0 });
  for (const p of await resolvePaths(vault, workspace.depends_on, `${workspacePath}/workspace.md`)) {
    add(p, { label: `上游 Workspace「${baseName(p.replace(/\/workspace\.md$/, ''))}」`, rank: 1 });
  }
  try {
    for (const e of await vault.list(`${projectPath}/假设`)) {
      if (e.kind !== 'file') continue;
      const n = await vault.read(e.path);
      if (n.data.type !== 'hypothesis') continue;
      const [ws] = await resolvePaths(vault, [n.data.workspace], e.path);
      if (ws === `${workspacePath}/workspace.md`) add(e.path, { label: `本 Workspace 的假设「${baseName(e.path)}」`, rank: 0 });
    }
  } catch {
    /* no hypotheses folder */
  }
  return anchors;
}

function decisionText(body: string): string {
  const m = /^##\s*决定\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(body);
  return (m ? m[1] : body).trim();
}

export async function findRelatedDecisions(input: RetrieveInput, opts: { limit?: number } = {}): Promise<RelatedDecision[]> {
  const { vault, projectPath } = input;
  let entries;
  try {
    entries = await vault.list(`${projectPath}/决策`);
  } catch {
    return [];
  }
  const anchors = await anchorsOf(input);
  const found: RelatedDecision[] = [];
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    const n = await vault.read(e.path);
    if (n.data.type !== 'decision' || n.data.status !== '已确认') continue;
    const hits: { rank: 0 | 1 | 2; line: string }[] = [];
    for (const field of ['relates_to', 'affects'] as const) {
      for (const target of await resolvePaths(vault, n.data[field], e.path)) {
        const a = anchors.get(target);
        if (a) hits.push({ rank: a.rank, line: `${field} → ${a.label}` });
      }
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a.rank - b.rank);
    found.push({
      path: e.path,
      name: baseName(e.path),
      decidedBy: typeof n.data.decided_by === 'string' ? n.data.decided_by : null,
      via: [...new Set(hits.map((h) => h.line))],
      decision: decisionText(n.body),
      rank: hits[0].rank,
    });
  }
  found.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return found.slice(0, opts.limit ?? 8);
}
