/**
 * D-48 (报告新写法): how long the short parts of a question-tree report may be, and what happens when the model wrote
 * them longer. Like the number check: the overlong ones go to the model once, together, to be rewritten (the [E#]
 * kept, no new number); what is still too long is flagged (`length_flags`), never a reason to keep the report a draft.
 *
 * Counted on the fields the model wrote, before rendering: the same words the report shows, without the layout.
 */
import type { ClaimResult } from './judge';
import { LlmJsonError } from './llm';
import { numbersIn } from './number-check';
import type { ResearchRun } from './run';
import type { SummaryDraft } from './schemas';
import { shortenPrompt } from '@/lib/harness/prompts/research-execute';
import { z } from 'zod';

/** 字数 limits of the 格式约定. */
export const LENGTH_LIMITS = {
  answer: 50,
  reason: 40,
  soWhat: 50,
  changed: 40,
  conditionNote: 40,
  shortStatement: 20,
  oneLine: 50,
  subAnswer: 50,
  splitBasis: 40,
  /** A recommendation cell's conclusion, before "依据：" (D-48 第 2 轮). */
  recommendation: 60,
} as const;

/**
 * 字数: every character counts as one (汉字, letters, digits, punctuation), after removing footnote marks [^n],
 * evidence keys [E#], whitespace and "（推断）".
 */
export function lengthOf(text: string): number {
  const s = text
    .replace(/\[\^\d+\]/g, '')
    .replace(/[[【]\s*E\d+[^\]】\n]*[\]】]/g, '')
    .replace(/[（(]推断[）)]/g, '')
    // 第 5 轮: "[Q3-1]", which answer a clause comes from, and "[Q2-1①]", a condition's code
    .replace(/\[Q\d+(?:-\d+)?[①-⑳]?\]/g, '')
    .replace(/\s+/g, '');
  return [...s].length;
}

/** One part of the report the limits apply to. `id` addresses it for the rewrite; `where` is "<标签> · <条目名>" ("H2-1 · 理由 3", "Summary · 问题树"), as the page and M4's fixture read it. */
export interface LengthItem {
  id: string;
  where: string;
  text: string;
  limit: number;
}

/** What `length_flags` keeps: the part, its text as the model wrote it ([E#] left out), the limit and its length. */
export interface LengthFlag {
  where: string;
  text: string;
  limit: number;
  length: number;
}

/** The parts of a question-tree report that have a limit (an older plan's report has none). */
export function lengthItems(results: ClaimResult[], summary: SummaryDraft): LengthItem[] {
  const out: LengthItem[] = [];
  const add = (id: string, where: string, text: string | undefined, limit: number) => {
    if (text?.trim()) out.push({ id, where, text, limit });
  };
  const cards = results.filter((r) => r.claim.question);
  for (const r of cards) {
    const j = r.judgment;
    for (const c of r.conditions ?? []) add(`${r.claim.id}:note:${c.n}`, `${r.label} · ${c.label}`, c.note, LENGTH_LIMITS.conditionNote);
    add(`${r.claim.id}:changed`, `${r.label} · 改了什么`, j.changed, LENGTH_LIMITS.changed);
    add(`${r.claim.id}:answer`, `${r.label} · 回答`, j.answer, LENGTH_LIMITS.answer);
    j.reasons.forEach((t, i) => add(`${r.claim.id}:reason:${i}`, `${r.label} · 理由 ${i + 1}`, t, LENGTH_LIMITS.reason));
    add(`${r.claim.id}:so_what`, `${r.label} · So What`, j.so_what[0], LENGTH_LIMITS.soWhat);
    add(`${r.claim.id}:short`, `${r.label} · 短名`, j.short_statement, LENGTH_LIMITS.shortStatement);
  }
  if (cards.length) {
    add('summary:so_what', 'Summary · 回答（一句话）', summary.so_what, LENGTH_LIMITS.oneLine);
    for (const a of summary.answers ?? []) add(`summary:answer:${a.id}`, `Summary · 各子问题的回答 ${a.id}`, a.answer, LENGTH_LIMITS.subAnswer);
    add('summary:split_basis', 'Summary · 问题树', summary.split_basis, LENGTH_LIMITS.splitBasis);
  }
  return out;
}

export const overLimit = (items: LengthItem[]) => items.map((i) => ({ ...i, length: lengthOf(i.text) })).filter((i) => i.length > i.limit);

const keysOf = (t: string) => new Set(t.match(/E\d+/g) ?? []);
const numbersOf = (t: string) => new Set(numbersIn(t.replace(/[[【]\s*E\d+[^\]】\n]*[\]】]/g, ' ')).map((n) => n.value));

/** A rewrite is taken only when it keeps every [E#] (and adds none) and adds no number. */
export function acceptableRewrite(before: string, after: string): boolean {
  const kb = keysOf(before);
  const ka = keysOf(after);
  if (kb.size !== ka.size || [...kb].some((k) => !ka.has(k))) return false;
  const nb = numbersOf(before);
  return [...numbersOf(after)].every((n) => nb.has(n));
}

/** The rewritten texts put back where they came from ("改了什么" is also the revised statement of a 需要修改). */
export function applyRewrites(results: ClaimResult[], summary: SummaryDraft, texts: Map<string, string>): { results: ClaimResult[]; summary: SummaryDraft } {
  const get = (id: string, old: string) => texts.get(id) ?? old;
  const next = results.map((r) => {
    const id = r.claim.id;
    if (![...texts.keys()].some((k) => k.startsWith(`${id}:`))) return r;
    const j = r.judgment;
    const changed = get(`${id}:changed`, j.changed);
    const conditions = (r.conditions ?? []).map((c) => ({ ...c, note: get(`${id}:note:${c.n}`, c.note) }));
    return {
      ...r,
      conditions,
      revisedStatement: r.revisedStatement !== null && r.revisedStatement === j.changed ? changed : r.revisedStatement,
      judgment: {
        ...j,
        changed,
        revised_statement: j.revised_statement !== null && j.revised_statement === j.changed ? changed : j.revised_statement,
        conditions: j.conditions.map((c) => ({ ...c, note: get(`${id}:note:${c.n}`, c.note) })),
        answer: get(`${id}:answer`, j.answer),
        reasons: j.reasons.map((t, i) => get(`${id}:reason:${i}`, t)),
        so_what: j.so_what.map((t, i) => (i === 0 ? get(`${id}:so_what`, t) : t)),
        short_statement: get(`${id}:short`, j.short_statement),
      },
    };
  });
  const nextSummary: SummaryDraft = {
    ...summary,
    so_what: get('summary:so_what', summary.so_what),
    answers: (summary.answers ?? []).map((a) => ({ ...a, answer: get(`summary:answer:${a.id}`, a.answer) })),
    ...(summary.split_basis !== undefined ? { split_basis: get('summary:split_basis', summary.split_basis) } : {}),
  };
  return { results: next, summary: nextSummary };
}

/** At most this many parts per rewrite call. */
export const SHORTEN_BATCH = 20;

const shortenSchema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })).catch([]) });

/**
 * One model call for every part over its limit. A rewrite that drops or adds an [E#], or adds a number, is not
 * taken (logged); the part keeps its words and is flagged if still too long (lengthFlags).
 */
export async function shortenLong(run: Pick<ResearchRun, 'llm' | 'log' | 'signal'>, results: ClaimResult[], summary: SummaryDraft, kept: (id: string) => boolean = () => false): Promise<{ results: ClaimResult[]; summary: SummaryDraft }> {
  // a part kept word for word (--only) is not rewritten; still over, it is flagged like any other
  const long = overLimit(lengthItems(results, summary)).filter((i) => !kept(i.id));
  if (!long.length) return { results, summary };
  // batch by batch (WS-A v9: one call for all, cut off at the limit, nothing rewritten); a batch that fails keeps its words
  const answer: z.infer<typeof shortenSchema> = { items: [] };
  for (let i = 0; i < long.length; i += SHORTEN_BATCH) {
    const b = long.slice(i, i + SHORTEN_BATCH);
    try {
      answer.items.push(...(await run.llm('shorten', shortenPrompt(b), shortenSchema)).items);
    } catch (e) {
      if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
      await run.log('research:length-rewrite-failed', `改写超长的 ${b.length} 处（${b[0].where} 起），模型输出不合格：${e.message.slice(0, 120)}`, '这一批保留原来的写法，超长的标出来');
    }
  }
  const texts = new Map<string, string>();
  for (const item of long) {
    const after = answer.items.find((x) => x.id === item.id)?.text.trim();
    if (!after) continue;
    if (!acceptableRewrite(item.text, after)) {
      await run.log('research:length-rewrite-rejected', `${item.where}：改写去掉或加了证据编号、或加了数字，不用：「${after.slice(0, 60)}」`, '改写只能缩短，不能改证据和数字');
      continue;
    }
    texts.set(item.id, after);
  }
  await run.log('research:length-rewrite', `超长的 ${long.length} 处交给模型改写，用了 ${texts.size} 处：${long.map((i) => `${i.where}（${i.length}/${i.limit} 字）`).join('、')}`, 'D-48 字数上限：先改写，还超长的标出来，不阻止交付');
  return applyRewrites(results, summary, texts);
}

/** A recommendation cell's conclusion: what comes before its first "依据：" (all of it when there is none). */
export const conclusionOf = (cell: string) => cell.split(/依据[:：]/)[0].trim().replace(/[。；;，,]$/, '');

/**
 * D-48 第 2 轮: each cell of a question-tree report's recommendation, "<结论>。依据：…", its conclusion counted
 * ("推荐 · 做什么", "推荐 · 其他选项 2"; the list fields item by item). Flagged only, not rewritten: a follow-up
 * decides these cells one by one against the version before.
 */
export function recommendationItems(results: ClaimResult[], summary: SummaryDraft): LengthItem[] {
  const rec = summary.recommendation;
  if (!rec || !results.some((r) => r.claim.question)) return [];
  const cell = (where: string, text: string) => ({ id: `recommendation:${where}`, where: `推荐 · ${where}`, text: conclusionOf(text), limit: LENGTH_LIMITS.recommendation });
  return [
    ...(rec.decision_answer.trim() ? [cell('对决策的回答', rec.decision_answer)] : []),
    ...(rec.directive_response.trim() ? [cell('怎么回应高层指示', rec.directive_response)] : []),
    cell('做什么', rec.action),
    cell('量级多大', rec.scale),
    ...rec.metrics.map((t, i) => cell(`看什么指标 ${i + 1}`, t)),
    ...rec.alternatives.map((a, i) => cell(`其他选项 ${i + 1}`, a.why_not)),
    ...rec.change_if.map((t, i) => cell(`什么情况下要改 ${i + 1}`, t)),
  ].filter((i) => i.text);
}

/** What is over its limit in the final text: `length_flags`. */
export function lengthFlags(results: ClaimResult[], summary: SummaryDraft): LengthFlag[] {
  return overLimit([...lengthItems(results, summary), ...recommendationItems(results, summary)]).map((i) => ({ where: i.where, text: i.text.replace(/\s*[[【]\s*E\d+[^\]】\n]*[\]】]/g, '').trim(), limit: i.limit, length: i.length }));
}
