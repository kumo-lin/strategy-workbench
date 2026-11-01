/** Search results carry `#1` anchors (sometimes `#1#1#1`): they must not reach the fetch, the stored url, or defeat dedupe. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTool } from '@/lib/harness';
import { cleanUrl, ingestSource, normalizeUrl } from '@/lib/research/ingest';
import { clearPageCache } from '@/lib/research/page-cache';
import { clearRunClient, startRunClient } from '@/lib/research/run-client';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, setup } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

describe('cleanUrl', () => {
  it('drops #anchors (even #1#1#1) and tracking parameters, keeps the rest as written', () => {
    expect(cleanUrl('https://kn.itmedia.co.jp/kn/article/1/2#1')).toBe('https://kn.itmedia.co.jp/kn/article/1/2');
    expect(cleanUrl('https://a.example.org/x/#1#1#1')).toBe('https://a.example.org/x/');
    expect(cleanUrl('https://a.example.org/p?id=7&utm_source=x&fbclid=y&spm=z#top')).toBe('https://a.example.org/p?id=7');
    expect(cleanUrl('https://A.example.org/Path?Q=1')).toBe('https://a.example.org/Path?Q=1');
    expect(cleanUrl('not a url')).toBe('not a url');
  });
});

describe('ingest stores the clean url and still dedupes against old anchored ones', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, cleanup } = await makeFixtureVault());
  });
  afterEach(async () => cleanup());
  const base = { derivedFrom: '[[20_项目/P/WS-A/workplan v1|workplan v1]]', relatesTo: '[[20_项目/P/WS-A/workspace|WS-A]]', checkLink: async () => true, authority: 1, content: '正文内容足够长的一段话，用来测试。' };

  it('url in the note has no anchor; a later anchored link to the same page is a duplicate', async () => {
    const a = await ingestSource({ ...base, vault, url: 'https://news.example.org/a/1#1#1', title: 'A' });
    expect((await vault.read(a.path)).data.url).toBe('https://news.example.org/a/1');
    const b = await ingestSource({ ...base, vault, url: 'https://news.example.org/a/1#2', title: 'A again' });
    expect(b).toMatchObject({ deduped: true, path: a.path });
  });

  it('a legacy note whose stored url still has the anchor is matched too', async () => {
    await vault.write('10_资料库/旧资料.md', {
      frontmatter: {
        id: 'src-old', type: 'source', status: '推断', created: '2026-10-24', updated: '2026-10-24', author: 'AI',
        derived_from: ['[[团队]]'], relates_to: ['[[团队]]'], url: 'https://old.example.org/p#1', publisher: 'x', published: null,
        retrieved: '2026-10-24', origin: '网络', grade: 'C', graded_by: 'AI', authority: 1, link_checked: true,
      },
      body: '# 旧\n',
    });
    const r = await ingestSource({ ...base, vault, url: 'https://old.example.org/p', title: 'x' });
    expect(r).toMatchObject({ deduped: true, path: '10_资料库/旧资料.md' });
    expect(normalizeUrl('https://old.example.org/p#1')).toBe(normalizeUrl('https://old.example.org/p'));
  });
});

describe('web tools never send an anchor', () => {
  it('web_search returns clean urls and web_fetch calls the API without the anchor', async () => {
    const fx = await setup({ approved: true });
    clearPageCache();
    const web = fakeWeb();
    const origSearch = web.search.bind(web);
    web.search = async (req, signal) => {
      const r = await origSearch(req, signal);
      return { results: r.results.map((x) => ({ ...x, url: `${x.url}#1#1` })) };
    };
    startRunClient(RDIR, web, 'full');
    try {
      const out = (await executeTool('web_search', { sub_question_id: 'C1-Q1', query: 'x' }, fx.ctx)) as { results: { url: string }[] };
      expect(out.results.every((r) => !r.url.includes('#'))).toBe(true);
      await executeTool('web_fetch', { sub_question_id: 'C1-Q1', url: `${out.results[0].url}#1#1` }, fx.ctx);
      expect(web.fetches[0]).toBe(out.results[0].url);
    } finally {
      clearRunClient(RDIR);
      await fx.cleanup();
    }
  });
});
