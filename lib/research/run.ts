/**
 * The mutable state of one Deep Research run and the gathering steps that use it
 * (PRD §6.3.1 steps 2–7). Every tool call goes through `executeTool`, so the phase
 * check and the log row happen as for any other tool call; the model is only asked
 * for JSON in the fixed places listed in prompts/research-execute.ts.
 */
import type { LanguageModel } from 'ai';
import type { z } from 'zod';
import { executeTool } from '@/lib/harness/registry';
import type { ToolName } from '@/lib/harness/phases';
import {
  evaluatePrompt,
  extractPrompt,
  queryPlanPrompt,
  type ClaimBrief,
  type EvalCandidate,
  type QueryFocus,
  type SubQuestionBrief,
} from '@/lib/harness/prompts/research-execute';
import type { ToolContext } from '@/lib/harness/types';
import type { ResearchPlanNote } from '@/lib/notes/schema';
import { appendClaims, verifyQuotes } from './claims';
import { EVAL_CALL_TIMEOUT_MS, RESEARCH_LIMITS, MAX_INGEST_CHARS, type ResearchLimits, type ResearchMode } from './constants';
import { expertAnswerRelevant, GRADE_RANK, isExpert, originLabel, stopReason, type Evidence, type EvidenceRound, type StopReason } from './evidence';
import { normalizeUrl } from './ingest';
import { llmJson, LlmTimeoutError } from './llm';
import { roleOfTask } from './model-role';
import { recallPage } from './page-cache';
import { clipForUi, STOP_CARD, type Emit } from './progress';
import { evaluationSchema, extractionSchema, queryPlanSchema, type QueryPlan } from './schemas';
import { buildUrlIndex, claimBlocksOf, loadSourceInfo, type EvidenceDraft, type SourceInfo } from './sources';
import type { MeteredWebClient } from './web-client';
import { RUN_LOG_ACTIONS, runTag } from './job';
import { toFullSentence } from './quote-span';
import { conditionText, hypothesisLabel } from './question-tree';
import { nonContentReason } from './page-screen';
import { normalizeForQuote } from '@/lib/vault/blocks';

export type PlanClaim = ResearchPlanNote['claims'][number];
export type PlanSubQuestion = PlanClaim['sub_questions'][number];

export type SpanKind = 'llm' | 'search' | 'fetch' | 'ingest' | 'vault' | 'other';
/** One timed call (model or tool). Spans overlap when sub-questions run in parallel, so sums can exceed wall time. */
export interface Span {
  kind: SpanKind;
  label: string;
  ms: number;
}
export interface StepTiming {
  id: string;
  step: number;
  title: string;
  ms: number;
}
export interface RunTiming {
  byKind: Record<string, { n: number; ms: number }>;
  llmByTask: Record<string, { n: number; ms: number }>;
  steps: StepTiming[];
}

const TOOL_KIND: Partial<Record<ToolName, SpanKind>> = {
  web_search: 'search',
  web_fetch: 'fetch',
  ingest_source: 'ingest',
  vault_search: 'vault',
  vault_read: 'vault',
  vault_list: 'vault',
};

/** What a round is called in the step list. */
export const ROUND_LABEL: Record<EvidenceRound, string> = { kb: '知识库', web1: '联网第 1 轮', counter: '反证轮', web2: '补缺轮' };

export interface SubState {
  claim: PlanClaim;
  q: PlanSubQuestion;
  webRounds: number;
  /** New evidence per web round (D63 §4); a round that read no page is not counted. */
  newByRound: number[];
  stop: StopReason | 'expert_only' | null;
  stopNote: string;
  tried: string[];
}


/**
 * DeepSeek Search has no language / region parameter (probed 10/24: language, lang, region, locale,
 * country are silently ignored), so pages in scripts the team does not read (kana, Hangul, Cyrillic)
 * are ranked last rather than filtered out.
 */
const STANCE_ZH = { supports: '支持', refutes: '反驳', irrelevant: '无关' } as const;

export function isForeignScript(text: string): boolean {
  return /[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(text);
}

/** One line, short: errors end up in the report's "计划之外的调整". */
export function shortError(e: unknown): string {
  const s = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim();
  const http = /HTTP (\d{3})/.exec(s);
  if (http) return `请求失败（HTTP ${http[1]}）`;
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}
const MAX_KB_SOURCES = 4;
const MAX_EXPERT_NOTES = 2;
const PAGE_CHARS_FOR_MODEL = 14_000;

export interface RunInit {
  ctx: ToolContext;
  mode: ResearchMode;
  model: LanguageModel;
  judgmentModel?: LanguageModel;
  client: MeteredWebClient;
  emit: Emit;
  signal?: AbortSignal;
  /** Digest of workplan / decisions / directives for prompts. */
  contextText: string;
  /** One evaluation call gives up after this long and is retried once (default EVAL_CALL_TIMEOUT_MS). */
  evalTimeoutMs?: number;
}

/** The calls whose words reach the report (judge, summary, recommendation, rewrites of them). */
const WRITING_TASK = /^(?:judge|summary|recommend|shorten|citation-fit:repair)/;
const FOOTNOTE_MARK = /\[\^\d+\]/;

/** Every string of a model's answer without its "[^n]" marks. */
export function withoutFootnoteMarks<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/\s*\[\^\d+\]/g, '') as T;
  if (Array.isArray(v)) return v.map(withoutFootnoteMarks) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutFootnoteMarks(x)])) as T;
  return v;
}

export class ResearchRun {
  readonly ctx: ToolContext;
  readonly mode: ResearchMode;
  readonly limits: ResearchLimits;
  readonly model: LanguageModel;
  readonly judgmentModel: LanguageModel;
  readonly client: MeteredWebClient;
  readonly emit: Emit;
  readonly signal?: AbortSignal;
  readonly contextText: string;
  readonly evalTimeoutMs: number;

  evidence: Evidence[] = [];
  readonly evaluated = new Set<string>();
  /** Claim blocks whose evaluation call timed out / failed: reported as 未评估, never silently dropped. */
  readonly unevaluated = new Set<string>();
  readonly subStates = new Map<string, SubState>();
  readonly sourceInfos = new Map<string, SourceInfo>();
  readonly kbSources = new Set<string>();
  readonly expertSources = new Set<string>();
  readonly webSources = new Set<string>();
  /** Source notes whose page THIS run fetched (web_fetch + ingest), not ones found again in the vault. */
  readonly fetchedSources = new Set<string>();
  readonly usedUrls = new Set<string>();
  private readonly readPaths = new Set<string>();
  readonly counterNotes = new Map<string, string>();
  stats = { droppedQuotes: 0, extractedQuotes: 0, skipped: [] as string[] };
  /** Held back so the mandatory counter-evidence rounds can always run. */
  reserve = { searches: 0, fetches: 0 };

  readonly spans: Span[] = [];
  /** Steps 4 / 5 are emitted per page / per evaluation call; counted so a sub-question that had none still shows a 'skipped' row. */
  readonly extractSteps = new Map<string, number>();
  private stepSeq = 0;
  private readonly stepStarts = new Map<string, number>();
  readonly stepTimings: StepTiming[] = [];
  private toolSeq = 0;
  private urlIndex: Map<string, string> | null = null;

  constructor(init: RunInit) {
    this.ctx = init.ctx;
    this.mode = init.mode;
    this.limits = RESEARCH_LIMITS[init.mode];
    this.model = init.model;
    this.judgmentModel = init.judgmentModel ?? init.model;
    this.client = init.client;
    this.emit = init.emit;
    this.signal = init.signal;
    this.contextText = init.contextText;
    this.evalTimeoutMs = init.evalTimeoutMs ?? EVAL_CALL_TIMEOUT_MS;
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  step(id: string, step: number, title: string, status: 'running' | 'done' | 'skipped' | 'failed' | 'waiting', detail?: string) {
    const now = Date.now();
    if (status === 'running') {
      if (!this.stepStarts.has(id)) this.stepStarts.set(id, now);
    } else if (this.stepStarts.has(id)) {
      this.stepTimings.push({ id, step, title, ms: now - this.stepStarts.get(id)! });
      this.stepStarts.delete(id);
    }
    this.emit({ kind: 'step', id, step, title, status, detail });
  }

  timing(): RunTiming {
    const byKind: RunTiming['byKind'] = {};
    const llmByTask: RunTiming['llmByTask'] = {};
    for (const s of this.spans) {
      (byKind[s.kind] ??= { n: 0, ms: 0 }).n++;
      byKind[s.kind].ms += s.ms;
      if (s.kind === 'llm') {
        const task = s.label.split(':')[0];
        (llmByTask[task] ??= { n: 0, ms: 0 }).n++;
        llmByTask[task].ms += s.ms;
      }
    }
    return { byKind, llmByTask, steps: this.stepTimings };
  }

  async log(action: string, change: string, reason: string) {
    // the rows that start or end a run say which investigation they belong to (the page reads them to spot a run that died)
    const tag = RUN_LOG_ACTIONS.includes(action) && this.ctx.research ? runTag(this.ctx.research.dir) : '';
    await this.ctx.vault.appendLog(this.ctx.logPath, { time: this.ctx.now().toISOString(), actor: 'AI', action, change, reason: `${reason}${tag}` });
  }

  /** A tool call under the harness rules, shown as a card. */
  private searchSeq = 0;

  /** D-64 T26: a search as a card on the run page. */
  searchCard(source: 'files' | 'web', q: PlanSubQuestion, query: string, results: number, judgment: string): void {
    this.emit({ kind: 'search-card', n: ++this.searchSeq, source, subQuestion: q.id, question: this.subName(q), query, results, judgment });
  }

  /** D-64 T26: the gap search of a sub-question stopped (two web rounds with nothing new). */
  stopCard(q: PlanSubQuestion): void {
    this.emit({ kind: 'search-card', n: this.searchSeq, source: 'web', subQuestion: q.id, question: this.subName(q), query: '', results: 0, judgment: STOP_CARD, stop: true });
  }

  async tool<T = unknown>(name: ToolName, args: Record<string, unknown>, why: string): Promise<T> {
    const id = `tool-${++this.toolSeq}`;
    const input = { ...args, why };
    this.emit({ kind: 'tool-start', id, tool: name, input });
    const t0 = Date.now();
    try {
      const out = await executeTool(name, input, this.ctx);
      this.emit({ kind: 'tool-end', id, ok: true, output: clipForUi(out) });
      return out as T;
    } catch (e) {
      this.emit({ kind: 'tool-end', id, ok: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      this.spans.push({ kind: TOOL_KIND[name] ?? 'other', label: name, ms: Date.now() - t0 });
    }
  }

  async llm<T>(task: string, p: { system: string; prompt: string }, schema: z.ZodType<T>, opts: { timeoutMs?: number; timeoutRetries?: number; maxOutputTokens?: number } = {}): Promise<T> {
    const t0 = Date.now();
    const call = async (prompt: string): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await llmJson({ model: roleOfTask(task) === 'judgment' ? this.judgmentModel : this.model, task, system: p.system, prompt, schema, signal: this.signal, timeoutMs: opts.timeoutMs, maxOutputTokens: opts.maxOutputTokens });
        } catch (e) {
          if (!(e instanceof LlmTimeoutError) || attempt >= (opts.timeoutRetries ?? 0)) throw e;
          await this.log('research:llm-timeout', `${task} 超过 ${Math.round((opts.timeoutMs ?? 0) / 1000)} 秒没有回答，重试一次`, '模型调用超时');
        }
      }
    };
    try {
      const out = await call(p.prompt);
      // D-48 第 4 轮 B: the footnotes are code's, from the keys; a writing call that wrote "[^3]" is asked once more,
      // then the marks are taken out
      if (!WRITING_TASK.test(task) || !FOOTNOTE_MARK.test(JSON.stringify(out))) return out;
      const again = await call(`${p.prompt}\n\n上一次的输出里写了 [^n] 这样的脚注标记。不要写：引用只用证据编号 [E#] 或条件编号（如 [Q2-1①]），脚注由系统生成。`);
      if (!FOOTNOTE_MARK.test(JSON.stringify(again))) return again;
      const marks = [...new Set(JSON.stringify(again).match(new RegExp(FOOTNOTE_MARK.source, 'g')) ?? [])];
      await this.log('research:model-footnote-dropped', `${task} 重试以后仍写了脚注标记 ${marks.slice(0, 5).join('')}：去掉`, '脚注由系统按证据编号生成，模型不写');
      return withoutFootnoteMarks(again);
    } finally {
      this.spans.push({ kind: 'llm', label: task, ms: Date.now() - t0 });
    }
  }

  availableSearches(): number {
    return Math.max(0, this.client.remaining().searches - this.reserve.searches);
  }
  availableFetches(): number {
    return Math.max(0, this.client.remaining().fetches - this.reserve.fetches);
  }
  private fetchesPerRound(): number {
    return this.mode === 'small' ? 1 : 2;
  }

  claimBrief(c: PlanClaim): ClaimBrief {
    // a question-tree plan (D-39): the model sees the sub-question the hypothesis answers, by the labels readers see
    const plan = this.ctx.research?.plan;
    const label = plan && c.question ? hypothesisLabel(plan, c.id) : null;
    return { id: c.id, statement: c.statement, conditions: c.conditions.map(conditionText), ...(label && c.question ? { question: c.question, label, qid: `Q${label.slice(1)}` } : {}) };
  }
  /** 复核 A: how the run page names a sub-question and a hypothesis (by their words and the plan's labels, never the stored ids). */
  subName(q: PlanSubQuestion): string {
    return `「${q.question.length > 30 ? `${q.question.slice(0, 30)}…` : q.question}」`;
  }
  claimName(c: PlanClaim): string {
    const plan = this.ctx.research?.plan;
    return plan ? hypothesisLabel(plan, c.id) : `「${c.statement}」`;
  }
  /** A hypothesis or a sub-question by its stored id (the scope lists mix both). */
  itemName(id: string): string {
    const claims = this.ctx.research?.plan?.claims ?? [];
    const claim = claims.find((c) => c.id === id);
    if (claim) return this.claimName(claim);
    const q = claims.flatMap((c) => c.sub_questions).find((x) => x.id === id);
    return q ? this.subName(q) : id;
  }
  subBrief(q: PlanSubQuestion): SubQuestionBrief {
    return { id: q.id, question: q.question };
  }

  /**
   * Evidence for a sub-question (its own + the claim's counter round), or for the whole
   * claim (deduplicated: the same block judged for two sub-questions counts once).
   */
  evidenceFor(claimId: string, subQuestionId?: string): Evidence[] {
    const list = this.evidence.filter((e) => e.claimId === claimId && (!subQuestionId || e.subQuestionId === subQuestionId || e.round === 'counter'));
    if (subQuestionId) return list;
    const seen = new Set<string>();
    return list.filter((e) => {
      const k = `${e.ref}|${e.stance}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private async urls(): Promise<Map<string, string>> {
    if (!this.urlIndex) this.urlIndex = await buildUrlIndex(this.ctx.vault);
    return this.urlIndex;
  }

  private async info(path: string): Promise<SourceInfo | null> {
    let i = this.sourceInfos.get(path);
    if (!i) {
      i = (await loadSourceInfo(this.ctx.vault, path)) ?? undefined;
      if (i) this.sourceInfos.set(path, i);
    }
    return i ?? null;
  }

  // ── step 2/3/6/7: how to search ────────────────────────────────────────────

  async planQueries(claim: PlanClaim, q: PlanSubQuestion, focus: QueryFocus, tried: string[], gapNote?: string): Promise<QueryPlan> {
    const known: string[] = [];
    try {
      for (const e of (await this.ctx.vault.list('10_资料库')).slice(0, 60)) if (e.kind === 'file') known.push(e.name.replace(/\.md$/, ''));
    } catch {
      /* empty */
    }
    return this.llm(
      `queries:${q.id}:${focus}`,
      queryPlanPrompt({
        claim: this.claimBrief(claim),
        subQuestion: this.subBrief(q),
        focus,
        counterSearch: claim.counter_search,
        knownSources: known,
        tried,
        gapNote,
        context: this.contextText.slice(0, 3500),
      }),
      queryPlanSchema,
    );
  }

  // ── step 2: the vault ──────────────────────────────────────────────────────

  /** Search the vault for sources; returns the sources worth reading, best first. */
  async kbLookup(q: PlanSubQuestion, queries: string[], focus: QueryFocus): Promise<SourceInfo[]> {
    const counts = new Map<string, number>();
    const expertCounts = new Map<string, number>();
    const why = `${q.id}：${focus === 'counter' ? '先在知识库里找反证' : '先查知识库'}`;
    const run = async (query: string) => {
      const out = await this.tool<{ hits: { path: string }[] }>('vault_search', { query, types: ['source'], limit: 5 }, why);
      for (const h of out.hits) counts.set(h.path, (counts.get(h.path) ?? 0) + 1);
      this.searchCard('files', q, query, out.hits.length, out.hits.length ? `找到 ${out.hits.length} 份相关资料，读原文判断` : '没有找到相关资料');
    };
    // Expert input (interview notes: type knowledge, kind expert-input) lives outside the source library: look there too (D-18).
    const runExpert = async (query: string) => {
      const out = await this.tool<{ hits: { path: string }[] }>(
        'vault_search',
        { query, types: ['knowledge'], where: { kind: 'expert-input' }, limit: 3 },
        `${q.id}：有没有专家访谈（专家输入）谈到这个，只当挑战或线索`,
      );
      for (const h of out.hits) expertCounts.set(h.path, (expertCounts.get(h.path) ?? 0) + 1);
    };
    const singlesOf = () => [...new Set(queries.map((s) => s.trim().split(/\s+/)[0]).filter(Boolean))].slice(0, 3);
    for (const query of queries.slice(0, 5)) await run(query);
    for (const query of queries.slice(0, 3)) await runExpert(query);
    if (counts.size === 0) {
      // Keywords rank, they no longer have to all match, but a fully empty result is still retried with single words.
      for (const query of singlesOf()) await run(query);
    }
    if (expertCounts.size === 0) for (const query of singlesOf()) await runExpert(query);
    for (const [p, n] of expertCounts) counts.set(p, n);
    const infos: SourceInfo[] = [];
    const disproven: string[] = [];
    for (const path of counts.keys()) {
      const i = await this.info(path);
      if (i?.reliability === 'disproven') disproven.push(i.name);
      else if (i) infos.push(i);
    }
    if (disproven.length) await this.log('research:source-disproven', `${q.id}：跳过已被证伪的资料：${disproven.join('、')}`, '资料笔记的 reliability = disproven，不再当证据候选');
    infos.sort((a, b) => (counts.get(b.path)! - counts.get(a.path)!) || GRADE_RANK[b.grade] - GRADE_RANK[a.grade]);
    const top = [...infos.filter((i) => i.kind === 'source').slice(0, MAX_KB_SOURCES), ...infos.filter((i) => i.kind === 'expert').slice(0, MAX_EXPERT_NOTES)];
    for (const i of top) {
      // "知识库" counts what the vault held before this run; pages ingested by this run count as 网络; interviews are counted apart.
      if (i.kind === 'expert') this.expertSources.add(i.path);
      else if (!this.webSources.has(i.path)) this.kbSources.add(i.path);
      if (this.readPaths.has(i.path)) continue;
      this.readPaths.add(i.path);
      await this.tool('vault_read', { path: i.path }, `${q.id}：读资料，准备评估里面的论断`);
    }
    return top;
  }

  // ── step 5: evaluate ───────────────────────────────────────────────────────

  private rank(drafts: EvidenceDraft[], terms: string[]): EvidenceDraft[] {
    const score = (d: EvidenceDraft) => {
      const hay = normalizeForQuote(d.quote);
      return terms.reduce((n, t) => n + (t && hay.includes(normalizeForQuote(t)) ? 1 : 0), 0);
    };
    return [...drafts].sort((a, b) => score(b) - score(a) || GRADE_RANK[b.grade] - GRADE_RANK[a.grade]);
  }

  /** Judge each not-yet-judged claim block against the plan's claim; keeps the relevant ones. Returns how many were kept. */
  async evaluate(claim: PlanClaim, q: PlanSubQuestion, focus: QueryFocus, round: EvidenceRound, drafts: EvidenceDraft[], terms: string[]): Promise<Evidence[]> {
    // A block is judged once per sub-question (and once more in the claim's counter round).
    const key = (d: EvidenceDraft) => (round === 'counter' ? `${claim.id}:counter|${d.ref}` : `${q.id}|${d.ref}`);
    // An interview answer that is not about this claim / sub-question is not offered to the evaluator at all.
    const offTopic = drafts.filter((d) => isExpert(d) && !expertAnswerRelevant(d.quote, claim.statement, q.question));
    if (offTopic.length) await this.log('research:expert-offtopic', `${q.id}：${offTopic.length} 条专家访谈的回答和这个论点 / 子问题无关，没有挂到 ${claim.id} 下面`, offTopic.map((d) => d.ref).join('、'));
    const fresh = drafts.filter((d) => !offTopic.includes(d) && !this.evaluated.has(key(d)) && !this.unevaluated.has(key(d)));
    const sid = `s5:${q.id}:${round}:${++this.stepSeq}`;
    const stepTitle = `评估 · ${this.subName(q)}（${ROUND_LABEL[round]}）`;
    if (fresh.length === 0) {
      this.step(sid, 5, stepTitle, 'skipped', '这一轮没有拿到新的论断，没有东西可评估');
      return [];
    }
    const chosen = this.rank(fresh, terms).slice(0, this.limits.maxCandidatesPerEval);
    this.step(sid, 5, stepTitle, 'running', `${chosen.length} 条论断（${fresh.length > chosen.length ? `共 ${fresh.length} 条，按相关度取前 ${chosen.length} 条` : '全部'}）`);
    const candidates: EvalCandidate[] = chosen.map((d, i) => ({
      id: i + 1,
      grade: isExpert(d) ? '专家意见' : d.grade,
      origin: originLabel(d),
      publisher: d.publisher,
      published: d.published,
      quote: d.quote.slice(0, 400),
    }));
    let res;
    try {
      res = await this.llm(`evaluate:${q.id}`, evaluatePrompt({ claim: this.claimBrief(claim), subQuestion: this.subBrief(q), focus, candidates }), evaluationSchema, {
        timeoutMs: this.evalTimeoutMs,
        timeoutRetries: 1,
      });
    } catch (e) {
      if (this.signal?.aborted) throw e;
      // Never let one stuck / failing evaluation freeze the run (M4 eval round 3: 3 min 39 s of silence): the batch is
      // recorded as NOT evaluated, in the log and under 计划之外的调整, and the run goes on.
      const why = e instanceof LlmTimeoutError ? `模型 ${Math.round(this.evalTimeoutMs / 1000)} 秒没有回答（已重试一次）` : shortError(e);
      for (const d of chosen) this.unevaluated.add(key(d));
      this.stats.skipped.push(`${q.id} 评估没有完成：${chosen.length} 条论断记为“未评估”（${why}）`);
      await this.log('research:evaluate-failed', `${q.id}（${ROUND_LABEL[round]}）：${chosen.length} 条论断未评估：${why}`, '评估是单次调用，失败不阻塞整次调查');
      this.step(sid, 5, stepTitle, 'skipped', `评估没有完成，${chosen.length} 条论断记为“未评估”：${why}`);
      return [];
    }
    const byId = new Map(res.items.map((it) => [it.id, it]));
    const kept: Evidence[] = [];
    chosen.forEach((d, i) => {
      this.evaluated.add(key(d));
      const it = byId.get(i + 1);
      if (!it || it.stance === 'irrelevant') return;
      kept.push({
        ...d,
        claimId: claim.id,
        subQuestionId: q.id,
        round,
        stance: it.stance,
        reason: it.reason,
        core: it.stance === 'refutes' && it.core,
        partial: it.stance === 'refutes' && it.partial,
      });
    });
    // The same block judged with another stance elsewhere in this claim (another sub-question, the counter round): logged, both kept.
    for (const e of kept) {
      const other = this.evidence.find((x) => x.claimId === e.claimId && x.ref === e.ref && x.stance !== e.stance);
      if (other) {
        // sub-questions are evaluated in parallel: name them in id order so the log line does not depend on timing
        const pair = [
          { q: other.subQuestionId, stance: other.stance, counter: other.round === 'counter' },
          { q: e.subQuestionId, stance: e.stance, counter: round === 'counter' },
        ].sort((a, b) => a.q.localeCompare(b.q) || Number(a.counter) - Number(b.counter));
        await this.log(
          'research:stance-conflict',
          `${e.ref} ${pair.map((p) => `在 ${p.q}${p.counter ? '（反证轮）' : ''} 判为${STANCE_ZH[p.stance]}`).join('，')}`,
          `${claim.id}：同一条${isExpert(e) ? '访谈回答' : '论断'}两处立场不同；报告里按"挑战"处理`,
        );
      }
    }
    this.evidence.push(...kept);
    this.step(
      sid,
      5,
      stepTitle,
      'done',
      `${chosen.length} 条论断：${kept.filter((e) => e.stance === 'supports').length} 支持 / ${kept.filter((e) => e.stance === 'refutes').length} 反驳 / ${chosen.length - kept.length} 无关；看信源等级、日期和口径`,
    );
    return kept;
  }

  /** Steps 2 + 5 for a set of sources already in the vault. */
  async evaluateSources(claim: PlanClaim, q: PlanSubQuestion, focus: QueryFocus, round: EvidenceRound, sources: SourceInfo[], terms: string[]): Promise<Evidence[]> {
    const drafts = (await Promise.all(sources.map((s) => claimBlocksOf(this.ctx.vault, s)))).flat();
    return this.evaluate(claim, q, focus, round, drafts, terms);
  }

  // ── step 3/4: the web ──────────────────────────────────────────────────────

  /**
   * One web round: search → pick pages → fetch → ingest → extract (system-verified) → evaluate.
   * Returns the relevant evidence it added, or null if no search could be made.
   */
  /** `beforeFetch`: called right before this round takes its pages (the caller's held fetch is released there, not earlier). */
  async webRound(
    claim: PlanClaim,
    q: PlanSubQuestion,
    focus: QueryFocus,
    round: EvidenceRound,
    queries: string[],
    tried: string[],
    beforeFetch?: () => void,
  ): Promise<{ added: Evidence[]; note: string; pagesRead: number; pagesFailed: number } | null> {
    const query = queries.find((x) => !tried.includes(x)) ?? queries[0];
    if (!query || this.availableSearches() <= 0) return null;
    tried.push(query);

    let results: { url: string; title: string; site_name: string; date: string | null; authority: number | null; rerank_score: number; summary?: string; grade_hint: string }[];
    try {
      results = (await this.tool<{ results: typeof results }>('web_search', { sub_question_id: q.id, query, count: 6 }, `${q.id}：${focus === 'counter' ? '联网找反证' : focus === 'gap' ? '联网补缺口' : '知识库补不上，联网查'}`)).results;
    } catch (e) {
      const msg = shortError(e);
      this.stats.skipped.push(`${q.id} 联网搜索失败：${msg}`);
      this.searchCard('web', q, query, 0, `联网搜索失败：${msg}`);
      return { added: [], note: `联网搜索失败（${msg}）`, pagesRead: 0, pagesFailed: 0 };
    }

    const urlIdx = await this.urls();
    // 入库前过滤，第一道：明显不是内容的页面（隐私政策、条款、登录、社交平台的单条帖子）不抓
    const screened = results.filter((r) => {
      const why = nonContentReason(r);
      if (why) this.stats.skipped.push(`${q.id} ${r.title || r.url}：${why}，不抓`);
      return !why;
    });
    const fresh = screened.filter((r) => /^https?:\/\//i.test(r.url) && !this.usedUrls.has(normalizeUrl(r.url)));
    const scored = fresh
      // DeepSeek Fetch fails on most PDFs (measured 10/24: HTTP 404 "failed to fetch URL"): try them last.
      .map((r) => ({ r, s: r.rerank_score + (r.grade_hint === 'A' ? 0.3 : r.grade_hint === 'B' ? 0.15 : 0) - (/\.pdf($|[?#])/i.test(r.url) ? 2 : 0) - (isForeignScript(`${r.title} ${r.summary ?? ''}`) ? 1.5 : 0) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
    const existing = scored.filter((r) => urlIdx.has(normalizeUrl(r.url))).slice(0, 2);
    beforeFetch?.();
    const wantFetch = Math.min(this.fetchesPerRound(), this.availableFetches());
    const toFetch = scored.filter((r) => !urlIdx.has(normalizeUrl(r.url))).slice(0, wantFetch);
    for (const r of [...existing, ...toFetch]) this.usedUrls.add(normalizeUrl(r.url));

    const drafts: EvidenceDraft[] = [];
    const notes: string[] = [];
    let pagesFailed = 0;
    const read = async (r: { url: string; title: string }, isNew: boolean) => {
      try {
        const ds = isNew ? await this.fetchIngestExtract(claim, q, focus, r) : await this.reuseExisting(claim, q, focus, urlIdx.get(normalizeUrl(r.url))!);
        drafts.push(...ds);
      } catch (e) {
        const msg = shortError(e);
        notes.push(`${r.url}：${msg}`);
        this.stats.skipped.push(`${q.id} ${r.url}：${msg}`);
        if (isNew) pagesFailed += 1;
      }
    };
    await Promise.all([...existing.map((r) => read(r, false)), ...toFetch.map((r) => read(r, true))]);
    // A page that could not be read (404, paywall, PDF) must not end the sub-question as "found nothing":
    // take the next-ranked page while there is spare fetch budget (never the share kept for other rounds).
    const spare = scored.filter((r) => !urlIdx.has(normalizeUrl(r.url)) && !this.usedUrls.has(normalizeUrl(r.url)));
    for (let tries = 0; tries < pagesFailed && drafts.length === 0 && this.availableFetches() > 0 && spare.length > 0 && tries < 2; tries++) {
      const next = spare.shift()!;
      this.usedUrls.add(normalizeUrl(next.url));
      toFetch.push(next);
      await read(next, true);
    }
    const terms = [...query.split(/\s+/), ...claim.statement.split(/[，。；、\s]+/).filter((t) => t.length >= 2)];
    const added = await this.evaluate(claim, q, focus, round, drafts, terms);
    const pagesRead = existing.length + toFetch.length - pagesFailed;
    this.searchCard('web', q, query, results.length, added.length ? `读了 ${pagesRead} 页，得到 ${added.length} 条相关证据` : `读了 ${pagesRead} 页，没有新证据`);
    return { added, note: `搜索「${query}」→ ${results.length} 条结果，入库/复用 ${pagesRead} 页${pagesFailed ? `（另有 ${pagesFailed} 页打不开或没有可核对的原文，未入库）` : ''}，得到 ${added.length} 条相关证据${notes.length ? `；跳过：${notes.join('；')}` : ''}`, pagesRead, pagesFailed };
  }

  private async reuseExisting(claim: PlanClaim, q: PlanSubQuestion, focus: QueryFocus, path: string): Promise<EvidenceDraft[]> {
    const info = await this.info(path);
    if (!info) return [];
    (info.origin === '网络' ? this.webSources : this.kbSources).add(path);
    let drafts = await claimBlocksOf(this.ctx.vault, info);
    if (drafts.length === 0) {
      const body = (await this.ctx.vault.read(path)).body;
      const page = body.split(/^## 抓取原文\s*$/m)[1] ?? body;
      drafts = await this.extract(claim, q, focus, info, page);
    }
    return drafts;
  }

  private async fetchIngestExtract(
    claim: PlanClaim,
    q: PlanSubQuestion,
    focus: QueryFocus,
    r: { url: string; title: string; site_name?: string },
  ): Promise<EvidenceDraft[]> {
    await this.tool('web_fetch', { sub_question_id: q.id, url: r.url }, `${q.id}：读这一页`);
    // 入库前过滤，第二道：先从抓来的正文里提取、逐字核对，至少留下一条原文才存进资料库（用户 2026-10-30 决定）
    const page = recallPage(r.url)?.content ?? '';
    const p = await this.proposeQuotes(claim, q, focus, { name: r.title.slice(0, 60), publisher: r.site_name ?? new URL(r.url).hostname }, page);
    if (!p || p.kept.length === 0) {
      if (p) this.step(p.sid, 4, p.stepTitle, 'done', `模型提取 ${p.proposed} 条，没有一条能在原文里逐字核对到：不入库`);
      await this.log('research:not-ingested', `${r.title || r.url}：没有能逐字核对的相关原文，不入库`, `${q.id} 入库前过滤`);
      // counts like a page that could not be read: the next-ranked page gets the fetch
      throw new Error('没有能逐字核对的相关原文，不入库');
    }
    const ing = await this.tool<{ path: string; deduped: boolean }>('ingest_source', { sub_question_id: q.id, url: r.url, name: r.title.slice(0, 60) }, `${q.id}：存进资料库并定级，之后才能引用`);
    const info = await this.info(ing.path);
    if (!info) throw new Error('入库后读不到资料笔记');
    (info.origin === '网络' ? this.webSources : this.kbSources).add(ing.path);
    this.fetchedSources.add(ing.path);
    return this.storeQuotes(q, info, p);
  }

  /** Step 4: the model proposes quotes, the SYSTEM checks they are in the page; only those are written as ^cN. */
  private async extract(claim: PlanClaim, q: PlanSubQuestion, focus: QueryFocus, info: SourceInfo, pageText: string): Promise<EvidenceDraft[]> {
    const p = await this.proposeQuotes(claim, q, focus, { name: info.name, publisher: info.publisher }, pageText);
    return p ? this.storeQuotes(q, info, p) : [];
  }

  /** The model's quotes from a page, each checked word for word against the page text (nothing is written yet). */
  private async proposeQuotes(claim: PlanClaim, q: PlanSubQuestion, focus: QueryFocus, source: { name: string; publisher: string }, pageText: string) {
    const text = pageText.slice(0, MAX_INGEST_CHARS);
    const sid = `s4:${q.id}:${++this.stepSeq}`;
    const stepTitle = `提取 · ${this.subName(q)}：${source.name.length > 36 ? `${source.name.slice(0, 36)}…` : source.name}`;
    this.extractSteps.set(q.id, (this.extractSteps.get(q.id) ?? 0) + 1);
    if (!text.trim()) {
      this.step(sid, 4, stepTitle, 'skipped', '页面没有可读的正文');
      return null;
    }
    this.step(sid, 4, stepTitle, 'running', '让模型提取论断，原文由系统逐字核对');
    const res = await this.llm(
      `extract:${source.name}`,
      extractPrompt({ claim: this.claimBrief(claim), subQuestion: this.subBrief(q), focus, sourceTitle: source.name, publisher: source.publisher, pageText: text.slice(0, PAGE_CHARS_FOR_MODEL) }),
      extractionSchema,
    );
    // the model picks a stretch; what is stored is the whole sentence around it, from the same page text
    const picked = verifyQuotes(text, res.claims);
    const full = verifyQuotes(text, picked.kept.map((c) => ({ ...c, quote: toFullSentence(text, c.quote) })));
    // two picks in the same sentence become one claim: that is a merge, not a quote that failed the check
    const verified = { kept: full.kept, dropped: [...picked.dropped, ...full.dropped.filter((d) => d.reason !== 'duplicate')] };
    this.stats.extractedQuotes += res.claims.length;
    this.stats.droppedQuotes += verified.dropped.length;
    return { sid, stepTitle, proposed: res.claims.length, kept: verified.kept, dropped: verified.dropped.length };
  }

  /** Writes the checked quotes the note does not hold yet as ^cN; returns them as evidence drafts. */
  private async storeQuotes(q: PlanSubQuestion, info: SourceInfo, p: NonNullable<Awaited<ReturnType<ResearchRun['proposeQuotes']>>>): Promise<EvidenceDraft[]> {
    // Skip quotes this note already holds as claims (the page may be reused across sub-questions).
    const existing = [...(await this.ctx.vault.getBlocks(info.path)).values()].map((b) => normalizeForQuote(b.text));
    const novel = p.kept.filter((c) => !existing.some((t) => t.includes(normalizeForQuote(c.quote))));
    const added = await appendClaims(this.ctx.vault, info.path, novel);
    await this.log('research:extract', `${info.name}：提取 ${p.proposed} 条，核对原文后保留 ${p.kept.length} 条（新增 ${added.length}），丢弃 ${p.dropped} 条`, `${q.id} 步骤 4 · 原文由系统逐字核对`);
    this.step(p.sid, 4, p.stepTitle, 'done', `模型提取 ${p.proposed} 条；系统逐字核对原文，保留 ${p.kept.length} 条（新增 ${added.length}），丢弃 ${p.dropped} 条对不上原文的`);
    return claimBlocksOf(this.ctx.vault, info, new Set(added.map((a) => a.id)));
  }

  // ── per sub-question flow (steps 2, 3, then 7) ─────────────────────────────

  describeGap(claimId: string, qid: string): string {
    const ev = this.evidenceFor(claimId, qid);
    const supports = ev.filter((e) => e.stance === 'supports');
    const independent = new Set(supports.map((e) => e.publisher.toLowerCase())).size;
    const parts: string[] = [];
    if (supports.length === 0) parts.push('还没有任何支持证据');
    else if (independent < 2) parts.push(`支持证据只来自 ${independent} 个发布方（至少需要 2 个互相独立的）`);
    if (!supports.some((e) => e.grade !== 'C')) parts.push('没有 A/B 级的支持证据');
    if (ev.some((e) => e.stance === 'refutes')) parts.push('存在反证，需要判断它是否被驳倒（找更权威的来源或口径一致的数据）');
    return parts.join('；') || '证据互相矛盾，需要口径一致的来源';
  }

  stopNote(reason: StopReason | 'expert_only'): string {
    return {
      decidable: '证据已经够下判断，停止检索',
      no_new_evidence: '连续 2 轮联网没有新证据，停止；证据不足的部分转成要问专家的问题',
      rounds_exhausted: `已联网 ${this.limits.webRoundsPerSubQuestion} 轮，仍无法判断，停止；转成要问专家的问题`,
      budget_exhausted: '达到搜索次数上限，停止；转成要问专家的问题',
      expert_only: '计划里这个子问题不联网，只查知识库；证据不足的部分转成要问专家的问题',
    }[reason];
  }

  stopFor(st: SubState): StopReason | 'expert_only' | null {
    const methods = st.q.methods;
    const stop = stopReason({
      evidence: this.evidenceFor(st.claim.id, st.q.id),
      webRoundsDone: st.webRounds,
      maxWebRounds: this.limits.webRoundsPerSubQuestion,
      newEvidenceByRound: st.newByRound,
      searchesLeft: this.availableSearches(),
    });
    if (stop) return stop;
    if (!methods.includes('网络')) return 'expert_only';
    return null;
  }
}
