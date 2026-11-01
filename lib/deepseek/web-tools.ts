/**
 * DeepSeek Search & Fetch (PRD §6.3.1 step 3, §10.5 联网).
 *   POST {base}/v1/tools/search  { query, count, need_content }
 *   POST {base}/v1/tools/fetch   { url }
 * Response shapes were checked against the live API on 2026-10-24.
 *
 * M0 ships the types and a thin client. Result handling (ingest into
 * 10_资料库, grading, restricting queries to plan sub-questions) is M2's.
 *
 * CONTRACT (frozen after M0).
 */
import { z } from 'zod';

export const searchRequestSchema = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(20).default(5),
  /** true → each result carries full page `content`. */
  need_content: z.boolean().default(false),
});
export type SearchRequest = z.input<typeof searchRequestSchema>;

export const searchResultSchema = z.looseObject({
  url: z.string(),
  // The live API sometimes sends null for these (seen 10/24); normalize so one
  // bad result does not fail the whole search (CONTRACT-CHANGE m2-1).
  title: z.string().nullish().transform((v) => v ?? ''),
  site_name: z.string().nullish().transform((v) => v ?? ''),
  site_icon: z.string().nullish(),
  /** ISO datetime of the page, when known. */
  date: z.string().nullable().optional(),
  summary: z.string().nullish().transform((v) => v ?? ''),
  snippet: z.string().optional(),
  rerank_score: z.number().nullish().transform((v) => v ?? 0),
  /** Site authority score from DeepSeek (integer; observed 1–5 scale, 3 typical). */
  authority: z.number().nullish().transform((v) => v ?? 0),
  /** Empty unless need_content = true. */
  content: z.string().optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({ results: z.array(searchResultSchema) });
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const fetchRequestSchema = z.object({ url: z.url() });
export type FetchRequest = z.infer<typeof fetchRequestSchema>;

export const fetchResponseSchema = z.looseObject({
  title: z.string(),
  /** Page text as markdown-ish plain text. */
  content: z.string(),
});
export type FetchResponse = z.infer<typeof fetchResponseSchema>;

export interface WebToolsClient {
  search(req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
  fetch(req: FetchRequest, signal?: AbortSignal): Promise<FetchResponse>;
}

export class WebToolsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WebToolsError';
  }
}

export function createWebToolsClient(opts: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }): WebToolsClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new WebToolsError(res.status, `${path} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    return schema.parse(await res.json());
  }

  return {
    search: (req, signal) => post('/v1/tools/search', searchRequestSchema.parse(req), searchResponseSchema, signal),
    fetch: (req, signal) => post('/v1/tools/fetch', fetchRequestSchema.parse(req), fetchResponseSchema, signal),
  };
}
