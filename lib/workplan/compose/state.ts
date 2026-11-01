/**
 * The state of the decomposition pipeline, stored in the Workspace as machine data (like the chat log and the
 * evidence record): `<workspacePath>/拆题/状态.json`, and for every workplan version the tree it was rendered from,
 * `<workspacePath>/拆题/workplan v<N>.树.json`. The vault lists `.md` only, so neither file is ever read as a note.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Vault } from '@/lib/vault';
import { composeStateSchema, newState, packItemSchema, treeSchema, type ComposeState, type PackItem, type Tree } from './types';
import { z } from 'zod';

export const COMPOSE_DIR = '拆题';

function absolute(vault: Vault, rel: string): string {
  const root = path.resolve(vault.root);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error(`path escapes the vault: ${rel}`);
  return full;
}

function checkedWorkspace(workspacePath: string): string {
  if (workspacePath.startsWith('/') || workspacePath.includes('..')) throw new Error(`invalid workspace path: ${workspacePath}`);
  return workspacePath;
}

export const statePath = (workspacePath: string): string => path.posix.join(checkedWorkspace(workspacePath), COMPOSE_DIR, '状态.json');
export const treeSidecarPath = (workspacePath: string, version: number): string =>
  path.posix.join(checkedWorkspace(workspacePath), COMPOSE_DIR, `workplan v${version}.树.json`);

async function writeJson(vault: Vault, rel: string, value: unknown): Promise<void> {
  const full = absolute(vault, rel);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
  await rename(tmp, full);
}

/** The saved state, or a fresh one when there is none (or it cannot be read: a fresh start is safer than a crash). */
export async function readState(vault: Vault, workspacePath: string): Promise<ComposeState> {
  try {
    const parsed = composeStateSchema.safeParse(JSON.parse(await readFile(absolute(vault, statePath(workspacePath)), 'utf8')));
    return parsed.success ? parsed.data : newState();
  } catch {
    return newState();
  }
}

export async function writeState(vault: Vault, workspacePath: string, state: ComposeState, now: Date = new Date()): Promise<ComposeState> {
  const next = composeStateSchema.parse({ ...state, updated: now.toISOString() });
  await writeJson(vault, statePath(workspacePath), next);
  return next;
}

/** Read-modify-write in one place so a tool cannot forget the timestamp. */
export async function updateState(
  vault: Vault,
  workspacePath: string,
  change: (s: ComposeState) => ComposeState,
  now: Date = new Date(),
): Promise<ComposeState> {
  return writeState(vault, workspacePath, change(await readState(vault, workspacePath)), now);
}

/** What a version's tree sidecar holds: the tree and the pack items it cites (titles survive a later pack change). */
export const treeSidecarSchema = z.object({
  version: z.number().int().min(1),
  tree: treeSchema,
  pack: z.array(packItemSchema),
  /** sha256 of the workplan note's body as written: a reader uses the tree only while the note still has this body. */
  body_sha: z.string().default(''),
});
export type TreeSidecar = z.infer<typeof treeSidecarSchema>;

export async function writeTreeSidecar(vault: Vault, workspacePath: string, version: number, tree: Tree, pack: PackItem[], bodySha = ''): Promise<void> {
  await writeJson(vault, treeSidecarPath(workspacePath, version), treeSidecarSchema.parse({ version, tree, pack, body_sha: bodySha }));
}

export async function readTreeSidecar(vault: Vault, workspacePath: string, version: number): Promise<TreeSidecar | null> {
  try {
    const parsed = treeSidecarSchema.safeParse(JSON.parse(await readFile(absolute(vault, treeSidecarPath(workspacePath, version)), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A redo starts the conversation about the frame again: the answers, marks, axis and tree go; the topic and the pack stay. */
export function resetForRedo(s: ComposeState): ComposeState {
  return { ...newState(), topic: s.topic, pack: s.pack };
}
