/**
 * D-56 ⑦: 三关核对. A footnote in the report's first layer (the Summary, a card's 回答 and 理由, as entity-check walks
 * it) is verified only when three independent checks all hold the clause it ends:
 *   - entity: no model; the clause's names and numbers are in the source (entity-check's missingFrom);
 *   - deepseek: one model judges the (clause, original) pair (撑得住 / 部分 / 挂错);
 *   - kimi: a second, different model judges the same pair independently, at the same time.
 * `verified = entity.pass && deepseek.fit === '撑得住' && kimi.fit === '撑得住'`; anything else (a judge that failed,
 * 部分, 挂错, a pair a judge did not return) is not verified. The report body is never changed: this module returns
 * the result only.
 */
import type { LanguageModel } from 'ai';
import { loadModelsConfig } from '@/lib/config/models';
import type { ToolContext } from '@/lib/harness/types';
import { citationVerifyPrompt } from '@/lib/harness/prompts/research-execute';
import { getModel, type CallOptions, type ResolvedModel } from '@/lib/models/provider';
import type { Vault } from '@/lib/vault';
import { batchesOf, judgeBatch, type CitationSite, type Fit, type Judged } from './citation-fit';
import { firstLayerClauses, footnoteSources, missingFrom, type FootnoteSource } from './entity-check';
import { llmJson } from './llm';
import type { ResearchRun } from './run';

/** One footnote where it is used: the clause, the id, the block link and the originals. */
export interface VerifyPair {
  id: string;
  footnote: string; // "[^9]"
  ref: string; // the block link
  sentence: string;
  quote: string;
  source: string; // FootnoteSource.text
}

/** What one model said about a pair; null when it failed or did not return the pair. */
export interface ModelGate {
  fit: Fit | null;
  reason: string;
  /** D-64 T24, the second check: what the original can support and what it cannot. */
  can?: string;
  cannot?: string;
}

/** T24: the second check passes only when it says what the original can and cannot support, two different things. */
export const scopeStated = (g: ModelGate): boolean => {
  const can = g.can?.trim() ?? '';
  const cannot = g.cannot?.trim() ?? '';
  return !!can && !!cannot && can !== cannot;
};
const secondPasses = (g: ModelGate) => g.fit === '撑得住' && scopeStated(g);

export interface VerifiedCitation {
  footnote: string;
  ref: string;
  sentence: string;
  verified: boolean;
  /** T24 (D63 §3.2): the second check's can / cannot, on the item for the citation popup. */
  can: string;
  cannot: string;
  entity: { pass: boolean; missing: string[] };
  deepseek: ModelGate;
  kimi: ModelGate;
}

export interface CitationVerifyResult {
  items: VerifiedCitation[];
  counts: { checked: number; verified: number; failed: { entity: number; deepseek: number; kimi: number } };
  /** The message of a judge that rejected (only present when it rejected). */
  errors: { deepseek?: string; kimi?: string };
  seconds: number;
}

/**
 * D-56 ⑦ measured: kimi-k2.6 with its default thinking takes 150–250 s a report; with thinking disabled and
 * temperature 0.6 (the only temperature Moonshot accepts in that mode) 5–6 s, same accuracy.
 */
export const KIMI_JUDGE_CALL: CallOptions = { thinking: 'disabled', temperature: 0.6 };

/**
 * The provider the second judge uses for a run on `providerId`: MODEL_PROVIDER when set (it overrides every role, D8),
 * else the `review` role of 模型.md, else kimi, unless the run is on kimi, then deepseek.
 */
export async function secondJudgeProviderId(vault: Vault, providerId: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const override = env.MODEL_PROVIDER?.trim();
  if (override) return override;
  const review = await loadModelsConfig(vault).then((c) => c.roles?.review, () => undefined);
  return review ?? (providerId === 'kimi' ? 'deepseek' : 'kimi');
}

export async function secondJudgeModel(vault: Vault, providerId: string): Promise<ResolvedModel> {
  const pid = await secondJudgeProviderId(vault, providerId);
  return getModel({ vault, providerId: pid, call: pid === 'kimi' ? KIMI_JUDGE_CALL : undefined });
}

export type FitJudge = (items: CitationSite[]) => Promise<Map<string, Judged>>;

/** Every footnote of the first layer that has a source, one pair each; a duplicate (ref + sentence) is skipped. */
export function verifyPairs(body: string, sources: ReadonlyMap<string, FootnoteSource>): VerifyPair[] {
  const out: VerifyPair[] = [];
  for (const { sentence, footnotes } of firstLayerClauses(body)) {
    for (const id of footnotes) {
      const src = sources.get(id);
      if (!src) continue;
      if (out.some((p) => p.ref === src.ref && p.sentence === sentence)) continue;
      out.push({ id: `p${out.length + 1}`, footnote: `[^${id}]`, ref: src.ref, sentence, quote: src.quote ?? src.text, source: src.text });
    }
  }
  return out;
}

/** The entity gate: nothing the clause names or counts is missing from the source. */
export function entityGate(sentence: string, source: string): { pass: boolean; missing: string[] } {
  const missing = missingFrom(sentence, source);
  return { pass: missing.length === 0, missing };
}

/** D-56 ⑦ measured: 20 a batch took 109–209 s a report with the second model, 5 a batch run at once 4–8 s. */
export const VERIFY_BATCH = 5;

/** One judge: all batches at once, in the verify wording. */
export function fitJudge(run: Pick<ResearchRun, 'llm' | 'log' | 'signal'>, task: string): FitJudge {
  return async (items) => {
    const maps = await Promise.all(batchesOf(items, VERIFY_BATCH).map((b) => judgeBatch(run, b, task, citationVerifyPrompt)));
    const out = new Map<string, Judged>();
    for (const m of maps) for (const [k, v] of m) out.set(k, v);
    return out;
  };
}

/** A run that asks `model` instead of the run's own (a second provider judging the same pairs). */
export function modelRun(model: LanguageModel, base: Pick<ResearchRun, 'log' | 'signal'>): Pick<ResearchRun, 'llm' | 'log' | 'signal'> {
  return {
    log: base.log,
    signal: base.signal,
    llm: (task, p, schema, opts) =>
      llmJson({ model, task, system: p.system, prompt: p.prompt, schema, signal: base.signal, timeoutMs: opts?.timeoutMs, maxOutputTokens: opts?.maxOutputTokens }),
  };
}

/**
 * The whole step: both judges at the same time; a judge that rejects leaves its gate null for every pair (nothing is
 * thrown). Verified only when all three gates pass.
 */
export async function verifyCitations(pairs: VerifyPair[], judges: { deepseek: FitJudge; kimi: FitJudge }): Promise<CitationVerifyResult> {
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 100) / 10;
  const empty = { items: [], counts: { checked: 0, verified: 0, failed: { entity: 0, deepseek: 0, kimi: 0 } }, errors: {}, seconds: secs() };
  if (!pairs.length) return empty;
  // the prompt puts the key in brackets itself ("[^9]", not "[[^9]]")
  const sites: CitationSite[] = pairs.map((p) => ({ id: p.id, part: 'verify', sentence: p.sentence, key: p.footnote.replace(/^\[|\]$/g, ''), quote: p.quote }));
  const [d, k] = await Promise.allSettled([judges.deepseek(sites), judges.kimi(sites)]);
  const byId = (r: PromiseSettledResult<Map<string, Judged>>) => (r.status === 'fulfilled' ? r.value : new Map<string, Judged>());
  const errors: { deepseek?: string; kimi?: string } = {};
  if (d.status === 'rejected') errors.deepseek = d.reason instanceof Error ? d.reason.message : String(d.reason);
  if (k.status === 'rejected') errors.kimi = k.reason instanceof Error ? k.reason.message : String(k.reason);
  const ds = byId(d);
  const km = byId(k);
  const none = (): ModelGate => ({ fit: null, reason: '' });
  const items: VerifiedCitation[] = pairs.map((p) => {
    const entity = entityGate(p.sentence, p.source);
    const deepseek = ds.get(p.id) ?? none();
    const kimi = km.get(p.id) ?? none();
    return { footnote: p.footnote, ref: p.ref, sentence: p.sentence, verified: entity.pass && secondPasses(deepseek) && kimi.fit === '撑得住', can: deepseek.can?.trim() ?? '', cannot: deepseek.cannot?.trim() ?? '', entity, deepseek, kimi };
  });
  return {
    items,
    counts: {
      checked: items.length,
      verified: items.filter((x) => x.verified).length,
      failed: {
        entity: items.filter((x) => !x.entity.pass).length,
        deepseek: items.filter((x) => !secondPasses(x.deepseek)).length,
        kimi: items.filter((x) => x.kimi.fit !== '撑得住').length,
      },
    },
    errors,
    seconds: secs(),
  };
}

/** What the report's frontmatter keeps (`citation_verify`): the counts, the two judges and every pair. */
export interface CitationVerifyRecord {
  checked: number;
  verified: number;
  seconds: number;
  /** "label（model）" of the two judges, e.g. "DeepSeek V4.1-Flash（deepseek-flash）". null when it could not be made. */
  judges: { first: string; second: string | null };
  items: VerifiedCitation[];
}

/** No second judge could be made: it rejects, so every second gate is null and nothing is verified. */
const noSecondJudge: FitJudge = async () => {
  throw new Error('the second judge is not available');
};

/**
 * The whole step on a report as rendered: every first-layer footnote with a source (entity, this run's model, a second
 * model, all at once), null when there is no pair (no model call). Recorded only: the body is never changed and nothing
 * here keeps a report a draft. `second` is the injected judge (tests); otherwise provider `kimi` judges, or `deepseek`
 * when the run itself is on kimi.
 */
export async function runCitationVerify(
  run: ResearchRun,
  ctx: ToolContext,
  body: string,
  fromPath: string,
  providerId: string,
  second?: LanguageModel,
): Promise<CitationVerifyRecord | null> {
  const pairs = verifyPairs(body, await footnoteSources(ctx.vault, body, fromPath));
  if (!pairs.length) return null;
  const first = fitJudge(run, 'citation-verify:first');
  // the run's model info is not on `run`: its label comes from 90_配置/模型.md, or the provider id when it is not there
  let firstLabel = providerId;
  try {
    const p = (await loadModelsConfig(ctx.vault)).providers[providerId];
    if (p) firstLabel = `${p.label}（${p.model}）`;
  } catch {
    /* no readable config: the provider id stands */
  }
  let secondJudge = noSecondJudge;
  let secondLabel: string | null = null;
  if (second) {
    secondJudge = fitJudge(modelRun(second, run), 'citation-verify:second');
    secondLabel = 'injected';
  } else {
    const pid = await secondJudgeProviderId(ctx.vault, providerId);
    try {
      const resolved = await secondJudgeModel(ctx.vault, providerId);
      secondJudge = fitJudge(modelRun(resolved.model, run), 'citation-verify:second');
      secondLabel = `${resolved.provider.label}（${resolved.provider.model}）`;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      await run.log('research:citation-verify-no-second', `第二个模型（${pid}）用不了：${why}`, '第二个模型用不了：这一次没有引用能拿到 ✓');
    }
  }
  const r = await verifyCitations(pairs, { deepseek: first, kimi: secondJudge });
  for (const [gate, message] of Object.entries(r.errors) as ['deepseek' | 'kimi', string][]) {
    await run.log(
      'research:citation-verify-judge-failed',
      `${gate === 'deepseek' ? '第一个' : '第二个'}模型判引用失败：${message.replace(/sk-[A-Za-z0-9]+/g, '***').slice(0, 160)}`,
      '这一关全部判未通过：这一次没有引用能拿到 ✓',
    );
  }
  const record: CitationVerifyRecord = { checked: r.counts.checked, verified: r.counts.verified, seconds: r.seconds, judges: { first: firstLabel, second: secondLabel }, items: r.items };
  await run.log(
    'research:citation-verify',
    `三关核对：查了 ${record.checked} 个，${record.verified} 个三关都过（挂 ✓），其余显示为相关资料；用了 ${record.seconds} 秒`,
    '实体核对 + 两个不同的模型各判一次，三关全过才挂 ✓；正文不改，不阻止交付',
  );
  return record;
}
