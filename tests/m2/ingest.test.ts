/** 2.5 / 2.6 — ingest a fetched page into 10_资料库, then add system-verified claims. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_INGEST_CHARS } from '@/lib/research/constants';
import { appendClaims, verifyQuotes } from '@/lib/research/claims';
import { ingestSource } from '@/lib/research/ingest';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from '../helpers/fixture-vault';

vi.setConfig({ testTimeout: 60_000 }); // temp-dir vaults under a loaded machine

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

const base = {
  derivedFrom: '[[20_项目/P/WS-A/workplan v1|workplan v1]]',
  relatesTo: '[[20_项目/P/WS-A/workspace|WS-A]]',
  now: new Date('2026-10-24T08:00:00Z'),
  checkLink: async () => true,
};
const PAGE = 'IDC 报告指出：2026 年中国企业 AI PC 渗透率达到 32%。\n\n调研显示，IT 部门是主要的预算来源。\nThe quick brown fox.';

describe('ingestSource', () => {
  it('writes a schema-valid, graded source note into 10_资料库', async () => {
    const r = await ingestSource({
      ...base,
      vault,
      url: 'https://www.idc.com/getdoc.jsp?containerId=1',
      title: 'IDC：中国 AI PC 市场追踪',
      content: PAGE,
      siteName: 'IDC',
      date: '2026-09-15T00:00:00Z',
      authority: 4,
    });
    expect(r).toMatchObject({ deduped: false, grade: 'B', link_checked: true });
    expect(r.path.startsWith('10_资料库/')).toBe(true);
    const n = await vault.read(r.path);
    expect(n.issues).toEqual([]);
    expect(n.data).toMatchObject({
      type: 'source',
      origin: '网络',
      grade: 'B',
      graded_by: 'AI',
      status: '推断',
      author: 'AI',
      authority: 4,
      link_checked: true,
      publisher: 'IDC',
      published: '2026-09-15',
      retrieved: '2026-10-24',
    });
    expect(n.body).toContain('## 论断');
    expect(n.body).toContain('IT 部门是主要的预算来源'); // the fetched text is kept so claims can be verified later
  });

  it('dedupes by URL (ignoring #hash, utm_*, trailing slash, case of host)', async () => {
    const first = await ingestSource({ ...base, vault, url: 'https://www.idc.com/a/b?id=1&utm_source=x', title: 'A', content: PAGE, authority: 3 });
    const again = await ingestSource({ ...base, vault, url: 'https://WWW.idc.com/a/b/?id=1#top', title: 'A again', content: PAGE, authority: 3 });
    expect(again).toMatchObject({ deduped: true, path: first.path });
    // an existing preset source with the same URL is reused too
    const preset = await ingestSource({ ...base, vault, url: 'https://example.com/a', title: '资料甲', content: PAGE, authority: 3 });
    expect(preset).toMatchObject({ deduped: true, path: '10_资料库/资料甲.md' });
  });

  it('a different URL with the same title gets a distinct note name', async () => {
    const a = await ingestSource({ ...base, vault, url: 'https://a.example.org/x', title: '同名/资料: 标题?', content: PAGE, authority: 2 });
    const b = await ingestSource({ ...base, vault, url: 'https://b.example.org/x', title: '同名/资料: 标题?', content: PAGE, authority: 2 });
    expect(a.path).not.toBe(b.path);
    expect(a.name).not.toMatch(/[\\/:?*"<>|]/);
    expect(await vault.exists(a.path)).toBe(true);
    expect(await vault.exists(b.path)).toBe(true);
  });

  it('rejects non-http(s) and private-network URLs', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://x.example.org/a', 'http://localhost:3000/a', 'http://127.0.0.1/a', 'http://192.168.1.2/a', 'http://10.0.0.1/a']) {
      await expect(ingestSource({ ...base, vault, url, title: 'x', content: PAGE, authority: 1 })).rejects.toThrow();
    }
  });

  it('records link_checked=false when the link check fails or throws; never fails the ingest', async () => {
    const a = await ingestSource({ ...base, vault, url: 'https://c.example.org/1', title: 'C1', content: PAGE, authority: 1, checkLink: async () => false });
    const b = await ingestSource({
      ...base,
      vault,
      url: 'https://c.example.org/2',
      title: 'C2',
      content: PAGE,
      authority: 1,
      checkLink: async () => {
        throw new Error('boom');
      },
    });
    expect(a.link_checked).toBe(false);
    expect(b.link_checked).toBe(false);
    expect((await vault.read(b.path)).data.link_checked).toBe(false);
  });

  it('truncates very long pages and neutralises trailing ^markers inside the page text', async () => {
    const long = `${'字'.repeat(MAX_INGEST_CHARS + 5000)}\n网页里的一行 ^c7`;
    const r = await ingestSource({ ...base, vault, url: 'https://d.example.org/long', title: 'Long', content: long, authority: 1 });
    const n = await vault.read(r.path);
    expect(n.body.length).toBeLessThan(MAX_INGEST_CHARS + 2000);
    const page = `${'x'.repeat(10)}\n网页里的一行 ^c7`;
    const r2 = await ingestSource({ ...base, vault, url: 'https://d.example.org/marker', title: 'Marker', content: page, authority: 1 });
    expect((await vault.getBlocks(r2.path)).has('c7')).toBe(false); // page text must not forge a citable block
  });
});

describe('verifyQuotes', () => {
  const content = 'IDC 报告指出：2026 年中国企业 AI PC 渗透率达到 32%。\n\n调研显示，IT 部门是主要的\n预算来源。';
  it('keeps quotes that appear in the content, ignoring whitespace and punctuation', () => {
    const r = verifyQuotes(content, [
      { quote: '2026年中国企业AI PC渗透率达到32%', location: '第 1 段' },
      { quote: '调研显示 IT 部门是主要的预算来源' }, // spans a line break in the source
    ]);
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toHaveLength(0);
  });
  it('drops quotes that are not in the content, are too short, or repeat', () => {
    const r = verifyQuotes(content, [
      { quote: '2027 年渗透率将达到 60%' }, // invented
      { quote: '32%' }, // too short to prove anything
      { quote: '调研显示，IT 部门是主要的预算来源。' },
      { quote: '调研显示 IT 部门是主要的预算来源' }, // duplicate after normalisation
      { quote: '' },
    ]);
    expect(r.kept.map((c) => c.quote)).toEqual(['调研显示，IT 部门是主要的预算来源。']);
    expect(r.dropped.map((d) => d.reason).sort()).toEqual(['duplicate', 'not_found', 'too_short', 'too_short']);
  });
});

describe('appendClaims', () => {
  it('adds `「原文」— 位置：… ^cN` lines under ## 论断, numbering on from the existing blocks', async () => {
    const added = await appendClaims(vault, '10_资料库/资料甲.md', [
      { quote: '补充论断：采购决策由 CIO 牵头。', location: 'p.9' },
      { quote: '另一句原文。', location: '' },
    ]);
    expect(added.map((a) => a.id)).toEqual(['c4', 'c5']); // 资料甲 already has c1..c3 (c9 is inside a code fence)
    const blocks = await vault.getBlocks('10_资料库/资料甲.md');
    expect(blocks.get('c4')?.text).toContain('采购决策由 CIO 牵头');
    expect(blocks.get('c4')?.text).toContain('位置：p.9');
    const check = await vault.checkCitation('[[资料甲#^c4]]', { quote: '采购决策由 CIO 牵头' });
    expect(check.ok).toBe(true);
    // the note still validates and the old claims are untouched
    const n = await vault.read('10_资料库/资料甲.md');
    expect(n.issues).toEqual([]);
    expect(blocks.get('c1')?.text).toContain('IT 可管理性');
  });

  it('works on a freshly ingested note and does nothing for an empty list', async () => {
    const r = await ingestSource({ ...base, vault, url: 'https://e.example.org/p', title: 'E', content: PAGE, authority: 1 });
    expect(await appendClaims(vault, r.path, [])).toEqual([]);
    const added = await appendClaims(vault, r.path, [{ quote: '调研显示，IT 部门是主要的预算来源。', location: '第 2 段' }]);
    expect(added[0].id).toBe('c1');
    expect((await vault.checkCitation(`[[${r.path.replace(/\.md$/, '')}#^c1]]`, { quote: 'IT 部门是主要的预算来源' })).ok).toBe(true);
  });
});
