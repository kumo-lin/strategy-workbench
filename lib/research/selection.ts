/**
 * `资料选择.json` (D63 §2): what the AI reads in a Workspace. Unchecked notes are not read, starred ones come first,
 * and `web: false` turns the web tools off. It lives in the Workspace folder; the vault lists `.md` only, so it is
 * never read or validated as a note.
 *
 * One place applies it: `selectionView` wraps the vault that `buildToolContext` hands to every tool and to the
 * research run, so the research catalog, the internal search, vault_search / vault_list and the workplan pack all
 * see the same filtered library. Direct reads and citation checks use the same note-level boundary.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import { VaultError, type CitationCheck, type Vault, type VaultEntry, type VaultTreeNode } from '@/lib/vault';
import { absoluteInVault } from './evidence-record';

export const SELECTION_FILE = '资料选择.json';

/**
 * One entry of the selection: a whole note. `x.md#^block` and `x.md?v=2` are refused here, not stored and then
 * ignored — block-level filtering does not exist yet (see `selectionView`), so accepting a path the view can
 * never match would make an exclusion look applied while the AI still reads the whole note.
 */
export const selectionEntryPath = z
  .string()
  .min(1)
  .max(500)
  .refine((p) => !p.split('/').includes('..'), 'invalid path')
  .refine((p) => !p.includes('#') && !p.includes('?') && !p.endsWith('/'), '只能选整份资料，不能按块（#）或按参数（?）排除');

export const selectionSchema = z.object({
  version: z.literal(1),
  /** Vault paths the AI does not read. */
  excluded: z.array(selectionEntryPath),
  /** Vault paths read first. */
  starred: z.array(selectionEntryPath),
  web: z.boolean(),
});
export type Selection = z.infer<typeof selectionSchema>;

export const DEFAULT_SELECTION: Selection = { version: 1, excluded: [], starred: [], web: true };

export const selectionPath = (workspacePath: string) => `${workspacePath}/${SELECTION_FILE}`;

/** The file's shape, before entry validation: people hand-edit this file, so one bad entry must not disable the rest. */
const selectionShape = z.object({
  excluded: z.array(z.string()),
  starred: z.array(z.string()),
  web: z.boolean(),
});

const wholeNotes = (entries: string[]): string[] => [...new Set(entries.filter((p) => selectionEntryPath.safeParse(p).success))];

/**
 * The Workspace's selection; the default when the file is absent or its shape is broken (web defaults to true).
 * A single hand-edited bad entry (`x.md#^block`) is dropped, so the other exclusions still hold.
 */
export async function readSelection(vault: Vault, workspacePath: string): Promise<Selection> {
  try {
    const raw = JSON.parse(await readFile(absoluteInVault(vault, selectionPath(workspacePath)), 'utf8')) as Record<string, unknown>;
    const shape = selectionShape.safeParse({ ...DEFAULT_SELECTION, ...raw, version: 1 });
    if (!shape.success) return { ...DEFAULT_SELECTION };
    return { version: 1, excluded: wholeNotes(shape.data.excluded), starred: wholeNotes(shape.data.starred), web: shape.data.web };
  } catch {
    return { ...DEFAULT_SELECTION };
  }
}

/** Only the Workspace owner changes what the AI reads there. */
export async function writeSelection(vault: Vault, actor: Role, workspacePath: string, input: Omit<Selection, 'version'>): Promise<Selection> {
  const ws = await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace');
  if (actor.name !== ws.note.owner) throw new ApprovalDenied(`只有 Workspace 的负责人（${ws.note.owner}）可以改资料选择`);
  const sel = selectionSchema.parse({ version: 1, excluded: [...new Set(input.excluded)], starred: [...new Set(input.starred)], web: input.web });
  const full = absoluteInVault(vault, selectionPath(workspacePath));
  await mkdir(path.dirname(full), { recursive: true });
  // a temp file of its own: two quick clicks on the files page save at the same time (D-64 T37)
  const tmp = `${full}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sel, null, 2)}\n`, 'utf8');
  await rename(tmp, full);
  return sel;
}

/**
 * 复核 P1: the frame of the task — contract, project, workspace, plans, opinions, logs, config — is not material the
 * owner selects from: the harness reads it whatever the selection says (unticking the contract used to stop every
 * workplan and research request). Only material (sources, notes of meetings and interviews, reports, decisions) is
 * subject to the selection. Path-based, so an excluded note is never opened to find out what it is.
 */
export function isFrameNote(p: string): boolean {
  return /(^|\/)(决策契约|项目|workspace|日志)\.md$/.test(p) || /(^|\/)(workplan|计划) v\d+\.md$/.test(p) || /^90_配置\//.test(p) || /(^|\/)review\/[^/]+\.md$/.test(p);
}

/**
 * The vault as the AI sees it in this Workspace: excluded notes are left out of list / tree / search, starred notes
 * come first among the notes. Content reads cannot bypass the selection. A citation check still says truthfully
 * whether an existing citation holds (that is integrity, not reading), but hands back no text of an excluded note.
 * Writes and existence checks pass through unchanged. Fragment selections are not whole-note exclusions.
 */
export function selectionView(vault: Vault, sel: Selection): Vault {
  if (sel.excluded.length === 0 && sel.starred.length === 0) return vault;
  // Match the underlying vault's path identity without changing allowed calls' return values.
  const normalize = (p: string) => path.relative(vault.root, path.resolve(vault.root, p.replace(/^\/+/, ''))).split(path.sep).join('/');
  const excluded = new Set(sel.excluded.map(normalize));
  const starred = new Set(sel.starred.map(normalize));
  const isExcluded = (p: string) => !isFrameNote(normalize(p)) && excluded.has(normalize(p));
  const requireSelected = (p: string) => {
    if (isExcluded(p)) throw new VaultError('not_found', '该资料已取消选择，AI 不可读');
  };
  // An unticked note: whether the cited block exists is said, its text is not, and a quote is not compared against it
  // (comparing would let a guess be tested against text the AI may not read — review of P1). Citations to it were
  // checked word for word when they were written.
  const withheld = (c: CitationCheck): CitationCheck =>
    c.path && isExcluded(c.path) ? { ...c, blockText: undefined, ...(c.error === 'quote_mismatch' ? { ok: true, error: undefined } : {}) } : c;
  const starFirst = <T extends { path: string }>(xs: T[]): T[] => [...xs.filter((x) => starred.has(normalize(x.path))), ...xs.filter((x) => !starred.has(normalize(x.path)))];
  const prune = (nodes: VaultTreeNode[]): VaultTreeNode[] =>
    nodes.filter((n) => !isExcluded(n.path)).map((n) => (n.children ? { ...n, children: prune(n.children) } : n));
  const selected: Vault = {
    ...vault,
    root: vault.root,
    async read(notePath) {
      requireSelected(notePath);
      return vault.read(notePath);
    },
    async readTyped(notePath, type) {
      requireSelected(notePath);
      return vault.readTyped(notePath, type);
    },
    async getBlocks(notePath) {
      requireSelected(notePath);
      return vault.getBlocks(notePath);
    },
    async readLog(logPath) {
      requireSelected(logPath);
      return vault.readLog(logPath);
    },
    async resolveLink(link, fromPath) {
      // Resolve against the original catalog first: removing a candidate must never silently retarget a link.
      const res = await vault.resolveLink(link, fromPath);
      if (res.ok) return isExcluded(res.path) ? { ok: false, error: 'not_found', candidates: [] } : res;
      return { ...res, candidates: res.candidates.filter((p) => !isExcluded(p)) };
    },
    // 复核 P1: whether a citation holds is checked on the original vault (an excluded source still exists, and a valid
    // citation to it must not read as missing); the text of an excluded note is not handed back.
    async checkCitation(link, opts = {}) {
      return withheld(await vault.checkCitation(link, opts));
    },
    async checkCitations(text, opts = {}) {
      return (await vault.checkCitations(text, opts)).map(withheld);
    },
    async list(dir, opts) {
      const entries = (await vault.list(dir, opts)).filter((e) => !isExcluded(e.path));
      const dirs = entries.filter((e: VaultEntry) => e.kind === 'dir');
      return [...dirs, ...starFirst(entries.filter((e) => e.kind !== 'dir'))];
    },
    async tree(dir) {
      return prune(await vault.tree(dir));
    },
    async search(opts) {
      const limit = opts.limit ?? 20;
      const hits = (await vault.search({ ...opts, limit: limit + excluded.size })).filter((h) => !isExcluded(h.path));
      return starFirst(hits).slice(0, limit);
    },
  };
  return selected;
}
