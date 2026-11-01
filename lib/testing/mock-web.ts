/**
 * Deterministic stand-in for DeepSeek Search / Fetch, selected by `WEB_TOOLS=mock`
 * (see lib/deepseek/index.ts). E2E only: nothing here is reachable without that env var.
 *
 * Results depend only on the query / URL (never on call order), so parallel sub-questions
 * and re-runs give the same pages. Each page holds one supporting and one refuting
 * sentence, like the vitest fake in tests/m2/research-fixture.ts.
 */
import type { SearchResult, WebToolsClient } from '@/lib/deepseek/web-tools';
import { m1WebPageByUrl, m1WebPages } from './scripts/m1';

/**
 * The mock pages "live" on `<n>.mock-web.test` (a reserved TLD: it can never resolve). ingest_source's
 * link check does a real `fetch` of the page URL, so the first mock client wraps `globalThis.fetch` to
 * answer 200 for these hosts and leave every other request alone.
 */
const MOCK_HOST = /\.mock-web\.test$/;

function answerMockLinkChecks(): void {
  const g = globalThis as typeof globalThis & { __mockWebFetch?: true };
  if (g.__mockWebFetch) return;
  g.__mockWebFetch = true;
  const real = g.fetch.bind(g);
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // D-64 T54: the M1 script's two public pages answer too (their real URLs, served from tests/fixtures/mock-web)
    return MOCK_HOST.test(new URL(url).hostname) || m1WebPageByUrl(url) ? Promise.resolve(new Response('mock page', { status: 200 })) : real(input, init);
  }) as typeof fetch;
}

function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h;
}

export function createMockWebClient(): WebToolsClient {
  answerMockLinkChecks();
  return {
    async search({ query }) {
      const m1 = m1WebPages(query);
      if (m1) return { results: m1.map((p, i) => ({ url: p.url, title: p.title, site_name: p.site_name, date: p.date, summary: p.content.slice(0, 120), rerank_score: 0.9 - i * 0.1, authority: 3 })) };
      const seed = hash(query) % 900;
      const results: SearchResult[] = [0, 1, 2].map((i) => {
        const k = seed * 3 + i + 100;
        return {
          url: `https://${k}.mock-web.test/report/${k}`,
          title: `报告 ${k}`,
          site_name: `研究机构${k}`,
          date: '2026-09-01T00:00:00Z',
          summary: `摘要 ${k}`,
          rerank_score: 0.9 - i * 0.1,
          authority: 3,
        };
      });
      return { results };
    },
    async fetch({ url }) {
      const page = m1WebPageByUrl(url);
      if (page) return { title: page.title, content: page.content };
      const k = /report\/(\d+)/.exec(url)?.[1] ?? '0';
      const lines = [
        `调研显示，第 ${k} 组企业里 IT 部门主导了 AI PC 的采购决策。`,
        '另有调查认为，员工并不在乎 NPU，换机主要由系统停止支持推动。',
      ];
      return { title: `报告 ${k}`, content: lines.join('\n\n') };
    },
  };
}
