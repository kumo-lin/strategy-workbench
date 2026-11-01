/**
 * One metered web client per research folder, so the search / fetch budget
 * (PRD §9.6) holds no matter which path calls web_search — the code
 * orchestrator or a chat turn in the execute phase.
 */
import type { WebToolsClient } from '@/lib/deepseek/web-tools';
import type { ToolContext } from '@/lib/harness/types';
import { RESEARCH_LIMITS, type ResearchMode } from './constants';
import { createResilientWebClient, type MeteredWebClient } from './web-client';

const clients = new Map<string, MeteredWebClient>();

/** Start a run: a fresh client (and budget) for this research folder. */
export function startRunClient(researchDir: string, inner: WebToolsClient, mode: ResearchMode): MeteredWebClient {
  const limits = RESEARCH_LIMITS[mode];
  const client = createResilientWebClient(inner, {
    budget: { maxSearches: limits.maxSearches, maxFetches: limits.maxFetches },
    // The live small run has a ~2 minute target: a hung page must not eat a minute (measured 10/24: 30 s timeout + retry = 62 s).
    ...(mode === 'small' ? { searchTimeoutMs: 15_000, fetchTimeoutMs: 20_000, maxRetries: 1 } : {}),
  });
  clients.set(researchDir, client);
  return client;
}

/** The client web tools must use for this context (created with the full-mode budget if no run registered one). */
export async function runClientFor(ctx: ToolContext): Promise<MeteredWebClient> {
  const dir = ctx.research?.dir ?? '';
  let c = clients.get(dir);
  if (!c) {
    // Outside a run, respect the context's client (ctx.webTools, CONTRACTS §4.2). The executor registers the lenient one.
    c = createResilientWebClient(await ctx.webTools(), {
      budget: { maxSearches: RESEARCH_LIMITS.full.maxSearches, maxFetches: RESEARCH_LIMITS.full.maxFetches },
    });
    clients.set(dir, c);
  }
  return c;
}

export function clearRunClient(researchDir: string): void {
  clients.delete(researchDir);
}
