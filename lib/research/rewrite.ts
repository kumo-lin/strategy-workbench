/**
 * 只重写 (D-48): a report written again, the new way, on an earlier version's evidence — no search, no fetch.
 *   1. the research folder's latest plan must be approved (it may be newer than the one vN used: WS-A's 计划 v3);
 *   2. vN's evidence comes back from its record (loadEvidenceRecord, restoreEvidence), every entry of it: one that
 *      does not (its source note or block gone from this vault) stops the rewrite before anything is written
 *      (RewriteMissing), unless the owner decided it goes out anyway (allowMissing: 本版变化 says what is missing);
 *   3. judging and writing are the full run's own (judgeAndWrite, steps 8–9), vN's judgment frozen (D-48 第 4 轮):
 *      its judgment file, else read back from its body; the model only writes, a hypothesis not read back is judged again;
 *   4. it is stored as the next version: rewrite_of and research_run.rewrite in its frontmatter, "## 本版变化（vN+1，
 *      只改写法）" after Summary, the evidence file holding vN's entries as they were; no follow_up;
 *   5. delivered, it writes the proposed verdicts as any run does. Logged as research:rewrite.
 * 怎么查的 says how the evidence was found: the counts of the run that found it, back along rewrite_of past every
 * rewrite (v6 written on v5, itself written on v4: v4's); research_run is this run's: 0 searches, 0 fetches.
 */
import type { LanguageModel } from 'ai';
import { findRelatedDecisions } from '@/lib/decisions/retrieve';
import type { WebToolsClient } from '@/lib/deepseek/web-tools';
import { isPlanApproved } from '@/lib/harness/phases';
import type { ToolContext } from '@/lib/harness/types';
import { resolveRunModels } from './run-models';
import { normalizeVerdict, type ResearchPlanNote } from '@/lib/notes/schema';
import { loadResearchContext, renderContext } from './context';
import { parseWikiLink } from '@/lib/vault/links';
import type { Evidence } from './evidence';
import { loadEvidenceRecord, restoreEvidence, writeEvidenceSidecar, type EvidenceRecordEntry } from './evidence-record';
import { judgeAndWrite, linkTo, selectScope, type ExecuteResult } from './execute';
import { frozenFromBody, frozenFromFile, judgmentFileFromBody, judgmentFilePath, readJudgmentFile, saveJudgmentFile, type FrozenClaim, type JudgmentFile } from './judgment-file';
import type { Emit } from './progress';
import { conditionText, hypothesisLabel, questionTreeOf, treeOrder } from './question-tree';
import { ResearchRun } from './run';
import { clearRunClient, startRunClient } from './run-client';

export class RewriteDenied extends Error {}

/** A record entry that did not come back: its ref, and the note it points to (resolved, else as linked). */
export interface MissingEvidence {
  ref: string;
  path: string;
}

/** vN's record has entries this vault cannot restore (W5 on S3: 211 recorded, 209 restored, nothing said). */
export class RewriteMissing extends RewriteDenied {
  constructor(
    readonly missing: MissingEvidence[],
    readonly recorded: number,
    from: number,
  ) {
    super(`报告 v${from} 的证据记录有 ${recorded} 条，只恢复了 ${recorded - missing.length} 条，没有写报告。找不到的资料：\n${missing.map((m) => `  - ${m.ref}（${m.path}）`).join('\n')}\n确认少了也要出，才加 --allow-missing。`);
  }
}

export interface RewriteOptions {
  ctx: ToolContext;
  /** The vault path of the version whose evidence is written on ("…/报告 v4.md"). */
  reportPath: string;
  model?: LanguageModel;
  modelInfo?: { providerId: string; label: string; model: string };
  emit?: Emit;
  signal?: AbortSignal;
  evalTimeoutMs?: number;
  repairRounds?: number;
  /** The owner decided the rewrite goes out though some of vN's evidence cannot be restored. */
  allowMissing?: boolean;
  /**
   * 第 5 轮 --only: what is written again ("H2", "H3-3": a hypothesis and the ones under it; "一句话回答"; "推荐表");
   * the rest is vN's word for word, from its judgment file. Every judgment stays frozen.
   */
  only?: string[];
  /**
   * --rerender: the report rendered again by today's rules from vN's judgment file alone: every card, the one-line
   * answer and the recommendation as stored, no model call at all. `note`: why (本版变化 "只重新渲染：<note>，判断和文字都没变").
   */
  rerender?: { note?: string };
}

/** A rewrite never goes on the web: a call here is a bug, and says so. */
const NO_WEB: WebToolsClient = {
  search: async () => {
    throw new Error('只重写不联网：不该有搜索');
  },
  fetch: async () => {
    throw new Error('只重写不联网：不该有抓取');
  },
};

const versionOf = (p: string) => Number(/v(\d+)(?:\.md)?$/.exec(p)?.[1] ?? 0);
const linkPath = (link: unknown) => (typeof link === 'string' ? /\[\[([^\]|#]+)/.exec(link)?.[1]?.trim() ?? '' : '');

/**
 * "计划：" in 本版变化: "沿用计划 v2" when vN used the same plan; else what the newer one changed, by label
 * ("计划 v3（和 v4 用的计划 v2 比：Q3 的问句改了；编号没变）").
 */
export function planLine(plan: ResearchPlanNote, planPath: string, before: ResearchPlanNote | null, beforePath: string, from: number): string {
  const name = `计划 v${versionOf(planPath)}`;
  if (!before || beforePath.replace(/\.md$/, '') === planPath.replace(/\.md$/, '')) return `沿用${name}`;
  const questions = (p: ResearchPlanNote) => {
    const t = questionTreeOf(p);
    const out = new Map<string, string>();
    if (t.format === 'question_tree') for (const r of t.roots) for (const n of [r, ...r.children]) out.set(n.qid, n.question.trim());
    return out;
  };
  const claims = (p: ResearchPlanNote) => new Map(p.claims.map((c) => [hypothesisLabel(p, c.id), { statement: c.statement.trim(), conditions: c.conditions.map((x) => conditionText(x).trim()).join('\n') }]));
  const [qa, qb, ca, cb] = [questions(plan), questions(before), claims(plan), claims(before)];
  const changes = [
    ...[...qa].filter(([k, v]) => qb.has(k) && qb.get(k) !== v).map(([k]) => `${k} 的问句改了`),
    ...[...ca].filter(([k, v]) => cb.get(k) && cb.get(k)!.statement !== v.statement).map(([k]) => `${k} 的假设改了`),
    ...[...ca].filter(([k, v]) => cb.get(k) && cb.get(k)!.conditions !== v.conditions).map(([k]) => `${k} 的条件改了`),
  ];
  const same = (a: Map<string, unknown>, b: Map<string, unknown>) => a.size === b.size && [...a.keys()].every((k) => b.has(k));
  const numbering = same(qa, qb) && same(ca, cb) ? '编号没变' : '编号变了';
  return `${name}（和 v${from} 用的计划 v${versionOf(beforePath)} 比：${changes.length ? changes.join('；') : '内容没变'}；${numbering}）`;
}

/** Each entry restored on its own, so the ones that do not come back are known. */
async function restoreAll(vault: ToolContext['vault'], record: EvidenceRecordEntry[], fromPath: string): Promise<{ evidence: Evidence[]; missing: MissingEvidence[] }> {
  const evidence: Evidence[] = [];
  const missing: MissingEvidence[] = [];
  for (const r of record) {
    const got = await restoreEvidence(vault, [r], fromPath);
    if (got.length) {
      evidence.push(...got);
      continue;
    }
    const link = parseWikiLink(r.ref);
    const res = link ? await vault.resolveLink(link, fromPath) : null;
    missing.push({ ref: r.ref, path: res?.ok ? res.path : link ? `${link.target}.md` : r.ref });
  }
  return { evidence, missing };
}

/**
 * The run that found vN's evidence: vN itself, else back along rewrite_of past every rewrite (WS-A v6 → v5 → v4).
 * A link in the chain that cannot be read stops the rewrite: 怎么查的 would say a rewrite's 0 searches.
 */
async function originalRun(vault: ToolContext['vault'], data: Record<string, unknown>, version: number): Promise<{ version: number; run: Record<string, unknown> }> {
  let d = data;
  let v = version;
  for (const seen = new Set<string>(); ; ) {
    const run = (d.research_run ?? {}) as Record<string, unknown>;
    const prev = linkPath(d.rewrite_of);
    if (run.rewrite !== true || !prev) return { version: v, run };
    if (seen.has(prev)) throw new RewriteDenied(`rewrite_of 绕回了 ${prev}：找不到最初那次调查`);
    seen.add(prev);
    const note = await vault.read(`${prev}.md`).catch(() => null);
    if (!note) throw new RewriteDenied(`找不到 ${prev}：没法知道最初那次调查查了多少`);
    d = note.data;
    v = Number(d.version) || versionOf(prev);
  }
}

/**
 * D-48 第 4 轮 A: vN's judgment, frozen. Its judgment file when there is one, else read back from its body; a
 * hypothesis that cannot be read is judged again (judgeClaim logs research:frozen-fallback).
 */
export async function frozenJudgments(vault: ToolContext['vault'], reportPath: string, body: string, plan: ResearchPlanNote): Promise<{ frozen: Map<string, FrozenClaim | { unreadable: string }>; source: 'file' | 'body'; file: JudgmentFile | null }> {
  const file = await readJudgmentFile(vault, reportPath);
  const read = file ? frozenFromFile(file) : frozenFromBody(body, plan);
  const frozen = new Map<string, FrozenClaim | { unreadable: string }>(read.frozen.map((f) => [f.claimId, f]));
  for (const u of read.unreadable) {
    const id = plan.claims.find((c) => hypothesisLabel(plan, c.id) === u.label)?.id;
    if (id) frozen.set(id, { unreadable: u.why });
  }
  return { frozen, source: file ? 'file' : 'body', file };
}

const SO_WHAT = ['一句话回答', 'so_what', 'summary', 'Summary'];
export const RERENDER_NOTE = '按当前代码的渲染规则重新渲染，模型没有参与写作';
const RECOMMENDATION = ['推荐表', '推荐', '推荐判断', 'recommendation'];

/** --only: a hypothesis listed by its label, or by one above it ("H2" lists H2-1 and H2-2). */
export const listedIn = (only: string[], label: string) => only.some((t) => label === t || label.startsWith(`${t}-`));

/** What --only keeps of vN: the hypotheses not listed (marked keep), the Summary and recommendation unless listed. */
export function keepOf(frozen: Map<string, FrozenClaim | { unreadable: string }>, file: JudgmentFile | null, only: string[]): NonNullable<Parameters<typeof judgeAndWrite>[0]['keep']> {
  const unknown = only.filter((t) => !SO_WHAT.includes(t) && !RECOMMENDATION.includes(t) && ![...frozen.values()].some((f) => 'label' in f && listedIn([t], f.label)));
  if (unknown.length) throw new RewriteDenied(`--only 里的 ${unknown.join('、')} 不是这份报告里的假设，也不是"一句话回答""推荐表"`);
  for (const f of frozen.values()) if ('label' in f) f.keep = !listedIn(only, f.label);
  const so = only.some((t) => SO_WHAT.includes(t));
  const rec = only.some((t) => RECOMMENDATION.includes(t));
  const labels = [...frozen.values()].flatMap((f) => ('label' in f && !f.keep ? [f.label] : []));
  return {
    keyed: file?.keyed ?? {},
    ...(!so && file?.summary ? { summary: file.summary } : {}),
    ...(!rec && file?.recommendation ? { recommendation: file.recommendation } : {}),
    redone: [...labels, ...(so ? ['一句话回答'] : []), ...(rec ? ['推荐表'] : [])],
  };
}

/** The plan vN was written on (its research_plan link), else the folder's latest. */
async function planOf(ctx: ToolContext, data: Record<string, unknown>): Promise<ResearchPlanNote | null> {
  const p = linkPath(data.research_plan);
  const note = p ? await ctx.vault.read(`${p}.md`).catch(() => null) : null;
  return note?.data.type === 'research_plan' ? (note.note as ResearchPlanNote) : (ctx.research?.plan ?? null);
}

/**
 * --backfill-judgment: a report written before judgment files existed gets one, read back from its body (WS-A v7,
 * W5 v5). Nothing else is written. A hypothesis that cannot be read is left out and said.
 */
export async function backfillJudgment(ctx: ToolContext, reportPath: string): Promise<{ path: string; claims: string[]; unreadable: { label: string; why: string }[] }> {
  const base = await ctx.vault.read(reportPath);
  if (base.data.type !== 'report') throw new RewriteDenied(`${reportPath} 不是报告`);
  if (await readJudgmentFile(ctx.vault, reportPath)) throw new RewriteDenied(`${judgmentFilePath(reportPath)} 已经有了，不覆盖`);
  const plan = await planOf(ctx, base.data);
  if (!plan) throw new RewriteDenied(`找不到 ${reportPath} 用的计划`);
  const read = frozenFromBody(base.body, plan);
  const file = judgmentFileFromBody(reportPath, base.body, read.frozen);
  const path = await saveJudgmentFile(ctx.vault, reportPath, file);
  return { path, claims: file.claims.map((c) => c.label), unreadable: read.unreadable };
}

export async function rewriteReport(o: RewriteOptions): Promise<ExecuteResult> {
  const t0 = Date.now();
  const { ctx } = o;
  const plan = ctx.research?.plan ?? null;
  if (ctx.phase !== 'research_execute' || !ctx.research || !plan || !ctx.research.planPath || !isPlanApproved(plan)) {
    throw new RewriteDenied('这个调查目录里最新的计划还没有批准：批准以后才能重写');
  }
  const planPath = ctx.research.planPath;
  const researchDir = ctx.research.dir;
  if (!o.reportPath.startsWith(`${researchDir}/`)) throw new RewriteDenied(`${o.reportPath} 不在 ${researchDir} 里`);
  const base = await ctx.vault.read(o.reportPath);
  if (base.data.type !== 'report') throw new RewriteDenied(`${o.reportPath} 不是报告`);
  const from = Number(base.data.version) || versionOf(o.reportPath.replace(/\.md$/, ''));
  const record = await loadEvidenceRecord(ctx.vault, o.reportPath, base.data);
  if (!record.length) throw new RewriteDenied(`报告 v${from} 没有证据记录，没法只重写`);
  const { evidence, missing } = await restoreAll(ctx.vault, record, o.reportPath);
  if (missing.length && !o.allowMissing) throw new RewriteMissing(missing, record.length, from);
  const baseRun = (base.data.research_run ?? {}) as Record<string, unknown>;
  const mode = (baseRun.mode ?? base.data.run_mode) === 'small' ? 'small' : 'full';
  const first = await originalRun(ctx.vault, base.data, from);
  const count = (k: string) => (typeof first.run[k] === 'number' ? (first.run[k] as number) : 0);

  const client = startRunClient(researchDir, NO_WEB, mode);
  try {
    const { model, judgmentModel, modelInfo, judgmentInfo } = await resolveRunModels(ctx.vault, { model: o.model, modelInfo: o.modelInfo });
    const rc = await loadResearchContext(ctx, { sources: false });
    const related = await findRelatedDecisions(ctx);
    rc.decisions = related.map((d) => ({ path: d.path, name: d.name, status: '已确认', excerpt: d.decision.length > 700 ? `${d.decision.slice(0, 700)}…` : d.decision }));
    const run = new ResearchRun({ ctx, mode, model, judgmentModel, client, emit: o.emit ?? (() => {}), signal: o.signal, contextText: renderContext(rc), evalTimeoutMs: o.evalTimeoutMs });

    run.evidence.push(...evidence);
    // the hypotheses vN judged, in the plan's reading order
    const judged = [...new Set(record.map((r) => r.claim))];
    const { selected, notExecuted } = selectScope(plan.claims, run.limits, judged, treeOrder(plan));
    run.step('s1', 1, `只重写：用 报告 v${from} 的证据`, 'done', `${selected.map((s) => s.claim.id).join('、')}；证据 ${evidence.length} 条（记录里 ${record.length} 条），不联网`);
    await run.log('research:rewrite', `只重写 报告 v${from}：按 ${planPath.split('/').pop()?.replace(/\.md$/, '')} 重写 ${selected.map((s) => s.claim.id).join('、')}`, `证据沿用 v${from} 的 ${evidence.length} 条，搜索 0 次、抓取 0 次 · 模型：${modelInfo.label}（${modelInfo.model}）${judgmentInfo ? ` · 判断用：${judgmentInfo.label}（${judgmentInfo.model}）` : ''}`);

    const beforePath = linkPath(base.data.research_plan);
    const before = beforePath ? await ctx.vault.read(`${beforePath}.md`).catch(() => null) : null;
    const beforePlan = before?.data.type === 'research_plan' ? (before.note as ResearchPlanNote) : null;
    // D-48 第 4 轮: vN's judgment kept; only the writing is redone
    const { frozen, source, file } = await frozenJudgments(ctx.vault, o.reportPath, base.body, beforePlan ?? plan);
    if (o.rerender) {
      // every part from the file, or nothing: a model call is not an option here
      const short = [...frozen.values()].flatMap((f) => ('unreadable' in f ? [`读不回来（${f.unreadable}）`] : !f.stored ? [`${f.label} 没有存判断`] : []));
      if (!file || file.source === 'body' || !file.summary || !file.recommendation || short.length) {
        throw new RewriteDenied(`只重新渲染要 报告 v${from} 的判断文件存着全部卡片、一句话回答和推荐判断：${!file ? '没有判断文件' : file.source === 'body' ? '判断文件是从正文读回的' : [...(!file.summary ? ['没存一句话回答'] : []), ...(!file.recommendation ? ['没存推荐判断'] : []), ...short].join('；')}`);
      }
      // a call would be a bug, and says so
      run.llm = async (task) => {
        throw new Error(`只重新渲染不调模型：不该有 ${task}`);
      };
    }
    const kept = o.rerender ? keepOf(frozen, file, []) : o.only?.length ? keepOf(frozen, file, o.only) : undefined;
    // vN's one-line answer was flagged: kept, it is checked again (its flags carried over)
    const keep = kept ? { ...kept, flagged: Array.isArray(base.data.summary_flags) && base.data.summary_flags.length > 0 } : undefined;
    if (o.rerender) await run.log('research:rerender', `只重新渲染 报告 v${from}：全部卡片、一句话回答和推荐判断照判断文件原样`, `${o.rerender.note?.trim() || RERENDER_NOTE}；不调模型`);
    else if (keep) await run.log('research:rewrite-only', `局部重做 报告 v${from}：${keep.redone.join('、')}${keep.summary ? '' : '（一句话回答 v' + from + ' 没存，重新写）'}${keep.recommendation ? '' : '（推荐表 v' + from + ' 没存，重新写）'}`, '其余照 v' + from + ' 的判断文件原样沿用；判断全部冻结');
    await run.log('research:frozen', `沿用 报告 v${from} 的逐条判断（${source === 'file' ? '判断文件' : '从正文读回'}）：${[...frozen].map(([id, f]) => `${id}${'unreadable' in f ? '（读不回来）' : ''}`).join('、')}`, '只改写法：条件的状态照原样沿用，整体判断由代码推出');
    const verdictsBefore = Object.fromEntries(Object.entries((base.data.verdicts_proposed ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(normalizeVerdict(v))]));

    const result = await judgeAndWrite({
      run,
      plan,
      planPath,
      researchDir,
      selected,
      notExecuted,
      related,
      workplanPath: rc.workplan?.path,
      modelInfo,
      judgmentInfo,
      t0,
      repairRounds: o.repairRounds,
      // 怎么查的: how the evidence was found, by the run that found it
      facts: {
        kbCount: count('kbSources'),
        webCount: count('webSources'),
        searches: count('searches'),
        fetches: count('fetches'),
        rewrite: { from, countsFrom: first.version, fromLink: linkTo(o.reportPath), plan: planLine(plan, planPath, beforePlan, beforePath, from), verdictsBefore, ...(missing.length ? { missing: missing.map((m) => m.path) } : {}) },
      },
      frontmatter: { rewrite_of: linkTo(o.reportPath) },
      researchRun: { rewrite: true },
      frozen,
      keep,
      ...(o.rerender ? { rerender: { note: o.rerender.note?.trim() || RERENDER_NOTE } } : {}),
    });
    // the evidence file holds vN's entries as they were (one whose block is gone is still vN's record)
    await writeEvidenceSidecar(ctx.vault, result.reportPath, record);
    await run.log('research:rewrite', `${result.reportName} ${result.delivered ? '已交付' : '草稿（未交付）'}（用 报告 v${from} 的证据重写）`, `搜索 ${client.usage().searches} 次、抓取 ${client.usage().fetches} 次`);
    return result;
  } finally {
    clearRunClient(researchDir);
  }
}
