/**
 * Generate the bilingual library index (90_配置/资料索引.json): per note a Chinese summary, an
 * English summary and 8–12 mixed zh/en keywords, so search works across languages.
 *
 *   pnpm exec tsx scripts/build-library-index.ts [--lib <dir>] [--out <file>] [--concurrency 8] [--limit N] [--resume]
 *
 * --lib defaults to demo-vault/.snapshots/S3-D48/10_资料库 (read from disk, not through a Vault);
 * --out to demo-vault/.snapshots/clean/90_配置/资料索引.json. Only *.md files directly in --lib are read.
 * --resume keeps existing entries whose note is still there and generates the missing ones.
 * Exits 1 if any note failed. Never prints note bodies or keys.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateText } from 'ai';
import { getModel } from '@/lib/models/provider';
import { parseMarkdown } from '@/lib/vault';
import {
  buildIndex,
  libraryIndexSchema,
  type BuildIndexResult,
  type LibraryIndex,
  type LibraryIndexEntry,
  type LibraryIndexFile,
} from '@/lib/vault/library-index';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the environment
}

const ROOT = process.cwd();
const DEFAULT_LIB = 'demo-vault/.snapshots/S3-D48/10_资料库';
const DEFAULT_OUT = 'demo-vault/.snapshots/clean/90_配置/资料索引.json';
const BODY_CHARS = 6000;
const LIBRARY_DIR = '10_资料库';

const SYSTEM = `You index one reference document for a bilingual (Chinese/English) research library.
Answer with ONLY a JSON object and nothing else:
{"summary_zh": "...", "summary_en": "...", "keywords": [...]}

- summary_zh: one line, at most 80 characters, saying what the document claims, in its own terms.
- summary_en: one line, at most 160 characters, saying the same.
- keywords: 8 to 12 items mixing Chinese and English. Include organisation names, product names, and the definition of any number (e.g. "AI PC 出货量占比", "AI PC shipment share"); give each in both languages where natural.
- No marketing words. Use only what the document says.`;

interface Args {
  lib: string;
  out: string;
  concurrency: number;
  limit: number;
  resume: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { lib: DEFAULT_LIB, out: DEFAULT_OUT, concurrency: 8, limit: Infinity, resume: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--resume') {
      args.resume = true;
      continue;
    }
    if (flag !== '--lib' && flag !== '--out' && flag !== '--concurrency' && flag !== '--limit') {
      throw new Error(`unknown argument: ${flag}`);
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--lib') args.lib = value;
    else if (flag === '--out') args.out = value;
    else if (flag === '--concurrency') args.concurrency = Number(value);
    else args.limit = Math.max(0, Math.trunc(Number(value)));
  }
  return args;
}

/** Frontmatter fields that identify the source, then the first 6000 characters of the body. */
function modelPrompt(text: string): string {
  const { data, body } = parseMarkdown(text);
  const meta: string[] = [];
  for (const key of ['publisher', 'published', 'url'] as const) {
    const value = data[key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    meta.push(`${key}: ${String(value)}`);
  }
  return `${meta.length ? `${meta.join('\n')}\n\n` : ''}${body.slice(0, BODY_CHARS)}`;
}

async function readExisting(file: string): Promise<LibraryIndexEntry[]> {
  try {
    const parsed = libraryIndexSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return parsed.success ? parsed.data.entries : [];
  } catch {
    return [];
  }
}

async function writeAtomic(file: string, index: LibraryIndex): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const libDir = path.resolve(ROOT, args.lib);
  const outFile = path.resolve(ROOT, args.out);

  const allNames = (await readdir(libDir)).filter((name) => name.endsWith('.md')).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const allPaths = new Set(allNames.map((name) => `${LIBRARY_DIR}/${name}`));
  const names = Number.isFinite(args.limit) ? allNames.slice(0, args.limit) : allNames;

  const kept = args.resume ? (await readExisting(outFile)).filter((entry) => allPaths.has(entry.path)) : [];
  const keptPaths = new Set(kept.map((entry) => entry.path));

  const files: LibraryIndexFile[] = [];
  for (const name of names) {
    const notePath = `${LIBRARY_DIR}/${name}`;
    if (keptPaths.has(notePath)) continue;
    const text = await readFile(path.join(libDir, name), 'utf8');
    files.push({ path: notePath, title: name.replace(/\.md$/, ''), prompt: modelPrompt(text) });
  }

  const started = Date.now();
  let result: BuildIndexResult = { entries: [], failed: [] };
  if (files.length > 0) {
    const { model } = await getModel();
    result = await buildIndex(
      files,
      async (file) => (await generateText({ model, system: SYSTEM, prompt: file.prompt })).text,
      {
        concurrency: args.concurrency,
        onProgress: (done, total) => {
          if (done % 20 === 0 || done === total) console.log(`done ${done}/${total}`);
        },
      },
    );
  }

  const entries = [...kept, ...result.entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  await writeAtomic(outFile, { version: 1, generated_at: new Date().toISOString(), entries });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`生成 ${result.entries.length} 条，失败 ${result.failed.length} 条，用时 ${seconds} 秒`);
  for (const failure of result.failed) {
    console.log(`  ${failure.path}: ${failure.error.slice(0, 200)}`);
  }
  process.exitCode = result.failed.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
