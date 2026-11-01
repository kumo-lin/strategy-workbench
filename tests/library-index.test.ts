/**
 * Bilingual library index: tokenizer, search, index loading, model-answer parsing, and the build worker pool.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIndex,
  LIBRARY_INDEX_PATH,
  loadLibraryIndex,
  parseIndexEntry,
  searchLibraryIndex,
  tokenizeQuery,
  type LibraryIndex,
  type LibraryIndexEntry,
  type LibraryIndexFile,
} from '@/lib/vault/library-index';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from './helpers/fixture-vault';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

const ENTRY: LibraryIndexEntry[] = [
  {
    path: '10_资料库/Gartner 2025-08 AI PC 份额预测.md',
    title: 'Gartner 2025-08 AI PC 份额预测',
    summary_zh: 'Gartner 预测 2025 年 AI PC 占全球 PC 出货 31%',
    summary_en: 'Gartner forecasts AI PCs at 31% of worldwide PC shipments in 2025',
    keywords: ['Gartner', 'AI PC 份额', 'AI PC share', 'shipments', '出货量'],
    generated_at: '2026-10-27T00:00:00.000Z',
  },
  {
    path: '10_资料库/Dell 2026-08 IT负责人谈AI PC硬件安全.md',
    title: 'Dell 2026-08 IT负责人谈AI PC硬件安全',
    summary_zh: 'Dell 调研：IT 负责人买 AI PC 最看重硬件安全和可管理性',
    summary_en: 'Dell survey: IT leaders rank hardware security and manageability first when buying AI PCs',
    keywords: ['Dell', 'IT 可管理性', 'manageability', '企业采购', 'enterprise procurement'],
    generated_at: '2026-10-27T00:00:00.000Z',
  },
  {
    path: '10_资料库/The Register 2026-02 Memory prices.md',
    title: 'The Register 2026-02 Memory prices',
    summary_zh: '内存涨价使 PC 厂商推迟 AI PC 配置升级',
    summary_en: 'Memory price hikes make PC vendors delay AI PC upgrades',
    keywords: ['The Register', 'DRAM', '内存涨价', 'memory prices'],
    generated_at: '2026-10-27T00:00:00.000Z',
  },
  {
    path: '10_资料库/IDC 2026-05 中国商用PC.md',
    title: 'IDC 2026-05 中国商用PC',
    summary_zh: 'IDC：中国商用 PC 换机周期拉长',
    summary_en: 'IDC: China commercial PC refresh cycles are lengthening',
    keywords: ['IDC', '换机周期', 'refresh cycle', 'commercial PC'],
    generated_at: '2026-10-27T00:00:00.000Z',
  },
];

const index: LibraryIndex = { version: 1, generated_at: '2026-10-27T00:00:00.000Z', entries: ENTRY };

async function fixtureWithIndex(entries = ENTRY): Promise<{ root: string; vault: Vault }> {
  const { vault, root, cleanup } = await makeFixtureVault();
  cleanups.push(cleanup);
  await writeFile(path.join(root, LIBRARY_INDEX_PATH), JSON.stringify({ version: 1, generated_at: '2026-10-27T00:00:00.000Z', entries }), 'utf8');
  return { root, vault };
}

describe('tokenizeQuery', () => {
  it('6a. splits Chinese into bigrams, skips particles, and keeps latin words and numbers', () => {
    const tokens = tokenizeQuery('企业买单的首要条件是 IT 能管');
    expect(tokens).toEqual(expect.arrayContaining(['企业', '买单', '首要', '条件', '能管', 'it']));
    expect(tokens.filter((t) => t.includes('的') || t.includes('是'))).toEqual([]);
  });

  it('6b. drops English stop words and one-character latin runs', () => {
    expect(tokenizeQuery('The 2026 AI PC')).toEqual(['2026', 'ai', 'pc']);
    expect(tokenizeQuery('a I')).toEqual([]);
  });

  it('6c. blank queries produce no tokens', () => {
    expect(tokenizeQuery('')).toEqual([]);
    expect(tokenizeQuery('   ')).toEqual([]);
  });
});

describe('searchLibraryIndex', () => {
  it('1. a Chinese query finds a note with an English title', () => {
    const hits = searchLibraryIndex(index, '企业买单的首要条件是 IT 能管');
    expect(hits[0]?.entry.path).toBe('10_资料库/Dell 2026-08 IT负责人谈AI PC硬件安全.md');
    expect(hits[0]?.matched.length).toBeGreaterThan(0);
  });

  it('2. English and Chinese queries both find the English-titled note', () => {
    const english = searchLibraryIndex(index, 'memory prices delay AI PC');
    expect(english[0]?.entry.path).toBe('10_资料库/The Register 2026-02 Memory prices.md');
    const chinese = searchLibraryIndex(index, '内存涨价');
    expect(chinese[0]?.entry.path).toBe('10_资料库/The Register 2026-02 Memory prices.md');
  });

  it('3. English queries find notes with Chinese titles', () => {
    expect(searchLibraryIndex(index, 'manageability hardware security')[0]?.entry.path).toBe(
      '10_资料库/Dell 2026-08 IT负责人谈AI PC硬件安全.md',
    );
    expect(searchLibraryIndex(index, 'refresh cycle')[0]?.entry.path).toBe('10_资料库/IDC 2026-05 中国商用PC.md');
  });

  it('4. no match, blank query, and limit', () => {
    expect(searchLibraryIndex(index, '量子计算')).toEqual([]);
    expect(searchLibraryIndex(index, '   ')).toEqual([]);
    expect(searchLibraryIndex(index, 'AI PC', 1)).toHaveLength(1);
  });

  it('5. ranks the best match first and breaks ties by path', () => {
    const hits = searchLibraryIndex(index, 'AI PC 份额 Gartner');
    expect(hits[0]?.entry.path).toBe('10_资料库/Gartner 2025-08 AI PC 份额预测.md');
    expect(hits[0]?.score).toBe(Math.max(...hits.map((h) => h.score)));

    const same = (p: string): LibraryIndexEntry => ({
      ...ENTRY[0],
      path: p,
      title: 'Same text',
      summary_zh: '同样的一段话',
      summary_en: 'The same text',
      keywords: ['same', 'AI', 'pc'],
    });
    const tied = searchLibraryIndex({ version: 1, generated_at: '', entries: [same('10_资料库/b.md'), same('10_资料库/a.md')] }, 'same');
    expect(tied.map((h) => h.entry.path)).toEqual(['10_资料库/a.md', '10_资料库/b.md']);
  });
});

describe('loadLibraryIndex', () => {
  it('7. missing, invalid, wrong-shape and valid files', async () => {
    const { vault, root } = await fixtureWithIndex();
    expect((await loadLibraryIndex(vault)).entries).toHaveLength(ENTRY.length);

    await writeFile(path.join(root, LIBRARY_INDEX_PATH), 'not json', 'utf8');
    expect(await loadLibraryIndex(vault)).toEqual({ version: 1, generated_at: '', entries: [] });

    await writeFile(path.join(root, LIBRARY_INDEX_PATH), '{"entries":3}', 'utf8');
    expect((await loadLibraryIndex(vault)).entries).toEqual([]);

    await writeFile(path.join(root, LIBRARY_INDEX_PATH), '{"version":2,"generated_at":"","entries":[]}', 'utf8');
    expect((await loadLibraryIndex(vault)).entries).toEqual([]);
  });

  it('7b. no file at all never throws', async () => {
    const { vault, cleanup } = await makeFixtureVault();
    cleanups.push(cleanup);
    expect((await loadLibraryIndex(vault)).entries).toEqual([]);
  });
});

describe('parseIndexEntry', () => {
  const valid = {
    summary_zh: 'Gartner 预测 2025 年 AI PC 占全球 PC 出货 31%',
    summary_en: 'Gartner forecasts AI PCs at 31% of worldwide PC shipments in 2025',
    keywords: ['Gartner', 'AI PC 份额', 'AI PC share', 'shipments', '出货量', '31%'],
  };
  const withKeywords = (keywords: string[]) => JSON.stringify({ ...valid, keywords });

  it('8a. accepts bare JSON, a fenced answer, and prose around it', () => {
    expect(parseIndexEntry(JSON.stringify(valid))).toEqual(valid);
    expect(parseIndexEntry('```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid);
    expect(parseIndexEntry('Here you go:\n' + JSON.stringify(valid) + '\nDone.')).toEqual(valid);
  });

  it('8b. rejects too few keywords or a missing summary', () => {
    expect(parseIndexEntry(withKeywords(['a', 'b', 'c', 'd', 'e']))).toBeNull();
    expect(parseIndexEntry(JSON.stringify({ summary_zh: valid.summary_zh, keywords: valid.keywords }))).toBeNull();
    expect(parseIndexEntry(JSON.stringify({ ...valid, summary_en: '   ' }))).toBeNull();
    expect(parseIndexEntry(JSON.stringify({ ...valid, keywords: 'x' }))).toBeNull();
    expect(parseIndexEntry('no json here')).toBeNull();
  });

  it('8c. trims, collapses newlines, dedupes case-insensitively and keeps at most 12 keywords', () => {
    const deduped = parseIndexEntry(withKeywords([' DRAM ', 'dram', 'a', 'b', 'c', 'd', 'e']));
    expect(deduped?.keywords).toEqual(['DRAM', 'a', 'b', 'c', 'd', 'e']);

    const many = parseIndexEntry(withKeywords(Array.from({ length: 14 }, (_, i) => `k${i}`)));
    expect(many?.keywords).toHaveLength(12);

    const spaced = parseIndexEntry(JSON.stringify({ ...valid, summary_zh: '  a\nb  ', summary_en: ' c\nd ' }));
    expect(spaced).toEqual({ summary_zh: 'a b', summary_en: 'c d', keywords: valid.keywords });
  });
});

describe('buildIndex', () => {
  const file = (name: string): LibraryIndexFile => ({ path: `10_资料库/${name}.md`, title: name, prompt: name });
  const answer = (zh: string) =>
    JSON.stringify({ summary_zh: zh, summary_en: 'English summary', keywords: ['a', 'b', 'c', 'd', 'e', 'f'] });

  it('9a. sorts entries by path when every note succeeds', async () => {
    const result = await buildIndex([file('b'), file('a')], async (f) => answer(f.title));
    expect(result.failed).toEqual([]);
    expect(result.entries.map((e) => e.path)).toEqual(['10_资料库/a.md', '10_资料库/b.md']);
    expect(result.entries[0]?.generated_at).toEqual(expect.any(String));
  });

  it('9b. retries a note once when the first answer does not parse', async () => {
    const calls = new Map<string, number>();
    const generate = async (f: LibraryIndexFile) => {
      const n = (calls.get(f.path) ?? 0) + 1;
      calls.set(f.path, n);
      return n === 1 ? 'not json' : answer('ok');
    };
    const result = await buildIndex([file('a')], generate);
    expect(result.failed).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(calls.get('10_资料库/a.md')).toBe(2);
  });

  it('9c. a note that never parses is failed, the others are kept', async () => {
    const result = await buildIndex([file('a'), file('b')], async (f) =>
      f.title === 'a' ? 'not json' : answer('ok'),
    );
    expect(result.entries.map((e) => e.path)).toEqual(['10_资料库/b.md']);
    expect(result.failed.map((f) => f.path)).toEqual(['10_资料库/a.md']);
    expect(result.failed[0]?.error).toEqual(expect.any(String));
  });

  it('9d. a throwing call is retried once and then counted as failed', async () => {
    let calls = 0;
    const result = await buildIndex([file('a')], async () => {
      calls += 1;
      throw new Error('provider is down');
    });
    expect(result.entries).toEqual([]);
    expect(calls).toBe(2);
    expect(result.failed).toEqual([{ path: '10_资料库/a.md', error: 'provider is down' }]);
  });

  it('9e. never runs more than the configured number of calls at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const files = Array.from({ length: 9 }, (_, i) => file(`n${i}`));
    const generate = async (f: LibraryIndexFile) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 5));
        return answer(f.title);
      } finally {
        inFlight -= 1;
      }
    };
    const result = await buildIndex(files, generate, { concurrency: 3 });
    expect(result.entries).toHaveLength(9);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
