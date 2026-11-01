/**
 * The 文件 tab (C2): what a Workspace has made, what the Senior confirmed for the project, and
 * the company's reference library. Everything here only reads the vault.
 *
 * D-64 T15: the To-Be page shows five groups (ui-3, ui-5): 项目产出, 项目背景, 公司资料, 公开数据源, 公司资产.
 * `own` / `confirmed` / `library` stay for the current page until T37 rebuilds it.
 */
import path from 'node:path';
import { confirmedReports } from '@/lib/research/confirmed-reports';
import type { Vault, VaultNote } from '@/lib/vault';
import { listReviews, listWorkplans } from './state';

export interface FileRef {
  name: string;
  path: string;
  subtitle: string;
  href: string;
  simulated: boolean;
}

/** One row of the five groups. */
export interface GroupFile extends FileRef {
  /** 报告 / 决定 / 访谈 / 契约 / 纪要 / 理由 / the grade label of a source (`B · AI 定级`). */
  kind: string;
  confirmedBy?: string;
  confirmedAt?: string;
  /** 复核 P1: the frame of the task (the contract, the Senior's reasons for changes): always read, not selectable. */
  fixed?: string;
}

export interface WorkspaceFiles {
  /** 项目产出: this project's confirmed reports, decisions and interviews. */
  outputs: GroupFile[];
  /** 项目背景: the decision contract, the meeting minutes, the Senior's reasons for changes. */
  background: GroupFile[];
  /** 公司资料: library sources with origin 预置. */
  company: GroupFile[];
  /** 公开数据源: library sources the AI fetched from the web (origin 网络). */
  public: GroupFile[];
  /** 公司资产: published reports and decisions of every project. */
  assets: GroupFile[];
  /** This Workspace: workplan versions (newest first), then reports (newest first). */
  own: FileRef[];
  /** The project's confirmed reports — every Workspace of the project, this one included. */
  confirmed: (FileRef & { own: boolean })[];
  /** Notes directly in 10_资料库, sorted by name. */
  library: FileRef[];
}

const LIBRARY_DIR = '10_资料库';

async function listDir(vault: Vault, dir: string) {
  try {
    return await vault.list(dir);
  } catch {
    return [];
  }
}

const simulatedNote = (data: Record<string, unknown>): boolean => data.simulated === true || data.publisher === '模拟';

export async function loadFiles(vault: Vault, workspacePath: string, base: string): Promise<WorkspaceFiles> {
  const workplans = (await listWorkplans(vault, workspacePath)).reverse();
  const own: FileRef[] = workplans.map((w) => ({
    name: `workplan v${w.version}`,
    path: w.path,
    subtitle: `${w.note.author} · ${w.note.created}`,
    href: base,
    simulated: false,
  }));

  const reports: Array<{ ref: FileRef; version: number }> = [];
  for (const investigation of await listDir(vault, `${workspacePath}/调查`)) {
    if (investigation.kind !== 'dir') continue;
    for (const entry of await listDir(vault, investigation.path)) {
      const m = /^报告 v(\d+)\.md$/.exec(entry.name);
      if (entry.kind !== 'file' || !m) continue;
      let note: VaultNote;
      try {
        note = await vault.read(entry.path);
      } catch {
        continue;
      }
      if (note.note?.type !== 'report') continue;
      const delivery = typeof note.data.delivery === 'string' ? note.data.delivery : '';
      reports.push({
        version: Number(m[1]),
        ref: {
          name: entry.name.replace(/\.md$/, ''),
          path: entry.path,
          subtitle: `${investigation.name} · ${delivery}`,
          href: `${base}/research/${encodeURIComponent(investigation.name)}?v=${encodeURIComponent(entry.path)}`,
          simulated: false,
        },
      });
    }
  }
  reports.sort((a, b) => b.version - a.version || a.ref.path.localeCompare(b.ref.path));
  own.push(...reports.map((r) => r.ref));

  const confirmed = (await confirmedReports(vault, workspacePath)).map((r) => {
    const [, project, workspaceFolder] = r.reportPath.split('/');
    return {
      name: r.reportName,
      path: r.reportPath,
      subtitle: `${r.investigation} · 来自 ${r.workspace}${r.own ? '（本 Workspace）' : ''} · ${r.confirmedBy} 确认 · ${r.confirmedAt.slice(0, 10)}`,
      href: `/workspace/${encodeURIComponent(project)}/${encodeURIComponent(workspaceFolder)}/research/${encodeURIComponent(r.investigation)}?v=${encodeURIComponent(r.reportPath)}`,
      simulated: false,
      own: r.own,
    };
  });

  const library: FileRef[] = [];
  for (const entry of await listDir(vault, LIBRARY_DIR)) {
    if (entry.kind !== 'file') continue;
    let note: VaultNote;
    try {
      note = await vault.read(entry.path);
    } catch {
      continue;
    }
    const publisher = typeof note.data.publisher === 'string' ? note.data.publisher : '';
    library.push({
      name: path.posix.basename(entry.path, '.md'),
      path: entry.path,
      subtitle: publisher,
      href: `${base}/files?doc=${encodeURIComponent(entry.path)}`,
      simulated: simulatedNote(note.data),
    });
  }
  library.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

  return { own, confirmed, library, ...(await loadGroups(vault, workspacePath, base)) };
}

const day = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nameOf = (p: string) => path.posix.basename(p, '.md');
const docHref = (base: string, p: string) => `${base}/files?doc=${encodeURIComponent(p)}`;

async function readNotes(vault: Vault, dir: string): Promise<VaultNote[]> {
  const out: VaultNote[] = [];
  for (const e of await listDir(vault, dir)) {
    if (e.kind !== 'file') continue;
    try {
      out.push(await vault.read(e.path));
    } catch {
      /* a broken note is skipped */
    }
  }
  return out;
}

/** `20_项目/<项目>/<WS>/调查/<名字>` → the Workspace's issue-tree item (`M1`), else its folder name. */
async function fetchedBy(vault: Vault, fetchedIn: string): Promise<string> {
  const [top, project, folder] = fetchedIn.split('/');
  if (top !== '20_项目' || !project || !folder) return '';
  try {
    const n = await vault.read(`${top}/${project}/${folder}/workspace.md`);
    return str(n.data.item) || folder;
  } catch {
    return folder;
  }
}

/** The five groups of D-64 T15. */
async function loadGroups(vault: Vault, workspacePath: string, base: string): Promise<Pick<WorkspaceFiles, 'outputs' | 'background' | 'company' | 'public' | 'assets'>> {
  const projectPath = path.posix.dirname(workspacePath);
  const itemOf = async (wsFolder: string) => {
    try {
      return str((await vault.read(`${projectPath}/${wsFolder}/workspace.md`)).data.item) || wsFolder;
    } catch {
      return wsFolder;
    }
  };

  const outputs: GroupFile[] = [];
  for (const r of await confirmedReports(vault, workspacePath)) {
    const at = r.confirmedAt.slice(0, 10);
    const [, project, wsFolder] = r.reportPath.split('/');
    outputs.push({
      name: `${await itemOf(r.workspace)} ${r.reportName}`,
      path: r.reportPath,
      subtitle: `来自 ${await itemOf(r.workspace)} · ${r.confirmedBy} 确认 ${at}`,
      href: `/workspace/${encodeURIComponent(project)}/${encodeURIComponent(wsFolder)}/research/${encodeURIComponent(r.investigation)}?v=${encodeURIComponent(r.reportPath)}`,
      simulated: false,
      kind: '报告',
      confirmedBy: r.confirmedBy,
      confirmedAt: at,
    });
  }
  for (const n of await readNotes(vault, `${projectPath}/决策`)) {
    if (n.note?.type !== 'decision' || n.note.status !== '已确认') continue;
    const by = str(n.note.decided_by);
    const at = day(n.note.updated);
    outputs.push({ name: `决定 · ${n.title}`, path: n.path, subtitle: `${by} 确认 ${at}`, href: docHref(base, n.path), simulated: false, kind: '决定', confirmedBy: by, confirmedAt: at });
  }
  for (const n of await readNotes(vault, `${projectPath}/访谈`)) {
    if (n.note?.type !== 'meeting' || n.note.kind !== '访谈' || n.note.status !== '已确认') continue;
    const at = day(n.note.date);
    outputs.push({ name: `访谈 · ${n.title}`, path: n.path, subtitle: `${n.note.author} · ${at}`, href: docHref(base, n.path), simulated: n.note.simulated, kind: '访谈', confirmedBy: n.note.author, confirmedAt: at });
  }

  const background: GroupFile[] = [];
  const contractPath = `${projectPath}/决策契约.md`;
  if (await vault.exists(contractPath)) {
    const n = await vault.read(contractPath);
    const by = str(n.data.approved_by);
    background.push({
      name: `决策契约 · ${nameOf(projectPath)}`,
      path: contractPath,
      subtitle: by ? `${by} 确认 ${day(n.data.approved_at)}` : 'AI 起草 · 待 Senior 确认',
      href: docHref(base, contractPath),
      simulated: false,
      kind: '契约',
      fixed: '决策契约是这次研究的前提，AI 始终读取',
    });
  }
  for (const n of await readNotes(vault, `${projectPath}/会议`)) {
    if (n.note?.type !== 'meeting' || n.note.kind === '访谈') continue;
    background.push({ name: n.title, path: n.path, subtitle: '当方向用，不当证据用', href: docHref(base, n.path), simulated: n.note.simulated, kind: '纪要' });
  }
  // 修改理由: what the Senior asked to change, from the comments of the project's review notes
  for (const e of await listDir(vault, projectPath)) {
    if (e.kind !== 'dir' || !(await vault.exists(`${e.path}/workspace.md`))) continue;
    for (const review of await listReviews(vault, e.path)) {
      for (const c of review.comments) {
        background.push({
          name: `修改理由：${c.text}`,
          path: `${review.path}#^${c.id}`,
          subtitle: `${review.note.reviewer} · ${day(review.note.updated)}`,
          href: docHref(base, review.path),
          simulated: false,
          kind: '理由',
          fixed: 'Senior 的意见随研究计划一起读取，不能单独取消',
        });
      }
    }
  }

  const company: GroupFile[] = [];
  const pub: GroupFile[] = [];
  for (const n of await readNotes(vault, LIBRARY_DIR)) {
    if (n.note?.type !== 'source') continue;
    const s = n.note;
    const ref = { name: n.title, path: n.path, href: docHref(base, n.path), simulated: simulatedNote(n.data) };
    if (s.origin === '预置') company.push({ ...ref, subtitle: s.publisher, kind: `${s.grade}${s.graded_by === '人' ? '' : ' · AI 定级'}` });
    else {
      const by = s.fetched_in ? await fetchedBy(vault, s.fetched_in) : '';
      pub.push({ ...ref, subtitle: by ? `${by} 调查时获取` : s.publisher, kind: `${s.grade} · ${s.graded_by === '人' ? '人工定级' : 'AI 定级'}` });
    }
  }
  const byName = (a: GroupFile, b: GroupFile) => a.name.localeCompare(b.name, 'zh-Hans-CN');
  company.sort(byName);
  pub.sort(byName);

  const assets: GroupFile[] = [];
  for (const project of await listDir(vault, '20_项目')) {
    if (project.kind !== 'dir') continue;
    const hits = await vault.search({ dir: project.path, types: ['report', 'decision'], limit: 500 });
    for (const h of hits) {
      const by = str(h.data.published_by);
      if (!by) continue;
      const kind = h.data.type === 'report' ? '报告' : '决定';
      assets.push({ name: h.title, path: h.path, subtitle: `${project.name} · ${by} 发布 ${day(h.data.published_at)}`, href: docHref(base, h.path), simulated: false, kind });
    }
  }
  assets.sort((a, b) => a.path.localeCompare(b.path));

  return { outputs, background, company, public: pub, assets };
}
