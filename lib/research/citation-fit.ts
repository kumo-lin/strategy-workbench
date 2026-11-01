/**
 * D-48 第 3 轮: "引用对得上吗". (第 4 轮 D: in the Summary and the recommendation a 挂错 one is only flagged; the repair
 * below is for the cards' answers.) Each footnote of the Summary (its answers, the table's card answers, 所以联想) and of the
 * recommendation, the sentence that carries it paired with the footnote's original, judged in one model call: 撑得住,
 * 部分 or 挂错 (WS-A v6: [^22] "未采购的主要障碍是 ROI" on "77% 的 CIO 认为安全与风险是最大障碍").
 *
 * A 挂错 goes to one repair call: another key from the evidence these parts already use that holds the sentence, else
 * the footnote goes and the sentence says it one notch softer ("多半……"), its other footnotes kept. No new evidence,
 * no web. The replaced ones are judged once more; what is still 挂错 is `citation_flags`, never a reason to keep the
 * report a draft. Run on the parts as the model wrote them ([E#]), after the report's repair rounds.
 */
import type { Evidence } from './evidence';
import type { ClaimResult } from './judge';
import { LlmJsonError, LlmTruncatedError } from './llm';
import { numbersIn } from './number-check';
import type { ResearchRun } from './run';
import type { SummaryDraft } from './schemas';
import { citationFitPrompt, citationRepairPrompt } from '@/lib/harness/prompts/research-execute';
import { z } from 'zod';

export const FITS = ['撑得住', '部分', '挂错'] as const;
export type Fit = (typeof FITS)[number];

/** What `citation_flags` keeps (the page marks the footnote, M4): the footnote as the report numbers it, the sentence, the original, why. */
export interface CitationFlag {
  footnote: string;
  /** The evidence's block link: the page places the mark by sentence + ref (the footnote number may change). */
  ref: string;
  sentence: string;
  quote: string;
  reason: string;
}

/** One footnote where it is used: `id` addresses it in the calls; `part` is the text it sits in. */
export interface CitationSite {
  id: string;
  part: string;
  sentence: string;
  key: string;
  quote: string;
}

/** The texts checked, by id: where each sits in the results and the Summary (get / set). */
interface Part {
  id: string;
  text: string;
  set: (r: Draft, text: string) => Draft;
}
type Draft = { results: ClaimResult[]; summary: SummaryDraft };

const KEY_GROUP = /[[【]\s*E\d+[^\]】\n]*[\]】]/g;

/** The condition a segment stands on ("①", or "Q2-1①"). */
const conditionOf = (r: ClaimResult, cond: string) => r.conditions?.find((c) => c.label === cond.trim().replace(/^Q\d+(?:-\d+)?\s*/, ''));
const keysIn = (t: string) => [...t.matchAll(KEY_GROUP)].flatMap((m) => m[0].match(/E\d+/g) ?? []);

/** Sentences of a text; footnotes right after an end mark stay with the sentence before. */
export function sentencesOf(text: string): string[] {
  return (text.match(/[^。；！？!?;\n]+(?:[。；！？!?;]+|$)(?:\s*[[【]\s*E\d+[^\]】\n]*[\]】])*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** The Summary's and the recommendation's texts, and every card answer the Summary table shows (a question tree's). */
function partsOf(d: Draft): Part[] {
  const out: Part[] = [];
  const s = d.summary;
  const add = (id: string, text: string | undefined, set: Part['set']) => {
    if (text?.trim()) out.push({ id, text, set });
  };
  const summary = (f: (x: SummaryDraft, t: string) => SummaryDraft) => (r: Draft, t: string) => ({ ...r, summary: f(r.summary, t) });
  const rec = (f: (x: NonNullable<SummaryDraft['recommendation']>, t: string) => NonNullable<SummaryDraft['recommendation']>) =>
    summary((x, t) => (x.recommendation ? { ...x, recommendation: f(x.recommendation, t) } : x));
  add('summary:so_what', s.so_what, summary((x, t) => ({ ...x, so_what: t })));
  for (const a of s.answers ?? []) add(`summary:answer:${a.id}`, a.answer, summary((x, t) => ({ ...x, answers: x.answers.map((y) => (y.id === a.id ? { ...y, answer: t } : y)) })));
  add('summary:split_basis', s.split_basis, summary((x, t) => ({ ...x, split_basis: t })));
  add('summary:sufficiency', s.sufficiency, summary((x, t) => ({ ...x, sufficiency: t })));
  const withJudgment = (r: Draft, id: string, f: (j: ClaimResult['judgment']) => ClaimResult['judgment']) => ({ ...r, results: r.results.map((y) => (y.claim.id === id ? { ...y, judgment: f(y.judgment) } : y)) });
  for (const r of d.results.filter((x) => x.claim.question)) {
    const segs = r.judgment.answer_segments ?? [];
    // 第 5 轮: a card with segments shows them, not `answer` (W5 v6: a switch in `answer` never reached the page); each
    // segment as it renders, its own condition's keys after its words
    if (segs.length) {
      segs.forEach((g, i) => {
        const shown = (g.keys ?? []).filter((k) => conditionOf(r, g.cond)?.keys.includes(k));
        add(`card:${r.claim.id}:seg:${i}`, `${g.text.trim()}${shown.map((k) => ` [${k}]`).join('')}`, (x, t) =>
          withJudgment(x, r.claim.id, (j) => ({ ...j, answer_segments: j.answer_segments.map((y, n) => (n === i ? { ...y, text: t.replace(KEY_GROUP, '').replace(/\s+([。；，])/g, '$1').trim(), keys: keysIn(t) } : y)) })),
        );
      });
    } else add(`card:${r.claim.id}:answer`, r.judgment.answer, (x, t) => withJudgment(x, r.claim.id, (j) => ({ ...j, answer: t })));
  }
  const rc = s.recommendation;
  if (rc) {
    add('rec:decision_answer', rc.decision_answer, rec((x, t) => ({ ...x, decision_answer: t })));
    add('rec:directive_response', rc.directive_response, rec((x, t) => ({ ...x, directive_response: t })));
    add('rec:action', rc.action, rec((x, t) => ({ ...x, action: t })));
    add('rec:scale', rc.scale, rec((x, t) => ({ ...x, scale: t })));
    rc.metrics.forEach((m, i) => add(`rec:metrics:${i}`, m, rec((x, t) => ({ ...x, metrics: x.metrics.map((y, j) => (j === i ? t : y)) }))));
    rc.alternatives.forEach((a, i) => add(`rec:why_not:${i}`, a.why_not, rec((x, t) => ({ ...x, alternatives: x.alternatives.map((y, j) => (j === i ? { ...y, why_not: t } : y)) }))));
    rc.change_if.forEach((c, i) => add(`rec:change_if:${i}`, c, rec((x, t) => ({ ...x, change_if: x.change_if.map((y, j) => (j === i ? t : y)) }))));
  }
  return out;
}

/** Every footnote of those parts, paired with its original. A key the list does not have is left to the citation check. */
export function citationSites(d: Draft, keyed: Map<string, Evidence>): CitationSite[] {
  const out: CitationSite[] = [];
  for (const p of partsOf(d))
    sentencesOf(p.text).forEach((sentence, i) => {
      for (const key of new Set(keysIn(sentence))) {
        const e = keyed.get(key);
        if (e) out.push({ id: `${p.id}#${i}:${key}`, part: p.id, sentence, key, quote: e.quote });
      }
    });
  return out;
}

/** The sentence with `key` replaced by `to` (or taken out, `to` null), every other key kept. */
export function swapKey(sentence: string, key: string, to: string | null): string {
  // the key it switches to is already there: the wrong one just goes
  if (to && keysIn(sentence).includes(to)) to = null;
  return sentence
    .replace(KEY_GROUP, (g) => {
      const keys = (g.match(/E\d+/g) ?? []).flatMap((k) => (k === key ? (to ? [to] : []) : [k]));
      const uniq = [...new Set(keys)];
      return uniq.length ? `[${uniq.join('][')}]` : '';
    })
    .replace(/\s+([。；，！？!?;,])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** A softened sentence is taken when it keeps the other keys (and adds none) and adds no number. */
export function acceptableSoftening(before: string, key: string, after: string): boolean {
  return acceptableRewording(before, after, key, null);
}

/** A reworded sentence: the wrong key out, `add` in (a switch), every other key kept, none added, no new number. */
export function acceptableRewording(before: string, after: string, drop: string, add: string | null): boolean {
  const want = new Set([...keysIn(before).filter((k) => k !== drop), ...(add ? [add] : [])]);
  const got = new Set(keysIn(after));
  if (want.size !== got.size || [...want].some((k) => !got.has(k))) return false;
  const nb = new Set(numbersIn(before.replace(KEY_GROUP, ' ')).map((n) => n.value));
  return numbersIn(after.replace(KEY_GROUP, ' ')).every((n) => nb.has(n.value));
}

const TRAILING = String.raw`\s*(?:[[【]\s*E\d+[^\]】\n]*[\]】]\s*)*$`;

/**
 * The end mark of the sentence it replaces stays (WS-A v7: "准入由 IT 拍板[^6]；决策与预算……" came back as "准入是否由
 * IT 拍板，还缺证据" and ran into the next sentence): a rewrite without one gets it, a different one is put back.
 */
export function keepEndMark(before: string, after: string): string {
  const mark = new RegExp(`([。；！？!?;])${TRAILING}`).exec(before.trim())?.[1];
  const a = after.trim();
  if (!mark) return a;
  const end = new RegExp(`[。；！？!?;，,](${TRAILING.slice(0, -1)})$`);
  return end.test(a) ? a.replace(end, `${mark}$1`) : `${a}${mark}`;
}

// can / cannot: D-64 T24, asked by the verify wording only (what the original can and cannot support)
const judgedSchema = z.object({ items: z.array(z.object({ id: z.string(), fit: z.enum(FITS).catch('部分'), reason: z.string().catch(''), can: z.string().catch('').optional(), cannot: z.string().catch('').optional() })).catch([]) });
const repairSchema = z.object({
  items: z.array(z.object({ id: z.string(), action: z.enum(['replace', 'drop']).catch('drop'), key: z.string().catch(''), sentence: z.string().catch('') })).catch([]),
});

type Run = Pick<ResearchRun, 'llm' | 'log' | 'signal'>;
/** One pair as a judge returned it. */
export type Judged = { fit: Fit; reason: string; can?: string; cannot?: string };

/**
 * At most this many footnotes per call (WS-A v9: 86 in one call, the answer cut off at the 16000-token limit and the
 * whole check skipped). A batch still cut off is halved.
 */
export const CITATION_BATCH = 20;

export function batchesOf<T>(items: T[], size = CITATION_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One batch; cut off at the limit, halved; still unreadable, its footnotes are left unjudged (logged). */
export async function judgeBatch(
  run: Run,
  sites: CitationSite[],
  task: string,
  prompt: (items: CitationSite[]) => { system: string; prompt: string } = citationFitPrompt,
): Promise<Map<string, Judged>> {
  try {
    const out = await run.llm(task, prompt(sites), judgedSchema);
    return new Map(out.items.map((x) => [x.id, { fit: x.fit, reason: x.reason, ...(x.can !== undefined || x.cannot !== undefined ? { can: x.can ?? '', cannot: x.cannot ?? '' } : {}) }]));
  } catch (e) {
    if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
    if (e instanceof LlmTruncatedError && sites.length > 1) {
      const half = Math.ceil(sites.length / 2);
      return new Map([...(await judgeBatch(run, sites.slice(0, half), task, prompt)), ...(await judgeBatch(run, sites.slice(half), task, prompt))]);
    }
    await run.log('research:citation-fit-failed', `核对 ${sites.length} 个脚注（${sites[0]?.id} 起），模型输出不合格：${e.message.slice(0, 120)}`, '这一批没有判，其余的照常');
    return new Map();
  }
}

/** Every footnote judged, batch by batch; null only when no batch came back. */
async function judge(run: Run, sites: CitationSite[], task: string): Promise<Map<string, { fit: Fit; reason: string }> | null> {
  const all = new Map<string, { fit: Fit; reason: string }>();
  for (const b of batchesOf(sites)) for (const [k, v] of await judgeBatch(run, b, task)) all.set(k, v);
  return all.size || !sites.length ? all : null;
}

/** What code changed (`citation_fixes`): a key switched, a footnote taken out, a sentence said softer. Never silent. */
export interface CitationFix {
  footnote: string;
  /** The 挂错 evidence's block link. */
  ref: string;
  action: '换编号' | '删脚注' | '降语气';
  from: string | null;
  to: string | null;
  sentence_before: string;
  sentence_after: string;
}
/** The same, by evidence key, before the report is numbered (citationFixesOf). */
export interface CitationFixRecord {
  /** The 挂错 footnote's key. */
  key: string;
  action: CitationFix['action'];
  from: string | null;
  to: string | null;
  before: string;
  after: string;
}

export interface CitationFitResult extends Draft {
  /** True when a sentence was changed (the report is rendered again). */
  changed: boolean;
  /** Still 挂错 after the repair, by key (the footnote number is the rendered report's: citationFlagsOf). */
  misfits: { key: string; sentence: string; quote: string; reason: string }[];
  fixes: CitationFixRecord[];
  /** The 挂错 ones of the first judgment, by site id, with why (to flag them all when the fixes are undone). */
  wrong: Map<string, string>;
  /** For the appendix line "引用核对：查了 N 个，换了 a 个，删了 b 个，标了 c 个". */
  counts: { checked: number; replaced: number; removed: number; flagged: number };
  seconds: number;
}

/**
 * The keys a 挂错 footnote may switch to (规划 10/26, (a)): those the same hypothesis already uses, its card's judgment
 * (a Summary or recommendation sentence: the hypotheses whose evidence it cites), never the wrong one.
 */
function candidatesOf(s: CitationSite, d: Draft, keyed: Map<string, Evidence>): { candidates: { key: string; quote: string }[]; established: string[] } {
  // a segment shows only its own condition's keys: it may switch only to one of those
  const seg = /^card:(.+):seg:(\d+)$/.exec(s.part);
  const segCard = seg ? d.results.find((r) => r.claim.id === seg[1]) : undefined;
  if (seg && segCard) {
    const c = conditionOf(segCard, segCard.judgment.answer_segments[Number(seg[2])]?.cond ?? '');
    return {
      candidates: (c?.keys ?? []).filter((k) => k !== s.key && keyed.has(k)).map((key) => ({ key, quote: keyed.get(key)!.quote })),
      established: (segCard.conditions ?? []).filter((x) => x.status === '成立').map((x) => `${segCard.label} ${x.label} ${x.text}`),
    };
  }
  const own = d.results.filter((r) => s.part.startsWith(`card:${r.claim.id}:`) || keysIn(s.sentence).some((k) => r.keyed.has(k)));
  const keys = new Set<string>();
  for (const r of own) for (const k of [...keysIn(s.sentence), ...(JSON.stringify(r.judgment).match(/E\d+/g) ?? [])]) if (k !== s.key && r.keyed.has(k) && keyed.has(k)) keys.add(k);
  // what the hypothesis already holds: a softening must not deny it (WS-A v7: H1 ① 成立, "准入在 IT 侧", softened away)
  const established = own.flatMap((r) => (r.conditions ?? []).filter((c) => c.status === '成立').map((c) => `${r.label} ${c.label} ${c.text}`));
  return { candidates: [...keys].map((key) => ({ key, quote: keyed.get(key)!.quote })), established };
}

/** A clause with a number keeps its footnote ((b): no number without a source); it is flagged instead. */
const hasNumber = (sentence: string) => numbersIn(sentence.replace(KEY_GROUP, ' ')).length > 0;

/**
 * The whole step. One call judges every footnote; the 挂错 ones go to one repair call, which may switch a key only to
 * one the same hypothesis uses, and only when that key, put in the sentence, is judged 撑得住 (the switches are judged
 * together, before any is made: never a key nobody judged); else the footnote goes and the sentence says it softer,
 * unless it has a number. 部分 is left as it is. Without a footnote there is no call.
 */
export async function citationFit(run: Run, d: Draft, keyed: Map<string, Evidence>, kept: (part: string) => boolean = () => false): Promise<CitationFitResult> {
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 100) / 10;
  const sites = citationSites(d, keyed);
  const result = (x: Partial<CitationFitResult>): CitationFitResult => ({
    ...d, changed: false, misfits: [], fixes: [], wrong: new Map(), counts: { checked: sites.length, replaced: 0, removed: 0, flagged: 0 }, ...x, seconds: secs(),
  });
  if (!sites.length) return result({});
  const first = await judge(run, sites, 'citation-fit');
  if (!first) return result({});
  const misjudged = sites.filter((s) => first.get(s.id)?.fit === '挂错');
  const partly = sites.filter((s) => first.get(s.id)?.fit === '部分').length;
  const reasonOf = (s: CitationSite) => first.get(s.id)?.reason ?? '';
  // D-48 第 4 轮 D: the Summary and the recommendation are only flagged, their words never changed; a card's answer
  // is repaired as before
  // (第 5 轮 --only: a part kept word for word is only flagged too)
  const repairable = (s: CitationSite) => s.part.startsWith('card:') && !kept(s.part);
  const onlyFlagged = misjudged.filter((s) => !repairable(s));
  const wrong = misjudged.filter(repairable);
  const flagOnly = onlyFlagged.map((s) => ({ key: s.key, sentence: s.sentence, quote: s.quote, reason: reasonOf(s) }));
  if (!wrong.length) {
    await run.log('research:citation-fit', `引用核对：查了 ${sites.length} 个，${misjudged.length ? `标了 ${flagOnly.length} 个` : '没有挂错'}（部分撑得住 ${partly} 个，不动），用了 ${Math.round(secs())} 秒`, 'D-48：Summary 和推荐表的脚注逐个对原文，挂错的只标不改');
    return result({ misfits: flagOnly, wrong: new Map(misjudged.map((x) => [x.id, reasonOf(x)])), counts: { checked: sites.length, replaced: 0, removed: 0, flagged: flagOnly.length } });
  }

  const offered = new Map(wrong.map((s) => [s.id, candidatesOf(s, d, keyed)]));
  const candidates = new Map([...offered].map(([id, o]) => [id, o.candidates]));
  const proposed: z.infer<typeof repairSchema>['items'] = [];
  for (const b of batchesOf(wrong)) {
    try {
      proposed.push(...(await run.llm('citation-fit:repair', citationRepairPrompt(b.map((s) => ({ ...s, reason: reasonOf(s), ...offered.get(s.id)! }))), repairSchema)).items);
    } catch (e) {
      if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
      await run.log('research:citation-fit-failed', `修 ${b.length} 个挂错的脚注，模型输出不合格：${e.message.slice(0, 120)}`, '这一批照实标出来，不阻止交付');
    }
  }
  const fixOf = (s: CitationSite) => proposed.find((x) => x.id === s.id);
  const switchTo = (s: CitationSite) => {
    const f = fixOf(s);
    const to = f?.action === 'replace' ? f.key.replace(/[[\]\s]/g, '') : '';
    return to && to !== s.key && candidates.get(s.id)!.some((c) => c.key === to) ? to : '';
  };
  // a switch may narrow the sentence to what the new key's original says (WS-A v7: "由 IT 拍板" → "在 IT 侧", [^14]);
  // the wrong key out, the new one in, nothing else added
  const switchedSentence = (s: CitationSite, to: string) => {
    const said = fixOf(s)?.sentence.trim() ?? '';
    return said && acceptableRewording(s.sentence, said, s.key, to) ? keepEndMark(s.sentence, said) : swapKey(s.sentence, s.key, to);
  };
  // a switch is made only to a key judged 撑得住 in that sentence: already (the words unchanged), or in one call for all
  const held = new Map<string, string>();
  const toJudge: CitationSite[] = [];
  for (const s of wrong) {
    const to = switchTo(s);
    if (!to) continue;
    const sentence = switchedSentence(s, to);
    const there = sites.find((x) => x.part === s.part && x.sentence === s.sentence && x.key === to);
    if (there && first.get(there.id)?.fit === '撑得住' && sentence === swapKey(s.sentence, s.key, to)) held.set(s.id, sentence);
    else toJudge.push({ ...s, id: `${s.id}>${to}`, sentence, key: to, quote: keyed.get(to)!.quote });
  }
  if (toJudge.length) {
    const judged = await judge(run, toJudge, 'citation-fit:verify');
    for (const v of toJudge) if (judged?.get(v.id)?.fit === '撑得住') held.set(v.id.split('>')[0], v.sentence);
  }

  let draft: Draft = d;
  const misfits: CitationFitResult['misfits'] = [...flagOnly];
  const fixes: CitationFixRecord[] = [];
  const texts = new Map(partsOf(d).map((p) => [p.id, p.text]));
  // two misfits in one sentence: the second works on the sentence as the first left it
  const current = new Map<string, string>();
  for (const s of wrong) {
    const at = `${s.part}|${s.sentence}`;
    const now = current.get(at) ?? s.sentence;
    const flag = (why: string) => misfits.push({ key: s.key, sentence: now, quote: s.quote, reason: reasonOf(s) || why });
    const fix = fixOf(s);
    const switched = held.get(s.id);
    // the second misfit of a sentence the first reworded: only the bare switch still fits it
    const to = switched !== undefined && (now === s.sentence || switched === swapKey(s.sentence, s.key, switchTo(s))) ? switchTo(s) : '';
    let next: string | null = null;
    if (to) next = now === s.sentence ? switched! : swapKey(now, s.key, to);
    else if (fix?.action === 'drop' && !hasNumber(s.sentence) && now === s.sentence && fix.sentence.trim() && acceptableSoftening(s.sentence, s.key, fix.sentence.trim())) next = keepEndMark(s.sentence, fix.sentence);
    const text = texts.get(s.part) ?? '';
    if (!next || !text.includes(now)) {
      if (fix?.action === 'drop' && hasNumber(s.sentence)) await run.log('research:citation-fit-kept', `${s.key}：「${now.slice(0, 60)}」有数字，不删脚注，标出来`, '报告里不能有出处不明的数字');
      flag('原文撑不住这句');
      continue;
    }
    current.set(at, next);
    const updated = text.replace(now, next);
    texts.set(s.part, updated);
    draft = partsOf(draft).find((p) => p.id === s.part)!.set(draft, updated);
    if (to) {
      fixes.push({ key: s.key, action: '换编号', from: s.key, to, before: now, after: next });
      // narrowed to what the new original says: that is said softer too, and recorded
      if (next !== swapKey(now, s.key, to)) fixes.push({ key: s.key, action: '降语气', from: null, to: null, before: now, after: next });
    }
    else fixes.push({ key: s.key, action: '删脚注', from: s.key, to: null, before: now, after: next }, { key: s.key, action: '降语气', from: null, to: null, before: now, after: next });
    await run.log('research:citation-fit-fixed', `${s.key} 挂错（${reasonOf(s).slice(0, 60)}）：${to ? `换成 ${to}` : '去掉这个脚注，语气降一档'}：「${next.slice(0, 60)}」`, 'D-48：只用同一假设已有的证据，换上去的判过撑得住；记进 citation_fixes');
  }
  const counts = { checked: sites.length, replaced: fixes.filter((f) => f.action === '换编号').length, removed: fixes.filter((f) => f.action === '删脚注').length, flagged: misfits.length };
  await run.log(
    'research:citation-fit',
    `引用核对：查了 ${counts.checked} 个，换了 ${counts.replaced} 个，删了 ${counts.removed} 个，标了 ${counts.flagged} 个（部分撑得住 ${partly} 个，不动），用了 ${Math.round(secs())} 秒`,
    'D-48：还挂错的照实标出来（frontmatter citation_flags），不阻止交付',
  );
  return { ...draft, changed: draft !== d, misfits, fixes, counts, wrong: new Map(misjudged.map((x) => [x.id, reasonOf(x)])), seconds: secs() };
}

/** No check this time (--rerender: the model is not asked; recheck-citations runs it on the report written). */
export const noCitationFit = (d: Draft): CitationFitResult => ({ ...d, changed: false, misfits: [], fixes: [], wrong: new Map(), counts: { checked: 0, replaced: 0, removed: 0, flagged: 0 }, seconds: 0 });

/** The footnote number of an evidence in the rendered report ("[^9]"), from its definition line. */
export function footnoteOf(body: string, e: Evidence): string | null {
  const ref = e.ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\[\\^(\\d+)\\]:.*${ref}\\s*$`, 'm').exec(body);
  return m ? `[^${m[1]}]` : null;
}

/** A sentence as the rendered report numbers its footnotes. */
const numbered = (sentence: string, body: string, keyed: Map<string, Evidence>) =>
  sentence
    .replace(KEY_GROUP, (g) => (g.match(/E\d+/g) ?? []).map((k) => (keyed.get(k) ? (footnoteOf(body, keyed.get(k)!) ?? '') : '')).join(''))
    .replace(/\s+(\[\^)/g, '$1')
    .trim();

/** The words of a sentence, without its marks, for comparing. */
const plain = (t: string) => t.replace(/\[\^\d+\]|[[【]\s*E\d+[^\]】\n]*[\]】]|（还缺证据）|\*\*|\s/g, '');
function likeness(a: string, b: string): number {
  const grams = (t: string) => new Set([...t].slice(0, -1).map((c, i) => c + t[i + 1]));
  const ga = grams(plain(a));
  const gb = grams(plain(b));
  if (!ga.size || !gb.size) return 0;
  return (2 * [...ga].filter((g) => gb.has(g)).length) / (ga.size + gb.size);
}

/** The sentences of a rendered body (before the footnote definitions), table cells and <br> breaks too. */
function bodySentences(body: string): string[] {
  const main = body.split(/\n\[\^\d+\]:/)[0].replace(/<br>/g, '\n').replace(/\|/g, '\n');
  return main.split('\n').flatMap((l) => l.match(/[^。；！？!?;\n]+(?:[。；！？!?;]+|$)(?:\s*\[\^\d+\])*/g) ?? []).map((x) => x.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
}

/**
 * 第 5 轮 (b): where a checked sentence ended up in the final body. The sentence carrying `e`'s footnote most like the
 * words as checked (the renderer joins segments, expands [Q2-1①], drops keys a role does not allow); without `e`,
 * the most like one at all, if like enough. Null: it is not in the report.
 */
export function placedSentence(body: string, like: string, e?: Evidence): string | null {
  const fn = e ? footnoteOf(body, e) : null;
  if (e && !fn) return null;
  const pool = bodySentences(body).filter((x) => !fn || x.includes(fn));
  let best: string | null = null;
  let score = fn ? -1 : 0.6;
  for (const x of pool) {
    const v = likeness(x, like);
    if (v > score) [best, score] = [x, v];
  }
  return best;
}

/**
 * `citation_flags`: the misfits as the final body has them: the footnote's number, and the sentence it is in there
 * (第 5 轮 (b): not the words before the renderer); a footnote no longer in the report is not flagged.
 */
export function citationFlagsOf(misfits: CitationFitResult['misfits'], body: string, keyed: Map<string, Evidence>): CitationFlag[] {
  return misfits.flatMap((m) => {
    const e = keyed.get(m.key);
    const footnote = e ? footnoteOf(body, e) : null;
    if (!e || !footnote) return [];
    return [{ footnote, ref: e.ref, sentence: placedSentence(body, m.sentence, e) ?? numbered(m.sentence, body, keyed), quote: m.quote, reason: m.reason }];
  });
}

/**
 * `citation_fixes`: what was before is numbered as the report before the fix numbered it (`before`), what is after as
 * the final body has it. 第 5 轮 (c): a change that did not reach the final body (a switched key the renderer dropped,
 * a softened sentence not there) is not listed.
 */
export function citationFixesOf(fixes: CitationFixRecord[], before: string, after: string, keyed: Map<string, Evidence>): CitationFix[] {
  const num = (k: string | null, body: string) => (k && keyed.get(k) ? footnoteOf(body, keyed.get(k)!) : null);
  const placed = new Map<CitationFixRecord, string | null>();
  for (const f of fixes) placed.set(f, f.action === '换编号' ? placedSentence(after, f.after, keyed.get(f.to!)) : placedSentence(after, f.after));
  // a 降语气 that goes with a switch (the words narrowed) stands or falls with it
  const switchOf = (f: CitationFixRecord) => fixes.find((x) => x.action === '换编号' && x.key === f.key && x.before === f.before);
  return fixes.flatMap((f) => {
    const at = f.action === '降语气' && switchOf(f) ? placed.get(switchOf(f)!) : placed.get(f);
    if (!at) return [];
    return [{
      footnote: num(f.key, before) ?? '',
      ref: keyed.get(f.key)?.ref ?? '',
      action: f.action,
      from: num(f.from, before),
      to: num(f.to, after),
      sentence_before: numbered(f.before, before, keyed),
      sentence_after: at,
    }];
  });
}
