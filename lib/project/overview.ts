/**
 * The project page's data (UI/UX 方案 #27/#28): 项目.md read for display only. Nothing here writes, and nothing is
 * built on the spot: the issue tree, roadmap and dependencies are what Senior confirmed in 项目.md (step 0).
 */
import { parseWikiLink, type Vault } from '@/lib/vault';
import { issueTreeSchema, WORKSPACE_STAGES, type IssueTree, type WorkspaceStage } from '@/lib/notes/schema';

export interface OverviewWorkspace {
  /** Folder name, e.g. `WS-A 买方`. */
  name: string;
  /** `20_项目/<项目>/<Workspace>` */
  path: string;
  owner: string;
  reviewer: string;
  stage: string;
  flags: string[];
  week: string;
  /** `assigned_by` of workspace.md (who assigned it); null when the note does not say. Never guessed. */
  assignedBy: string | null;
}

export interface IssueBranch {
  /** 1-based number in the table's first column. */
  no: number;
  title: string;
  asks: string;
  week: string;
  workspaces: OverviewWorkspace[];
}

export interface RoadmapWeek {
  week: string;
  topic: string;
  workspaces: string[];
}

export interface ProjectOverview {
  project: string;
  /** False when the folder has no 项目.md: the page then lists the Workspaces only. */
  hasProjectNote: boolean;
  owner: string;
  sponsor: string;
  confirmed: boolean;
  confirmedAt: string | null;
  derivedFrom: string[];
  coreQuestion: string;
  decision: string | null;
  branches: IssueBranch[];
  roadmap: RoadmapWeek[];
  currentWeek: string | null;
  dependencies: { from: string; to: string; reason: string }[];
  /** Workspaces that sit on no branch of the issue tree (or all of them when 项目.md has no tree). */
  unplaced: OverviewWorkspace[];
  /** The issue tree in the frontmatter (D-64, v6 format); null for a project written with the older table. */
  issueTree: IssueTree | null;
}

/** `W6–W7` and `W6-W7` are the same week range. */
export function normalizeWeek(w: string): string {
  return w.replace(/\s+/g, '').replace(/[–—~～]/g, '-');
}

function stripLinks(text: string): string {
  return text.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target.split('/').pop() ?? target).trim();
}

/** The cells of one markdown table row (`\|` inside a wiki link alias is not a separator). */
export function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

/** The body's `议题树` table → rows of `[枝, 要回答, 周, Workspace, 假设]`. */
export function issueTreeRows(body: string): string[][] {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => /^#{2,3}\s*议题树/.test(l));
  if (at < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,3}\s/.test(line)) break;
    if (!line.trim().startsWith('|')) continue;
    const cells = tableCells(line);
    if (cells.length < 4 || /^:?-+:?$/.test(cells[0]) || cells[0] === '枝') continue;
    rows.push(cells);
  }
  return rows;
}

/** `**支撑的决策**：…` of the body's top-question section. */
export function supportedDecision(body: string): string | null {
  const m = /^\*\*支撑的决策\*\*[：:]\s*(.+)$/m.exec(body);
  return m ? stripLinks(m[1]).replace(/\*\*/g, '') : null;
}

function stageIndex(stage: string): number {
  const i = WORKSPACE_STAGES.indexOf(stage as WorkspaceStage);
  return i < 0 ? WORKSPACE_STAGES.length : i;
}

/**
 * Which roadmap week is "now". 项目.md may say so (`current_week`); otherwise the week of the Workspace that is
 * furthest behind in the flow (ties: the week with more Workspaces), which is the one the team is working on.
 */
export function currentWeekOf(explicit: unknown, workspaces: OverviewWorkspace[], roadmap: RoadmapWeek[]): string | null {
  if (typeof explicit === 'string' && explicit.trim()) return normalizeWeek(explicit);
  const weeks = new Set(roadmap.map((r) => normalizeWeek(r.week)));
  const live = workspaces.filter((w) => w.stage !== '完成' && weeks.has(normalizeWeek(w.week)));
  if (!live.length) return null;
  const lowest = Math.min(...live.map((w) => stageIndex(w.stage)));
  const counts = new Map<string, number>();
  for (const w of live.filter((x) => stageIndex(x.stage) === lowest)) counts.set(normalizeWeek(w.week), (counts.get(normalizeWeek(w.week)) ?? 0) + 1);
  const rank = (week: string) => counts.get(week) ?? 0;
  const candidates = [...counts.keys()];
  return candidates.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

async function workspacesOf(vault: Vault, project: string): Promise<OverviewWorkspace[]> {
  const projectPath = `20_项目/${project}`;
  const dirs = (await vault.list(projectPath)).filter((e) => e.kind === 'dir' && !['会议', '假设', '决策'].includes(e.name));
  const out: OverviewWorkspace[] = [];
  for (const d of dirs) {
    const file = `${d.path}/workspace.md`;
    if (!(await vault.exists(file))) continue;
    const n = (await vault.read(file)).note;
    if (n?.type !== 'workspace') continue;
    out.push({ name: d.name, path: d.path, owner: n.owner, reviewer: n.reviewer, stage: n.stage, flags: n.flags as string[], week: n.week ?? '', assignedBy: nonEmpty((n as { assigned_by?: unknown }).assigned_by) });
  }
  return out;
}

/** Folder path of a wiki link to a Workspace note (`…/WS-A 买方/workspace|WS-A 买方` → `20_项目/…/WS-A 买方`). */
function workspacePathOf(link: string): string | null {
  const parsed = parseWikiLink(link);
  if (!parsed) return null;
  return parsed.target.replace(/\/workspace$/, '');
}

export async function loadProjectOverview(vault: Vault, project: string): Promise<ProjectOverview> {
  const projectPath = `20_项目/${project}`;
  const workspaces = await workspacesOf(vault, project);
  const notePath = `${projectPath}/项目.md`;
  const base: ProjectOverview = {
    project,
    hasProjectNote: false,
    owner: '',
    sponsor: '',
    confirmed: false,
    confirmedAt: null,
    derivedFrom: [],
    coreQuestion: '',
    decision: null,
    branches: [],
    roadmap: [],
    currentWeek: null,
    dependencies: [],
    unplaced: workspaces,
    issueTree: null,
  };
  if (!(await vault.exists(notePath))) return base;
  const raw = await vault.read(notePath);
  const d = raw.data;
  const byPath = new Map(workspaces.map((w) => [w.path, w]));
  const nameOf = (link: unknown): string => {
    if (typeof link !== 'string') return '';
    const parsed = parseWikiLink(link);
    if (!parsed) return String(link);
    const folder = workspacePathOf(link);
    return parsed.alias ?? (folder ? folder.split('/').pop() ?? folder : parsed.target);
  };

  const roadmap: RoadmapWeek[] = (Array.isArray(d.roadmap) ? d.roadmap : []).flatMap((r) => {
    const x = r as { week?: unknown; topic?: unknown; workspaces?: unknown };
    if (typeof x.week !== 'string') return [];
    return [{ week: x.week, topic: String(x.topic ?? ''), workspaces: (Array.isArray(x.workspaces) ? x.workspaces : []).map((l) => workspacePathOf(String(l)) ?? '').filter(Boolean) }];
  });

  const placed = new Set<string>();
  const branches: IssueBranch[] = issueTreeRows(raw.body).map((cells, i) => {
    const m = /^(\d+)\s*(.*)$/.exec(cells[0]);
    const week = normalizeWeek(cells[2]);
    const fromRoadmap = roadmap.filter((r) => normalizeWeek(r.week) === week).flatMap((r) => r.workspaces);
    // a Workspace named in the cell itself (wiki link) counts as well
    const fromCell = [...cells[3].matchAll(/\[\[[^\]]+\]\]/g)].map((l) => workspacePathOf(l[0]) ?? '');
    const paths = [...new Set([...fromRoadmap, ...fromCell].filter(Boolean))];
    const ws = paths.flatMap((p) => byPath.get(p) ?? []);
    for (const w of ws) placed.add(w.path);
    return { no: m ? Number(m[1]) : i + 1, title: m ? m[2] : cells[0], asks: stripLinks(cells[1]), week: cells[2], workspaces: ws };
  });

  const contextWeek = currentWeekOf(d.current_week, workspaces, roadmap);
  return {
    project,
    hasProjectNote: true,
    owner: String(d.owner ?? ''),
    sponsor: String(d.sponsor ?? ''),
    confirmed: d.status === '已确认',
    confirmedAt: typeof d.content_confirmed_at === 'string' ? d.content_confirmed_at : null,
    derivedFrom: (Array.isArray(d.derived_from) ? d.derived_from : []).map((l) => nameOf(l)).filter(Boolean),
    coreQuestion: String(d.core_question ?? ''),
    decision: supportedDecision(raw.body),
    branches,
    roadmap: roadmap.map((r) => ({ ...r, workspaces: r.workspaces.map((p) => byPath.get(p)?.name ?? p.split('/').pop() ?? p) })),
    currentWeek: contextWeek,
    dependencies: (Array.isArray(d.dependencies) ? d.dependencies : []).map((x) => {
      const dep = x as { from?: unknown; to?: unknown; reason?: unknown };
      return { from: nameOf(dep.from), to: nameOf(dep.to), reason: String(dep.reason ?? '') };
    }),
    unplaced: workspaces.filter((w) => !placed.has(w.path)),
    issueTree: issueTreeSchema.safeParse(d.issue_tree).data ?? null,
  };
}

/** Where a Workspace sits in the project (#28): its issue-tree branch, the branch's topic and week, and who assigned it. */
export interface WorkspaceOrigin {
  branchNo: number | null;
  topic: string | null;
  week: string | null;
  assignedBy: string | null;
  /** Other Workspaces on the same branch (they run in parallel with this one). */
  siblings: OverviewWorkspace[];
  /** On an issue tree (v6): its line and item, e.g. 市场如何演进 · M1 哪些用户会持续使用. */
  line: { title: string; item: string } | null;
  /** On an issue tree: the Workspaces whose items wait for this one (the next work lines). */
  dependents: OverviewWorkspace[];
}

export function originOf(overview: ProjectOverview, workspacePath: string): WorkspaceOrigin {
  const branch = overview.branches.find((b) => b.workspaces.some((w) => w.path === workspacePath));
  const all = [...overview.branches.flatMap((b) => b.workspaces), ...overview.unplaced];
  const own = all.find((w) => w.path === workspacePath);
  // 复核 B1: a project written in the v6 format has its tree in the frontmatter, not in the older table
  const folder = workspacePath.split('/').pop();
  const tree = overview.issueTree;
  const line = tree?.lines.find((l) => l.items.some((i) => i.workspace === folder));
  const item = line?.items.find((i) => i.workspace === folder);
  const dependents = item
    ? tree!.lines.flatMap((l) => l.items).flatMap((i) => (i.waits_for.includes(item.id) && i.workspace ? all.filter((w) => w.name === i.workspace) : []))
    : [];
  return {
    branchNo: branch?.no ?? null,
    topic: branch?.title ?? null,
    week: own?.week ?? branch?.week ?? null,
    assignedBy: own?.assignedBy ?? null,
    siblings: branch ? branch.workspaces.filter((w) => w.path !== workspacePath) : [],
    line: line && item ? { title: line.title, item: `${item.id} ${item.title}` } : null,
    dependents,
  };
}
