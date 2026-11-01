/**
 * Short-lived, process-local memory of what web_search / web_fetch returned, so
 * `ingest_source` can store a page without fetching it a second time (a second
 * fetch would also burn the fetch budget). Keyed by normalised URL.
 */
import { normalizeUrl } from './ingest';

export interface SearchMeta {
  url: string;
  title: string;
  site_name: string;
  date: string | null;
  authority: number | null;
  rerank_score: number;
  summary: string;
}

export interface CachedPage {
  url: string;
  title: string;
  content: string;
  meta?: SearchMeta;
  fetchedAt: number;
}

const MAX_ENTRIES = 200;
const TTL_MS = 60 * 60 * 1000;

const searchMeta = new Map<string, SearchMeta>();
const pages = new Map<string, CachedPage>();

function evict<V>(m: Map<string, V>) {
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value as string);
}

export function rememberSearchResult(meta: SearchMeta): void {
  searchMeta.set(normalizeUrl(meta.url), meta);
  evict(searchMeta);
}

export function rememberPage(page: { url: string; title: string; content: string }): void {
  const key = normalizeUrl(page.url);
  pages.set(key, { ...page, meta: searchMeta.get(key), fetchedAt: Date.now() });
  evict(pages);
}

export function recallPage(url: string): CachedPage | undefined {
  const key = normalizeUrl(url);
  const p = pages.get(key);
  if (!p) return undefined;
  if (Date.now() - p.fetchedAt > TTL_MS) {
    pages.delete(key);
    return undefined;
  }
  return { ...p, meta: p.meta ?? searchMeta.get(key) };
}

export function clearPageCache(): void {
  searchMeta.clear();
  pages.clear();
}
