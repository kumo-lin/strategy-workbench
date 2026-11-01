/**
 * The pack of a decomposition (D-56 ③ v2): what the code finds before any model call — the leadership
 * directives, confirmed decisions and company policy lines the user's direction is checked against, the
 * co-creation method note, and the reference notes that match the user's words. Deterministic (no model);
 * every item gets a stable `K<n>` id, and the model cites ids, never paths.
 */
import type { Block, Vault, VaultNote } from '@/lib/vault';
import { parseBlocks } from '@/lib/vault';
import { loadLibraryIndex, searchLibraryIndex } from '@/lib/vault/library-index';
import type { PackItem } from './types';

export const POLICY_DIR = '00_团队知识/高层方针';
export const REFERENCE_DIR = '10_资料库';

const METHOD_DIR = '00_团队知识/方法库';
const METHOD_NOTE = 'workplan共创';
const DEFAULT_MAX_REFERENCES = 20;
const GIST_MAX = 80;

/** Characters that only make grammar, not meaning: a 2-gram of two of them is not a keyword. */
const STOP_CHARS = new Set([...'的了和是在有不也就都而及与或对为把被从到这那你我他她它们个什么怎么如何能否会']);

const RUN_RE = /[一-鿿]+|[A-Za-z0-9]+/g;

export interface PackInput {
  vault: Vault;
  /** e.g. `20_项目/个人AI战略`. */
  projectPath: string;
  /** The user's words: topic text plus the filled frame slots (joined); only used to find reference notes. */
  query: string;
  /** More search phrases (the model's, Chinese and English): each is searched on its own and the results are merged. */
  queries?: string[];
  /** Default 20. */
  maxReferences?: number;
}

/** Search keywords from free Chinese/English text: CJK 2-grams and latin/digit words, distinct, in order. */
export function keywordsOf(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const m of text.matchAll(RUN_RE)) {
    const run = m[0];
    if (/^[A-Za-z0-9]+$/.test(run)) {
      if (run.length >= 2) add(run.toLowerCase());
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) {
      const pair = run.slice(i, i + 2);
      if (STOP_CHARS.has(pair[0]) && STOP_CHARS.has(pair[1])) continue;
      add(pair);
    }
  }
  return out;
}

/** Keep the ids of items already in `existing` (same path and block); new items get the next free ids. */
export function mergePack(existing: PackItem[], fresh: PackItem[]): PackItem[] {
  const out = [...existing];
  const same = (x: PackItem, y: PackItem) => x.path === y.path && x.block === y.block;
  let n = existing.reduce((max, i) => Math.max(max, Number(i.id.slice(1)) || 0), 0);
  for (const item of fresh) {
    if (out.some((e) => same(e, item))) continue;
    n += 1;
    out.push({ ...item, id: `K${n}` });
  }
  return out;
}

/** A one-line gist: at most 80 characters, with `…` marking the cut. */
const clip = (s: string) => (s.length > GIST_MAX ? `${s.slice(0, GIST_MAX)}…` : s);

/** A body line as plain text: heading / quote / list marks, emphasis and a block marker removed. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+\^[A-Za-z0-9-]+\s*$/, '')
    .trim();
}

/** The first non-empty body line that is not frontmatter or a heading. */
function firstBodyLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const plain = plainLine(line);
    if (plain) return plain;
  }
  return '';
}

/** The first non-empty line after the note's first heading (the whole body when there is none), skipping a `来源：` line and sub-headings. */
function firstLineAfterHeading(body: string): string {
  const lines = body.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^\s*#{1,6}\s+/.test(line));
  for (const line of lines.slice(heading + 1)) {
    if (/^\s*#{1,6}\s+/.test(line)) continue;
    const plain = plainLine(line);
    if (plain && !/^来源[:：]/.test(plain)) return plain;
  }
  return '';
}

/** `.md` files of a folder, or none when the folder does not exist (a missing folder is never an error). */
async function filesIn(vault: Vault, dir: string, recursive = false) {
  try {
    return (await vault.list(dir, { recursive })).filter((e) => e.kind === 'file');
  } catch {
    return [];
  }
}

export async function buildPack(input: PackInput): Promise<PackItem[]> {
  const { vault, projectPath, query } = input;
  const items: Omit<PackItem, 'id'>[] = [];

  // 1. directives: one item per anchored block of each meeting note.
  for (const file of await filesIn(vault, `${projectPath}/会议`)) {
    const note = await vault.read(file.path);
    for (const block of parseBlocks(note.body).values()) {
      items.push({ kind: 'directive', title: note.title, path: file.path, block: `^${block.id}`, gist: clip(block.text.trim()) });
    }
  }

  // 2. decisions: confirmed only, one item per note.
  for (const file of await filesIn(vault, `${projectPath}/决策`)) {
    const note = await vault.read(file.path);
    if (note.data.status !== '已确认') continue;
    const reason = typeof note.data.reason === 'string' ? note.data.reason.trim() : '';
    items.push({ kind: 'decision', title: note.title, path: file.path, status: '已确认', gist: clip(reason || firstBodyLine(note.body)) });
  }

  // 3. policies: one item per anchored block of each policy note.
  for (const file of await filesIn(vault, POLICY_DIR)) {
    const note = await vault.read(file.path);
    for (const block of parseBlocks(note.body).values()) {
      items.push({ kind: 'policy', title: note.title, path: file.path, block: `^${block.id}`, gist: clip(block.text.trim()) });
    }
  }

  // 4. the co-creation method note.
  const methodPath = `${METHOD_DIR}/${METHOD_NOTE}.md`;
  if (await vault.exists(methodPath)) {
    items.push({ kind: 'method', title: METHOD_NOTE, path: methodPath, gist: '怎么共创 workplan 的方法' });
  }

  // 5. reference notes, ranked by keyword hits and capped.
  items.push(...(await referenceItems(vault, [query, ...(input.queries ?? [])], input.maxReferences ?? DEFAULT_MAX_REFERENCES)));

  return items.map((item, i) => ({ ...item, id: `K${i + 1}` }));
}

/**
 * Each query is searched on its own (keywords weighted by how rare they are in the library: a word that every note has
 * says nothing), then the results are merged round by round so every query keeps its best notes in the pack.
 */
async function referenceItems(vault: Vault, queries: string[], max: number): Promise<Omit<PackItem, 'id'>[]> {
  const perQuery = queries.map((q) => keywordsOf(q)).filter((k) => k.length > 0);
  if (perQuery.length === 0) return [];
  const allKeywords = [...new Set(perQuery.flat())];

  const notes: { note: VaultNote; title: string; body: string }[] = [];
  for (const file of await filesIn(vault, REFERENCE_DIR, true)) {
    const note = await vault.read(file.path);
    notes.push({ note, title: note.title.toLowerCase(), body: note.body.toLowerCase() });
  }
  if (notes.length === 0) return [];
  const weight = new Map<string, number>();
  for (const k of allKeywords) {
    const df = notes.filter((n) => n.title.includes(k) || n.body.includes(k)).length;
    weight.set(k, df === 0 ? 0 : Math.log(1 + notes.length / df));
  }

  // The bilingual index (90_配置/资料索引.json, M0) finds English notes from Chinese words and the other way round; each
  // query's own ranking is the index hits first, then the full-text ones. No index file = full text only.
  const index = await loadLibraryIndex(vault);
  const byPath = new Map(notes.map((n) => [n.note.path, n.note]));
  const rankings = queries
    .map((q) => ({ q, keywords: keywordsOf(q) }))
    .filter((x) => x.keywords.length > 0)
    .map(({ q, keywords }) => {
      const scored = notes
        .map((n) => ({ n, score: keywords.reduce((sum, k) => sum + (weight.get(k) ?? 0) * ((n.title.includes(k) ? 3 : 0) + (n.body.includes(k) ? 1 : 0)), 0) }))
        .filter((x) => x.score > 0);
      scored.sort((a, b) => b.score - a.score || a.n.note.title.localeCompare(b.n.note.title));
      // the first query is the user's whole sentence: matched bigram by bigram it finds the generic notes, so only the short phrases use the index
      const indexed = (q === queries[0] ? [] : searchLibraryIndex(index, q, 8)).flatMap((h) => byPath.get(h.entry.path) ?? []);
      return [...new Map([...indexed, ...scored.map((x) => x.n.note)].map((note) => [note.path, note])).values()];
    });

  const chosen: VaultNote[] = [];
  const seen = new Set<string>();
  for (let round = 0; chosen.length < max && rankings.some((r) => round < r.length); round++) {
    for (const ranking of rankings) {
      const note = ranking[round];
      if (!note || seen.has(note.path) || chosen.length >= max) continue;
      seen.add(note.path);
      chosen.push(note);
    }
  }

  return chosen.map((note) => {
    const blocks = [...parseBlocks(note.body).values()];
    const block = blocks.length ? bestBlock(blocks, allKeywords) : undefined;
    return {
      kind: 'reference' as const,
      title: note.title,
      path: note.path,
      ...(block ? { block: `^${block.id}` } : {}),
      // the claim the note was picked for, not its first line (a source note opens with 来源：<url>)
      gist: clip(block ? block.text.trim() : firstLineAfterHeading(note.body)),
    };
  });
}

/** The block with the most keyword hits (the first one wins a tie). */
function bestBlock(blocks: Block[], keywords: string[]): Block {
  let best = blocks[0];
  let bestHits = -1;
  for (const block of blocks) {
    const text = block.text.toLowerCase();
    const count = keywords.filter((k) => text.includes(k)).length;
    if (count > bestHits) {
      best = block;
      bestHits = count;
    }
  }
  return best;
}
