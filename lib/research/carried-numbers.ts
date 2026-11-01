/**
 * Q-F for the text a follow-up carries over (D-21-4 v4). v(N+1) keeps vN's lines verbatim (the Summary rows of the
 * claims it did not re-judge, the recommendation cells marked 未变), but vN may predate the number rule: v3's H1 row
 * says "CIO 只占 12%、CTO 占 25%（[^4]）" and [^4]'s original only has 72%. Before v(N+1) is composed, each such
 * clause is repaired, the same two ways as a new line:
 *   - re-cite: another block of the same source has the number (or the fetched page has the sentence, added as a
 *     block now): the clause cites that block instead (an old footnote stays only if its original shares a number
 *     with the clause). Deterministic, no model.
 *   - reword: no original has the number: the model rewrites the clause without it (qualitative), and code checks
 *     the rewrite (same footnotes, no new links, no number outside its original).
 * What could not be repaired stays as it was and is returned, so the run's self-check still reports it.
 * Each repair is one line for 本版变化 ("上一版的数字对不上原文，本版改了").
 */
import { z } from 'zod';
import type { Vault } from '@/lib/vault';
import { parseWikiLink } from '@/lib/vault/links';
import type { Evidence } from './evidence';
import { numberMismatches, numbersIn, numbersInQuote, numberInQuote, type NumberMismatch } from './number-check';
import { findOriginal, footnoteQuotes, sameMagnitude } from './number-repair';
import { footnoteText, footnotesIn, FOOTNOTE_HEADING } from './report';
import type { ResearchRun } from './run';
import type { EvidenceDraft } from './sources';

export interface CarriedFix {
  /** 1-based line in the body. */
  line: number;
  /** The clause as vN wrote it, and as it reads now. */
  before: string;
  after: string;
  numbers: string[];
  how: 'recited' | 'reworded';
  /** One line for 本版变化. */
  note: string;
}

export interface RewordInput {
  clause: string;
  numbers: string[];
  /** The originals the clause cites. */
  quotes: string[];
  /** Why the previous rewrite was refused, on a retry. */
  problem?: string;
}
/** The rewritten clause, or null when the model gave nothing usable. */
export type Reword = (input: RewordInput) => Promise<string | null>;

export interface CarriedNumbersOptions {
  vault: Vault;
  log: (action: string, change: string, reason: string) => Promise<unknown>;
  /** The report the footnote links resolve from (vN's path). */
  fromPath: string;
  /** vN's version number, for the 本版变化 lines. */
  vPrev: number;
  /** What the repaired text is called in the notes (default "沿用的 v{vPrev} 原文"). */
  what?: string;
  reword?: Reword;
  /** Rewrites tried per clause (default 2). */
  rewordTries?: number;
}

export interface CarriedNumbersResult {
  body: string;
  fixes: CarriedFix[];
  /** Mismatches left as they were (no original, and no acceptable rewrite). */
  unresolved: NumberMismatch[];
}

const MARKER_GROUP = /(?:[（(]\s*)?\[\^\d+\](?:\s*[、，,]?\s*\[\^\d+\])*(?:\s*[）)])?/g;
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The footnote group that ends `clause` in `line` (the first one at or after its last character). */
function groupAfter(line: string, clause: string): { at: number; text: string } | null {
  const from = Math.max(0, clause ? line.indexOf(clause) : 0);
  for (const g of line.matchAll(MARKER_GROUP)) {
    if ((g.index ?? 0) >= from + Math.max(0, clause.length - 1)) return { at: g.index ?? 0, text: g[0] };
  }
  return null;
}

/** The same group with other footnote ids, its brackets kept: "（[^4]）" → "（[^39]）". */
function regroup(group: string, ids: string[]): string {
  const open = /^[（(]\s*/.exec(group)?.[0] ?? '';
  const close = /\s*[）)]$/.exec(group)?.[0] ?? '';
  const sep = /\]\s*([、，,])\s*\[/.exec(group)?.[1] ?? '、';
  return `${open}${ids.map((n) => `[^${n}]`).join(sep)}${close}`;
}

const sameLine = (m: NumberMismatch, line: number, text: string) => m.line === line && m.text === text;

export async function fixCarriedNumbers(o: CarriedNumbersOptions, body: string): Promise<CarriedNumbersResult> {
  const lines = body.split('\n');
  const quotes = await footnoteQuotes(o.vault, body, o.fromPath);
  const all = numberMismatches(body, quotes);
  if (!all.length) return { body, fixes: [], unresolved: [] };

  const known = footnotesIn(body);
  const byRef = new Map(known.byRef);
  let max = known.max;
  const newDefs: string[] = [];
  const footnoteFor = (d: EvidenceDraft) => {
    let n = byRef.get(d.ref);
    if (n === undefined) {
      n = ++max;
      byRef.set(d.ref, n);
      newDefs.push(`[^${n}]: ${footnoteText(d as Evidence)}`);
      quotes.set(String(n), d.quote);
    }
    return String(n);
  };
  const linkOf = (id: string) => {
    const def = known.defs.get(Number(id)) ?? '';
    const raw = [...def.matchAll(/\[\[[^\]]+#\^[A-Za-z0-9-]+[^\]]*\]\]/g)].at(-1)?.[0];
    return raw ? parseWikiLink(raw) : null;
  };

  // one repair per clause (a clause with two bad numbers is one sentence to fix)
  const clauses = new Map<string, { line: number; text: string; footnotes: string[]; numbers: string[] }>();
  for (const m of all) {
    const k = `${m.line}\u0000${m.text}`;
    const c = clauses.get(k) ?? { line: m.line, text: m.text, footnotes: m.footnotes, numbers: [] };
    if (!c.numbers.includes(m.number)) c.numbers.push(m.number);
    clauses.set(k, c);
  }

  const what = o.what ?? `沿用的 v${o.vPrev} 原文`;
  const fixes: CarriedFix[] = [];
  const unresolved: NumberMismatch[] = [];
  const stillBad = (line: number, text: string) => numberMismatches(lines.join('\n'), quotes).filter((m) => sameLine(m, line, text));
  // a change may fix its clause only: no new mismatch anywhere else on the line
  const newOnLine = (line: number) => numberMismatches(lines.join('\n'), quotes).filter((m) => m.line === line && !all.some((x) => sameLine(x, line, m.text) && x.number === m.number));

  for (const c of clauses.values()) {
    const line = lines[c.line - 1];
    const group = groupAfter(line, c.text);
    // 1) re-cite: every bad number has an original — a footnote already on this line whose original has it (a table
    //    row's other cells: the challenge's source), else another block of a cited source (or its fetched page)
    const found = new Map<string, { id: string } | { draft: EvidenceDraft }>();
    const onLine = [...new Set([...line.matchAll(/\[\^(\d+)\]/g)].map((m) => m[1]))];
    for (const n of c.numbers) {
      const t = numbersIn(n)[0] ?? numbersInQuote(n)[0];
      const near = t && onLine.find((f) => sameMagnitude(t, numbersInQuote(quotes.get(f) ?? '')));
      if (near) {
        found.set(n, { id: near });
        continue;
      }
      for (const f of c.footnotes) {
        const link = linkOf(f);
        if (!link?.block) continue;
        const res = await o.vault.resolveLink(link, o.fromPath).catch(() => null);
        if (!res?.ok) continue;
        const d = await findOriginal(o, res.path, link.block, n);
        if (d) {
          found.set(n, { draft: d });
          break;
        }
      }
    }
    // one original with all of them is cited alone (CIO 12% and CTO 25% are one sentence of the source)
    const whole = [...found.values()].find((x) => 'draft' in x && c.numbers.every((n) => sameMagnitude(numbersIn(n)[0] ?? numbersInQuote(n)[0], numbersInQuote(x.draft.quote))));
    if (whole) for (const n of c.numbers) found.set(n, whole);
    if (group && found.size === c.numbers.length) {
      const clauseNums = numbersIn(c.text);
      // an old footnote stays when its original shares a number with the clause (it still backs part of it), and
      // always when the original came from a footnote on the same line: the group may also stand for what follows it
      // ("[E1][E2] 的样本口径（500 人…）和[E4] 的 88% 外流比例")
      const fromLine = [...found.values()].some((x) => 'id' in x);
      const kept = fromLine ? c.footnotes : c.footnotes.filter((f) => clauseNums.some((t) => numberInQuote(t, numbersInQuote(quotes.get(f) ?? ''))));
      const added = [...new Set([...found.values()].map((x) => ('id' in x ? x.id : footnoteFor(x.draft))))];
      const ids = [...new Set([...kept, ...added])];
      const next = `${line.slice(0, group.at)}${regroup(group.text, ids)}${line.slice(group.at + group.text.length)}`;
      lines[c.line - 1] = next;
      if (!stillBad(c.line, c.text).length && !newOnLine(c.line).length) {
        const how = `改引 ${added.map((n) => `[^${n}]`).join('、')}（含 ${c.numbers.join('、')} 的原句）`;
        fixes.push({ line: c.line, before: c.text, after: c.text, numbers: c.numbers, how: 'recited', note: `  - ${what}「${clip(c.text)}」：上一版的数字对不上原文，本版改了——${how}` });
        await o.log('research:number-carried', `${what}「${clip(c.text)}」${how}`, 'Q-F：沿用的行也要过数字检查');
        continue;
      }
      lines[c.line - 1] = line;
    }
    // 2) reword without the number (the model writes, code checks)
    let problem: string | undefined;
    let done = false;
    const cited = c.footnotes.map((f) => quotes.get(f) ?? '').filter(Boolean);
    for (let attempt = 0; o.reword && attempt < (o.rewordTries ?? 2) && !done; attempt++) {
      const out = (await o.reword({ clause: c.text, numbers: c.numbers, quotes: cited, problem }).catch(() => null))?.trim();
      if (!out) {
        problem = '没有给出改写';
        continue;
      }
      if (/\[\^|\[\[|\|/.test(out)) {
        problem = '改写里不能有脚注、[[链接]]或表格的竖线：只写这半句话本身';
        continue;
      }
      const at = line.indexOf(c.text);
      if (at < 0) break;
      lines[c.line - 1] = `${line.slice(0, at)}${out}${line.slice(at + c.text.length)}`;
      const left = [...stillBad(c.line, out), ...newOnLine(c.line).filter((m) => m.text !== out)];
      if (!left.length) {
        done = true;
        fixes.push({ line: c.line, before: c.text, after: out, numbers: c.numbers, how: 'reworded', note: `  - ${what}「${clip(c.text)}」：上一版的数字对不上原文，本版改了——引用的原文里没有 ${c.numbers.join('、')}，去掉了这些数字，改为「${clip(out)}」` });
        await o.log('research:number-carried', `${what}「${clip(c.text)}」去掉了 ${c.numbers.join('、')}：「${clip(out)}」`, 'Q-F：沿用的行也要过数字检查；资料里没有含这个数字的原句');
      } else {
        lines[c.line - 1] = line;
        problem = `改写后仍有不在原文里的数字：${left.map((m) => m.number).join('、')}`;
      }
    }
    if (!done) unresolved.push(...all.filter((m) => sameLine(m, c.line, c.text)));
  }

  if (newDefs.length) {
    const fn = lines.findIndex((l) => l.trim() === FOOTNOTE_HEADING);
    let end = lines.findIndex((l, k) => k > fn && /^## /.test(l));
    if (end < 0) end = lines.length;
    while (end > fn + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, ...newDefs);
  }
  return { body: lines.join('\n'), fixes, unresolved };
}

export const REWORD_SYSTEM = `你在修一份调查报告里沿用下来的一句话。这句话里的数字没有出现在它引用的原文里，同一份资料里也找不到含这个数字的原句。
把这半句改写成不带这些数字的说法：只能保留原文里真有的事实，可以改成定性的说法（如"少数""明显更高"），也可以换成原文里写着的数字。
不要加新的事实、来源或推论，不要写脚注、[[链接]]或表格竖线，不要改动句子以外的内容。
只输出 JSON：{"clause": "改写后的这半句"}`;

export function rewordPrompt(i: RewordInput): string {
  return [
    `## 要改写的半句\n${i.clause}`,
    `## 不在原文里的数字\n${i.numbers.join('、')}`,
    `## 它引用的原文\n${i.quotes.map((q) => `- ${q}`).join('\n') || '（无）'}`,
    ...(i.problem ? [`## 上一次的改写没有通过检查\n${i.problem}`] : []),
  ].join('\n\n');
}

export const rewordSchema = z.object({ clause: z.string() });

/** The model's rewrite of one clause, through the run (logged and timed like every call). */
export const modelReword =
  (run: Pick<ResearchRun, 'llm'>): Reword =>
  async (i) =>
    (await run.llm('number-carried', { system: REWORD_SYSTEM, prompt: rewordPrompt(i) }, rewordSchema)).clause;
