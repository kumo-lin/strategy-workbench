/**
 * web_search / web_fetch / ingest_source — research_execute only (PRD §6.3.1
 * step 3, §10.2). OWNER: M2.
 *
 * M0 contract:
 *   - web_search must name a sub-question id from the APPROVED plan
 *     (`assertSubQuestionInPlan`), so search stays inside the plan (§10.2
 *     "只限计划里列出的子问题").
 *   - Results may not be cited until ingested into 10_资料库 (§7 rule 5).
 * M2 replaces the bodies below and implements ingest_source.
 */
import { z } from 'zod';
import { MAX_FETCH_CHARS_FOR_MODEL } from '@/lib/research/constants';
import { unescapeMarkdown } from '@/lib/research/page-text';
import { gradeSource } from '@/lib/research/grading';
import { cleanUrl, ingestSource } from '@/lib/research/ingest';
import { recallPage, rememberPage, rememberSearchResult } from '@/lib/research/page-cache';
import { runClientFor } from '@/lib/research/run-client';
import { isPlanApproved } from '../phases';
import { ToolNotAllowedError, type ToolContext, type ToolSpec } from '../types';

export function assertSubQuestionInPlan(ctx: ToolContext, subQuestionId: string): void {
  const plan = ctx.research?.plan ?? null;
  if (!plan || !isPlanApproved(plan)) {
    throw new ToolNotAllowedError('web_search', ctx.phase, 'research plan is not approved');
  }
  const ids = plan.claims.flatMap((c) => c.sub_questions.map((q) => q.id));
  if (!ids.includes(subQuestionId)) {
    throw new ToolNotAllowedError('web_search', ctx.phase, `sub-question ${subQuestionId} is not in the approved plan (${ids.join(', ')})`);
  }
}

export const webSearchParameters = z.object({
  sub_question_id: z.string().describe('The plan sub-question this search answers, e.g. "C1-Q2".'),
  query: z.string().min(1),
  count: z.number().int().min(1).max(10).default(5),
});

export const webSearchTool: ToolSpec<typeof webSearchParameters> = {
  name: 'web_search',
  description:
    'Search the web for a gap the vault could not fill. Only for sub-questions in the approved plan. Results are leads, not evidence: ingest a source before citing it.',
  parameters: webSearchParameters,
  owner: 'M2',
  implemented: true,
  async execute({ sub_question_id, query, count }, ctx) {
    assertSubQuestionInPlan(ctx, sub_question_id);
    const client = await runClientFor(ctx);
    const { results } = await client.search({ query, count, need_content: false }, ctx.abortSignal);
    return {
      results: results.map((r) => {
        const row = {
          url: cleanUrl(r.url),
          title: r.title,
          site_name: r.site_name,
          date: r.date ?? null,
          authority: r.authority,
          rerank_score: r.rerank_score,
          summary: r.summary.slice(0, 600),
        };
        rememberSearchResult(row);
        return { ...row, grade_hint: gradeSource({ url: r.url, authority: r.authority }).grade };
      }),
    };
  },
  summarize: (a) => `联网搜索 [${a.sub_question_id}]「${a.query}」`,
};

export const webFetchParameters = z.object({
  sub_question_id: z.string(),
  url: z.url(),
});

export const webFetchTool: ToolSpec<typeof webFetchParameters> = {
  name: 'web_fetch',
  description: 'Read one web page found by web_search.',
  parameters: webFetchParameters,
  owner: 'M2',
  implemented: true,
  async execute({ sub_question_id, url }, ctx) {
    assertSubQuestionInPlan(ctx, sub_question_id);
    const client = await runClientFor(ctx);
    const fetched = await client.fetch({ url: cleanUrl(url) }, ctx.abortSignal);
    const page = { title: fetched.title, content: unescapeMarkdown(fetched.content) };
    rememberPage({ url, title: page.title, content: page.content });
    return {
      url,
      title: page.title,
      content: page.content.slice(0, MAX_FETCH_CHARS_FOR_MODEL),
      truncated: page.content.length > MAX_FETCH_CHARS_FOR_MODEL,
    };
  },
  summarize: (a) => `抓取 [${a.sub_question_id}] ${a.url}`,
};

export const ingestSourceParameters = z.object({
  sub_question_id: z.string(),
  url: z.url(),
  name: z.string().describe('File name for the source note in 10_资料库 (no .md).'),
});

function noteLink(path: string): string {
  const noExt = path.replace(/\.md$/, '');
  return `[[${noExt}|${noExt.split('/').pop()}]]`;
}

export interface IngestSourceResult {
  path: string;
  name: string;
  deduped: boolean;
  grade: 'A' | 'B' | 'C';
  link_checked: boolean;
}

export const ingestSourceTool: ToolSpec<typeof ingestSourceParameters, IngestSourceResult> = {
  name: 'ingest_source',
  description:
    'Save a page you just read with web_fetch into 10_资料库 as a graded source note (graded by rule, status 推断). Deduplicated by URL. Only after this can the page be cited.',
  parameters: ingestSourceParameters,
  owner: 'M2',
  implemented: true,
  async execute({ sub_question_id, url, name }, ctx) {
    assertSubQuestionInPlan(ctx, sub_question_id);
    const page = recallPage(url);
    if (!page) throw new Error(`${url} was not fetched in this session: call web_fetch first`);
    const planPath = ctx.research?.planPath;
    if (!planPath) throw new Error('no research plan to derive the source from');
    return ingestSource({
      vault: ctx.vault,
      url,
      title: page.meta?.title || page.title || name,
      content: page.content,
      siteName: page.meta?.site_name ?? null,
      date: page.meta?.date ?? null,
      authority: page.meta?.authority ?? null,
      name,
      derivedFrom: noteLink(planPath),
      relatesTo: noteLink(`${ctx.workspacePath}/workspace`),
      fetchedIn: ctx.research?.dir,
      now: ctx.now(),
    });
  },
  summarize: (a, r) => `入库 [${a.sub_question_id}] ${r ? `${r.deduped ? '已有 ' : ''}${r.path}（${r.grade} 级）` : a.url}`,
};
