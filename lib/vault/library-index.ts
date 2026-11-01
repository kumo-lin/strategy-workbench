/**
 * A bilingual index of the reference library (10_资料库), so a Chinese query can find an
 * English-titled note and vice versa. The notes themselves are never changed.
 *
 * The index is generated once by scripts/build-library-index.ts; this module holds the schema,
 * the loader/search used at runtime, and the pure build loop the script injects the model into.
 * Server-only (reads the index through `node:fs/promises`).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Vault } from './vault';

// ── Types ────────────────────────────────────────────────────────────────────

export const LIBRARY_INDEX_PATH = '90_配置/资料索引.json';

export interface LibraryIndexEntry {
  /** Vault-relative, e.g. `10_资料库/Gartner 2025-08 AI PC 份额预测.md`. */
  path: string;
  /** File name without `.md`. */
  title: string;
  summary_zh: string;
  summary_en: string;
  /** 8–12, mixed Chinese and English. */
  keywords: string[];
  /** ISO datetime. */
  generated_at: string;
}

export interface LibraryIndex {
  version: 1;
  generated_at: string;
  entries: LibraryIndexEntry[];
}

const libraryIndexEntrySchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  summary_zh: z.string(),
  summary_en: z.string(),
  keywords: z.array(z.string()),
  generated_at: z.string(),
});

export const libraryIndexSchema = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  entries: z.array(libraryIndexEntrySchema),
});

const EMPTY_INDEX = (): LibraryIndex => ({ version: 1, generated_at: '', entries: [] });

// ── Loader ───────────────────────────────────────────────────────────────────

/** The index at `90_配置/资料索引.json`; a missing/unreadable/invalid file is an empty index, never an error. */
export async function loadLibraryIndex(vault: Vault): Promise<LibraryIndex> {
  try {
    const raw = await fs.readFile(path.join(vault.root, LIBRARY_INDEX_PATH), 'utf8');
    const parsed = libraryIndexSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_INDEX();
  } catch {
    return EMPTY_INDEX();
  }
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'are', 'with', 'by']);
const PARTICLES = new Set(['的', '了', '是', '在', '和', '与', '及', '也', '都', '就', '吗', '呢', '吧']);
/** Latin word runs, or one run of Han characters; order in the query is preserved. */
const RUN_RE = /[a-z0-9][a-z0-9.+_-]*|\p{Script=Han}+/gu;
const HAN_RE = /^\p{Script=Han}+$/u;

/**
 * Query → search tokens. Latin words (≥ 2 chars, stop words dropped) and every CJK bigram
 * (bigrams containing a particle are skipped; a lone character counts when it is not a particle).
 */
export function tokenizeQuery(query: string): string[] {
  const text = query.normalize('NFKC').toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (token: string): void => {
    if (seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  for (const match of text.matchAll(RUN_RE)) {
    const run = match[0];
    if (!HAN_RE.test(run)) {
      if (run.length >= 2 && !STOP_WORDS.has(run)) add(run);
      continue;
    }
    const chars = [...run];
    if (chars.length === 1) {
      if (!PARTICLES.has(chars[0])) add(chars[0]);
      continue;
    }
    for (let i = 0; i + 1 < chars.length; i++) {
      if (PARTICLES.has(chars[i]) || PARTICLES.has(chars[i + 1])) continue;
      add(chars[i] + chars[i + 1]);
    }
  }
  return out;
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface LibrarySearchHit {
  entry: LibraryIndexEntry;
  /** Distinct query tokens the entry contains, in query order. */
  matched: string[];
  score: number;
}

const normalizeField = (text: string): string => text.normalize('NFKC').toLowerCase();
const comparePath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Case/width-insensitive substring match over the title, both summaries and every keyword. */
export function searchLibraryIndex(index: LibraryIndex, query: string, limit = 8): LibrarySearchHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0 || index.entries.length === 0) return [];

  const scored: Array<{ entry: LibraryIndexEntry; matched: string[]; score: number; primary: number }> = [];
  for (const entry of index.entries) {
    const fields = [entry.title, entry.summary_zh, entry.summary_en, ...entry.keywords].map(normalizeField);
    const primaryFields = [entry.title, ...entry.keywords].map(normalizeField);
    const matched = tokens.filter((t) => fields.some((f) => f.includes(t)));
    if (matched.length === 0) continue;
    const primary = tokens.filter((t) => primaryFields.some((f) => f.includes(t))).length;
    scored.push({ entry, matched, score: matched.length, primary });
  }

  scored.sort((a, b) => b.score - a.score || b.primary - a.primary || comparePath(a.entry.path, b.entry.path));
  return scored.slice(0, limit).map(({ entry, matched, score }) => ({ entry, matched, score }));
}

// ── Model answer ─────────────────────────────────────────────────────────────

function oneLine(text: string): string {
  return text.replace(/\r?\n+/g, ' ').trim();
}

/**
 * The model's answer → the three index fields, or null. Accepts bare JSON, a ```/```json fence,
 * or prose around it (first `{` to last `}`). Keywords are trimmed, deduped case-insensitively,
 * capped at 12; fewer than 6 left means the answer is unusable.
 */
export function parseIndexEntry(raw: string): { summary_zh: string; summary_en: string; keywords: string[] } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.summary_zh !== 'string' || typeof obj.summary_en !== 'string') return null;
  if (!Array.isArray(obj.keywords) || !obj.keywords.every((k) => typeof k === 'string')) return null;

  const summary_zh = oneLine(obj.summary_zh);
  const summary_en = oneLine(obj.summary_en);
  if (!summary_zh || !summary_en) return null;

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const rawKeyword of obj.keywords) {
    const keyword = rawKeyword.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
    if (keywords.length >= 12) break;
  }
  if (keywords.length < 6) return null;

  return { summary_zh, summary_en, keywords };
}

// ── Build (the script injects the model) ─────────────────────────────────────

export interface LibraryIndexFile {
  /** Vault-relative path, e.g. `10_资料库/x.md`. */
  path: string;
  title: string;
  /** What is sent to the model (frontmatter fields + the note body). */
  prompt: string;
}

export interface BuildIndexOptions {
  /** Parallel model calls. Default 8, clamped to 1–16. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface BuildIndexResult {
  entries: LibraryIndexEntry[];
  failed: { path: string; error: string }[];
}

/**
 * Ask the model for one entry per file, retrying a failed answer once. The model call is
 * injected (`generate(file) → raw answer`) so the retry and pool behaviour can be tested.
 */
export async function buildIndex(
  files: LibraryIndexFile[],
  generate: (file: LibraryIndexFile) => Promise<string>,
  opts: BuildIndexOptions = {},
): Promise<BuildIndexResult> {
  const wanted = opts.concurrency ?? 8;
  const concurrency = Number.isFinite(wanted) ? Math.min(16, Math.max(1, Math.floor(wanted))) : 8;
  const entries: LibraryIndexEntry[] = [];
  const failed: { path: string; error: string }[] = [];
  let next = 0;
  let done = 0;

  const attempt = async (file: LibraryIndexFile): Promise<{ entry?: LibraryIndexEntry; error?: string }> => {
    try {
      const parsed = parseIndexEntry(await generate(file));
      if (!parsed) return { error: 'the answer did not parse into an index entry (two summaries, 6+ keywords)' };
      return {
        entry: { path: file.path, title: file.title, ...parsed, generated_at: new Date().toISOString() },
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const file = files[i];
      let result = await attempt(file);
      if (!result.entry) result = await attempt(file);
      if (result.entry) entries.push(result.entry);
      else failed.push({ path: file.path, error: result.error ?? 'unknown error' });
      done += 1;
      opts.onProgress?.(done, files.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  entries.sort((a, b) => comparePath(a.path, b.path));
  failed.sort((a, b) => comparePath(a.path, b.path));
  return { entries, failed };
}
