/** Research folders: `<Workspace>/调查/<调查名>/` (CONTRACTS §5.3). Paths come from the client, so they are checked here. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Vault } from '@/lib/vault';

export class BadResearchPath extends Error {
  name = 'BadResearchPath';
}

const SEGMENT = /^[^\\/:*?"<>|[\]#^\r\n]+$/;

/** `20_项目/<项目>/<Workspace>` — exactly three segments, no traversal. */
export function assertWorkspacePath(p: string): string {
  const parts = p.split('/');
  if (parts.length !== 3 || parts[0] !== '20_项目' || parts.some((s) => !s || s === '.' || s === '..' || !SEGMENT.test(s))) {
    throw new BadResearchPath(`not a workspace path: ${p}`);
  }
  return p;
}

/** The Workspace's display name: its folder name (`WS-A 买方`), not the note id (`ws-a`). */
export function workspaceNameOf(workspacePath: string): string {
  return workspacePath.split('/').pop() ?? workspacePath;
}

/** `<workspace>/调查/<调查名>` */
export function assertResearchDir(workspacePath: string, dir: string): string {
  assertWorkspacePath(workspacePath);
  const parts = dir.split('/');
  if (!dir.startsWith(`${workspacePath}/调查/`) || parts.length !== 5 || !SEGMENT.test(parts[4]) || parts[4] === '..' || parts[4] === '.') {
    throw new BadResearchPath(`not a research folder of ${workspacePath}: ${dir}`);
  }
  return dir;
}

/** Turn what the user typed into a folder name; unique within 调查/. */
export async function createResearchDir(vault: Vault, workspacePath: string, rawName: string): Promise<string> {
  assertWorkspacePath(workspacePath);
  const base = rawName.replace(/[\\/:*?"<>|[\]#^\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (!base) throw new BadResearchPath('调查名不能为空');
  let existing = new Set<string>();
  try {
    existing = new Set((await vault.list(`${workspacePath}/调查`)).map((e) => e.name));
  } catch {
    /* no folder yet */
  }
  let name = base;
  for (let n = 2; existing.has(name); n++) name = `${base} ${n}`;
  const dir = `${workspacePath}/调查/${name}`;
  await mkdir(path.join(vault.root, dir), { recursive: true });
  // Hidden placeholder: vault.list ignores dot files, but git needs something to keep the folder.
  await writeFile(path.join(vault.root, dir, '.gitkeep'), '');
  return dir;
}

/** Latest `<prefix> vN.md` in a research folder. */
export async function latestVersion(vault: Vault, dir: string, prefix: '计划' | '报告'): Promise<{ n: number; path: string } | null> {
  let best: { n: number; path: string } | null = null;
  try {
    for (const e of await vault.list(dir)) {
      const m = new RegExp(`^${prefix} v(\\d+)\\.md$`).exec(e.name);
      if (e.kind === 'file' && m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), path: e.path };
    }
  } catch {
    return null;
  }
  return best;
}
