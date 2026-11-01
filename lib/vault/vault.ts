/**
 * The vault service — server-only file access to the Obsidian vault (PRD §9, §10.5).
 *
 * Paths are always vault-relative POSIX paths including `.md` for notes,
 * e.g. `20_项目/个人AI战略/项目.md`. Hidden entries (`.obsidian`, temp files)
 * are invisible to every method.
 *
 * CONTRACT (frozen after M0): change only via docs/CONTRACTS.md change request.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { noteSchema, type NoteFrontmatter, type NoteType } from '@/lib/notes/schema';
import { parseBlocks, quoteMatchesBlock, type Block } from './blocks';
import { parseMarkdown, serializeMarkdown } from './frontmatter';
import { extractWikiLinks, parseWikiLink, type WikiLink } from './links';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VaultEntry {
  path: string;
  /** File or folder name (files keep `.md`). */
  name: string;
  kind: 'file' | 'dir';
}

export interface VaultTreeNode extends VaultEntry {
  children?: VaultTreeNode[];
}

export interface VaultNote {
  path: string;
  /** Basename without `.md` — what `[[link]]` uses. */
  title: string;
  /** Raw frontmatter as parsed. */
  data: Record<string, unknown>;
  /** Validated frontmatter, or null when it fails `noteSchema` (see `issues`). */
  note: NoteFrontmatter | null;
  issues: string[];
  body: string;
}

export type VaultErrorCode =
  | 'invalid_path'
  | 'not_found'
  | 'exists'
  | 'validation'
  | 'links_missing'
  | 'links_unresolved';

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(details.length ? `${message}: ${details.join('; ')}` : message);
    this.name = 'VaultError';
  }
}

export type FrontmatterValue = string | number | boolean | null;

export interface SearchOptions {
  /**
   * Whitespace-separated keywords (case-insensitive). A note matches when it contains AT LEAST ONE;
   * notes are ranked by how many keywords they contain, so notes containing all of them come first.
   */
  query?: string;
  /** Frontmatter filter: key equals value; array field contains value; array value = any-of. */
  where?: Record<string, FrontmatterValue | FrontmatterValue[]>;
  /** Restrict to note types (shorthand for where.type). */
  types?: NoteType[];
  /** Restrict to a folder (vault-relative). */
  dir?: string;
  /** Default 20. */
  limit?: number;
}

export interface SearchHit {
  path: string;
  title: string;
  data: Record<string, unknown>;
  score: number;
  /** How many of the query keywords the note contains (= the number of keywords when all matched; 0 when the query is empty). */
  matched: number;
  /** Up to 3 excerpts around keyword hits. */
  snippets: string[];
}

export interface WriteInput {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface WriteOptions {
  /** Replace an existing file. Default false (create only). */
  overwrite?: boolean;
  /** Verify derived_from / relates_to links; on overwrite only those not already in the file. Default true. */
  checkLinks?: boolean;
}

export type LinkResolution =
  | { ok: true; path: string }
  | { ok: false; error: 'not_found' | 'ambiguous'; candidates: string[] };

export type CitationError = 'note_not_found' | 'ambiguous' | 'block_not_found' | 'quote_mismatch';

export interface CitationCheck {
  link: string;
  ok: boolean;
  /** Resolved note path, when found. */
  path?: string;
  block?: string;
  /** The block's text, when found — what the citation actually points at. */
  blockText?: string;
  /** Quote that preceded the link in the checked text, if any. */
  quote?: string;
  error?: CitationError;
}

export interface LogEntry {
  /** ISO datetime. */
  time: string;
  /** Role name or `AI`. */
  actor: string;
  /** e.g. `tool:vault_search`, `approve:G1`, `write:workplan v2`. */
  action: string;
  /** What changed (or the tool call summary). */
  change: string;
  /** Why. */
  reason: string;
}

export interface Vault {
  readonly root: string;
  /** Folders first, then notes; `.md` files only. */
  list(dir?: string, opts?: { recursive?: boolean }): Promise<VaultEntry[]>;
  tree(dir?: string): Promise<VaultTreeNode[]>;
  exists(notePath: string): Promise<boolean>;
  read(notePath: string): Promise<VaultNote>;
  /** Read and require a valid note of `type`. Throws VaultError('validation') otherwise. */
  readTyped<T extends NoteType>(notePath: string, type: T): Promise<VaultNote & { note: Extract<NoteFrontmatter, { type: T }> }>;
  search(opts: SearchOptions): Promise<SearchHit[]>;
  /**
   * Resolve `[[link]]` (or a bare target) to a note path. `fromPath` breaks basename ties:
   * a note in the same folder wins, then one in the same project folder (`20_项目/<name>`).
   */
  resolveLink(link: string | WikiLink, fromPath?: string): Promise<LinkResolution>;
  /** Atomic validated write (temp file + rename). On overwrite, links already in the file are not checked again. */
  write(notePath: string, input: WriteInput, opts?: WriteOptions): Promise<VaultNote>;
  /** Append one entry to a `log` note's table (append-only). The log note must exist. */
  appendLog(logPath: string, entry: LogEntry): Promise<void>;
  readLog(logPath: string): Promise<LogEntry[]>;
  getBlocks(notePath: string): Promise<Map<string, Block>>;
  /** Check one `[[note#^cN]]` citation, optionally against the quoted original text. */
  checkCitation(link: string, opts?: { quote?: string; fromPath?: string }): Promise<CitationCheck>;
  /** Check every block citation in a markdown text. A quote “…” right before a link is verified too. */
  checkCitations(text: string, opts?: { fromPath?: string }): Promise<CitationCheck[]>;
}

// ── Path helpers ─────────────────────────────────────────────────────────────

const HIDDEN_RE = /(^|\/)\./;

export function isHiddenPath(rel: string): boolean {
  return HIDDEN_RE.test(rel) || rel.endsWith('.tmp');
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

const PROJECTS_DIR = '20_项目';

/** `20_项目/<name>/…` → `20_项目/<name>`; other paths (shared notes, the project folder itself) → null. */
function projectFolderOf(p: string): string | null {
  const segs = toPosix(p).split('/');
  return segs.length >= 3 && segs[0] === PROJECTS_DIR ? `${segs[0]}/${segs[1]}` : null;
}

/** A link's identity for "was already in this note": target + fragment, alias ignored. Non-wikilinks keep their text. */
function linkKey(l: string): string {
  const parsed = parseWikiLink(l);
  if (!parsed) return l;
  return `${parsed.target}${parsed.block ? `#^${parsed.block}` : ''}${parsed.heading ? `#${parsed.heading}` : ''}`;
}

// ── Implementation ───────────────────────────────────────────────────────────

export function createVault(rootDir: string): Vault {
  const root = path.resolve(rootDir);

  function abs(rel: string): string {
    const cleaned = (rel ?? '').replace(/^\/+/, '');
    const full = path.resolve(root, cleaned);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new VaultError('invalid_path', `path escapes the vault: ${rel}`);
    }
    if (isHiddenPath(toPosix(path.relative(root, full)))) {
      throw new VaultError('invalid_path', `hidden path: ${rel}`);
    }
    return full;
  }

  function rel(full: string): string {
    return toPosix(path.relative(root, full));
  }

  async function list(dir = '', opts: { recursive?: boolean } = {}): Promise<VaultEntry[]> {
    const base = abs(dir);
    let dirents;
    try {
      dirents = await fs.readdir(base, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('not_found', `no such folder: ${dir}`);
      throw e;
    }
    const out: VaultEntry[] = [];
    const sorted = dirents
      .filter((d) => !d.name.startsWith('.') && !d.name.endsWith('.tmp'))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    for (const d of sorted) {
      const p = rel(path.join(base, d.name));
      if (d.isDirectory()) {
        out.push({ path: p, name: d.name, kind: 'dir' });
        if (opts.recursive) out.push(...(await list(p, opts)));
      } else if (d.isFile() && d.name.endsWith('.md')) {
        out.push({ path: p, name: d.name, kind: 'file' });
      }
    }
    return out;
  }

  async function tree(dir = ''): Promise<VaultTreeNode[]> {
    const entries = await list(dir);
    return Promise.all(
      entries.map(async (e) => (e.kind === 'dir' ? { ...e, children: await tree(e.path) } : e)),
    );
  }

  async function allNotePaths(dir = ''): Promise<string[]> {
    return (await list(dir, { recursive: true })).filter((e) => e.kind === 'file').map((e) => e.path);
  }

  async function exists(notePath: string): Promise<boolean> {
    try {
      const st = await fs.stat(abs(notePath));
      return st.isFile();
    } catch {
      return false;
    }
  }

  async function readRaw(notePath: string): Promise<string> {
    try {
      return await fs.readFile(abs(notePath), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('not_found', `no such note: ${notePath}`);
      throw e;
    }
  }

  function toNote(notePath: string, text: string): VaultNote {
    const { data, body } = parseMarkdown(text);
    const parsed = noteSchema.safeParse(data);
    return {
      path: notePath,
      title: path.posix.basename(notePath, '.md'),
      data,
      note: parsed.success ? parsed.data : null,
      issues: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      body,
    };
  }

  async function read(notePath: string): Promise<VaultNote> {
    return toNote(notePath, await readRaw(notePath));
  }

  async function readTyped<T extends NoteType>(notePath: string, type: T) {
    const n = await read(notePath);
    if (!n.note || n.note.type !== type) {
      throw new VaultError('validation', `${notePath} is not a valid ${type} note`, n.issues);
    }
    return n as VaultNote & { note: Extract<NoteFrontmatter, { type: T }> };
  }

  function matchesWhere(data: Record<string, unknown>, where: SearchOptions['where']): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, want]) => {
      const have = data[key];
      const wants = Array.isArray(want) ? want : [want];
      const haves = Array.isArray(have) ? have : [have];
      return wants.some((w) => haves.some((h) => h === w));
    });
  }

  function makeSnippets(text: string, tokens: string[]): string[] {
    const lower = text.toLowerCase();
    const out: string[] = [];
    for (const t of tokens) {
      const i = lower.indexOf(t);
      if (i < 0) continue;
      const start = Math.max(0, i - 80);
      const end = Math.min(text.length, i + t.length + 80);
      out.push(`${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`);
      if (out.length >= 3) break;
    }
    return out;
  }

  async function search(opts: SearchOptions): Promise<SearchHit[]> {
    const tokens = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const where = { ...(opts.where ?? {}), ...(opts.types?.length ? { type: opts.types } : {}) };
    const hits: SearchHit[] = [];
    for (const p of await allNotePaths(opts.dir ?? '')) {
      const n = await read(p);
      if (!matchesWhere(n.data, where)) continue;
      const haystack = `${n.title}\n${JSON.stringify(n.data)}\n${n.body}`.toLowerCase();
      const present = tokens.filter((t) => haystack.includes(t));
      if (tokens.length > 0 && present.length === 0) continue;
      const titleLower = n.title.toLowerCase();
      const score = present.reduce(
        (s, t) => s + haystack.split(t).length - 1 + (titleLower.includes(t) ? 5 : 0),
        0,
      );
      hits.push({ path: p, title: n.title, data: n.data, score, matched: present.length, snippets: makeSnippets(n.body, present) });
    }
    hits.sort((a, b) => b.matched - a.matched || b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, opts.limit ?? 20);
  }

  async function resolveLink(link: string | WikiLink, fromPath?: string): Promise<LinkResolution> {
    const target = typeof link === 'string' ? (parseWikiLink(link)?.target ?? link.replace(/\.md$/, '')) : link.target;
    if (target.includes('/')) {
      const p = `${target}.md`;
      return (await exists(p)) ? { ok: true, path: p } : { ok: false, error: 'not_found', candidates: [] };
    }
    const candidates = (await allNotePaths()).filter((p) => path.posix.basename(p, '.md') === target);
    if (candidates.length === 1) return { ok: true, path: candidates[0] };
    if (candidates.length === 0) return { ok: false, error: 'not_found', candidates };
    if (fromPath) {
      const sameDir = candidates.filter((c) => path.posix.dirname(c) === path.posix.dirname(fromPath));
      if (sameDir.length === 1) return { ok: true, path: sameDir[0] };
      const project = projectFolderOf(fromPath);
      if (project) {
        const sameProject = candidates.filter((c) => projectFolderOf(c) === project);
        if (sameProject.length === 1) return { ok: true, path: sameProject[0] };
      }
    }
    return { ok: false, error: 'ambiguous', candidates };
  }

  async function getBlocks(notePath: string): Promise<Map<string, Block>> {
    return parseBlocks((await read(notePath)).body);
  }

  async function checkCitation(link: string, opts: { quote?: string; fromPath?: string } = {}): Promise<CitationCheck> {
    const parsed = parseWikiLink(link);
    const base: CitationCheck = { link, ok: false, ...(opts.quote ? { quote: opts.quote } : {}) };
    if (!parsed) return { ...base, error: 'note_not_found' };
    const res = await resolveLink(parsed, opts.fromPath);
    if (!res.ok) return { ...base, error: res.error === 'ambiguous' ? 'ambiguous' : 'note_not_found' };
    if (!parsed.block) return { ...base, path: res.path, error: 'block_not_found' };
    const block = (await getBlocks(res.path)).get(parsed.block);
    if (!block) return { ...base, path: res.path, block: parsed.block, error: 'block_not_found' };
    const found = { ...base, path: res.path, block: parsed.block, blockText: block.text };
    if (opts.quote && !quoteMatchesBlock(opts.quote, block)) return { ...found, error: 'quote_mismatch' };
    return { ...found, ok: true };
  }

  async function checkCitations(text: string, opts: { fromPath?: string } = {}): Promise<CitationCheck[]> {
    const out: CitationCheck[] = [];
    for (const l of extractWikiLinks(text)) {
      if (!l.block) continue;
      const idx = text.indexOf(l.raw);
      const before = text.slice(Math.max(0, idx - 400), idx);
      // A quote immediately preceding the link: “…” / "…" / 「…」, then optional spaces/（…）.
      const qm = /(?:“([^”]+)”|"([^"]+)"|「([^」]+)」)\s*(?:[（(][^）)]*[）)])?\s*$/.exec(before);
      const quote = qm ? (qm[1] ?? qm[2] ?? qm[3]) : undefined;
      out.push(await checkCitation(l.raw, { quote, fromPath: opts.fromPath }));
    }
    return out;
  }

  async function write(notePath: string, input: WriteInput, opts: WriteOptions = {}): Promise<VaultNote> {
    if (!notePath.endsWith('.md')) throw new VaultError('invalid_path', `note path must end with .md: ${notePath}`);
    const full = abs(notePath);

    const parsed = noteSchema.safeParse(input.frontmatter);
    if (!parsed.success) {
      throw new VaultError(
        'validation',
        `frontmatter invalid for ${notePath}`,
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      );
    }
    const fm = parsed.data;
    const missing = (['derived_from', 'relates_to'] as const).filter((k) => fm[k].length === 0);
    if (missing.length) {
      throw new VaultError('links_missing', `${notePath} must link what it derives from and relates to (§9.3)`, missing.map((k) => `${k} is empty`));
    }
    if (opts.checkLinks !== false) {
      // On overwrite, a link that was already in the file is not checked again: a shared note may keep an old
      // `[[项目]]` that became ambiguous once a second project appeared (D-56).
      const preexisting = new Set<string>();
      if (opts.overwrite && (await exists(notePath))) {
        const data = (await read(notePath)).data;
        for (const field of ['derived_from', 'relates_to'] as const) {
          const values = data[field];
          if (!Array.isArray(values)) continue;
          for (const l of values) if (typeof l === 'string') preexisting.add(linkKey(l));
        }
      }
      const bad: string[] = [];
      for (const l of [...fm.derived_from, ...fm.relates_to]) {
        if (preexisting.has(linkKey(l))) continue;
        const parsedLink = parseWikiLink(l)!;
        const r = await resolveLink(parsedLink, notePath);
        if (!r.ok) {
          bad.push(`${l} (${r.error})`);
          continue;
        }
        if (parsedLink.block && !(await getBlocks(r.path)).has(parsedLink.block)) bad.push(`${l} (block_not_found)`);
      }
      if (bad.length) throw new VaultError('links_unresolved', `${notePath} links to notes that do not exist`, bad);
    }
    if (!opts.overwrite && (await exists(notePath))) {
      throw new VaultError('exists', `note already exists: ${notePath} (pass overwrite to replace)`);
    }

    // Keep the caller's key order (readable in Obsidian), but with validated values.
    const text = serializeMarkdown({ ...input.frontmatter, ...fm }, input.body);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await fs.writeFile(tmp, text, 'utf8');
      await fs.rename(tmp, full);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return toNote(notePath, text);
  }

  // Log: a markdown table under the frontmatter; one row per entry, append-only.
  const LOG_HEADER = '| 时间 | 执行者 | 动作 | 改了什么 | 为什么 |\n|---|---|---|---|---|\n';
  const cell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

  async function appendLog(logPath: string, entry: LogEntry): Promise<void> {
    const n = await read(logPath);
    if (n.note?.type !== 'log') throw new VaultError('validation', `${logPath} is not a log note`, n.issues);
    const full = abs(logPath);
    let prefix = '';
    if (!n.body.includes('| 时间 | 执行者 |')) prefix = (n.body.endsWith('\n') ? '' : '\n') + '\n' + LOG_HEADER;
    const row = `| ${[entry.time, entry.actor, entry.action, entry.change, entry.reason].map(cell).join(' | ')} |\n`;
    // O_APPEND: single small writes are not interleaved; append-only by construction.
    await fs.appendFile(full, prefix + row, 'utf8');
  }

  async function readLog(logPath: string): Promise<LogEntry[]> {
    const { body } = await read(logPath);
    const rows: LogEntry[] = [];
    for (const line of body.split('\n')) {
      if (!line.startsWith('| ') || line.startsWith('| 时间 |') || line.startsWith('|---')) continue;
      const cells = line
        .slice(2, -2)
        .split(/(?<!\\) \| /)
        .map((c) => c.replace(/\\\|/g, '|'));
      if (cells.length !== 5) continue;
      const [time, actor, action, change, reason] = cells;
      rows.push({ time, actor, action, change, reason });
    }
    return rows;
  }

  return {
    root,
    list,
    tree,
    exists,
    read,
    readTyped,
    search,
    resolveLink,
    write,
    appendLog,
    readLog,
    getBlocks,
    checkCitation,
    checkCitations,
  };
}
