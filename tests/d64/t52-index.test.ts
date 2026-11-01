/** D-64 T52: the hand-written library index of m1-qira (no model): covers the library, summaries come from claims, two queries hit. */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLibraryIndex, searchLibraryIndex } from '@/lib/vault/library-index';
import { createVault } from '@/lib/vault';

const vault = createVault(path.resolve('demo-vault/.snapshots/m1-qira'));
const LIB = '10_资料库';
const claimsOf = async (p: string) => [...(await vault.read(p)).body.split('## 抓取原文')[0].matchAll(/^- 「(.+)」— 位置：/gm)].map((m) => m[1]);
const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)?%?/g) ?? [];

describe('T52 library index', () => {
  it('covers every file of the library, and nothing else', async () => {
    const index = await loadLibraryIndex(vault);
    const files = readdirSync(path.join(vault.root, LIB)).filter((f) => f.endsWith('.md')).map((f) => `${LIB}/${f}`).sort();
    expect(index.entries.map((e) => e.path).sort()).toEqual(files);
    for (const e of index.entries) expect(e.title).toBe(path.posix.basename(e.path, '.md'));
  });

  it('each English summary is one of the source\'s claims; the Chinese one carries the same numbers', async () => {
    for (const e of (await loadLibraryIndex(vault)).entries) {
      const claims = await claimsOf(e.path);
      expect(claims, e.path).toContain(e.summary_en);
      for (const n of numbers(e.summary_en).filter((x) => x.endsWith('%'))) expect(e.summary_zh, `${e.path} ${n}`).toContain(n);
      expect(e.keywords.length, e.path).toBeGreaterThanOrEqual(6);
    }
  });

  it('"个人 AI 持续使用" finds S01 (Pew) and "cross-device" finds S13 (Qira), among the first three', async () => {
    const index = await loadLibraryIndex(vault);
    const top = (q: string) => searchLibraryIndex(index, q, 3).map((h) => h.entry.title);
    expect(top('个人 AI 持续使用')).toContain('Pew 2026-06 Americans and AI 2026');
    expect(top('cross-device')).toContain('联想 2026-09 Qira扩展');
  });
});
