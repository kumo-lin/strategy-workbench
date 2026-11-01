/**
 * Q-F in a run: each number the check finds outside its quote becomes a self-check failure that says what the repair
 * may do instead — cite the original that has the number, or drop the number. The original is looked for in the same
 * source: another of its blocks (v3's [^4]: the 12% / 25% sentence was ^c4, the report cited ^c3), or else the page
 * fetched into the note (## 抓取原文), from which the sentence is added as a new block now (logged). Either way it gets
 * an evidence key the repair may cite.
 */
import type { Vault } from '@/lib/vault';
import type { Evidence } from './evidence';
import type { ClaimResult } from './judge';
import { blockQuote, footnoteDefs, numberInQuote, numberMismatches, numbersIn, numbersInQuote, responseProblems, type NumberMismatch, type NumberToken } from './number-check';
import { recommendationRange } from './recommendation-diff';
import { footnotesIn } from './report';
import type { CheckFailure } from './selfcheck';
import { claimBlocksOf, loadSourceInfo, splitClaimText, type EvidenceDraft } from './sources';
import { parseWikiLink } from '@/lib/vault/links';

export interface NumberCheckContext {
  vault: Vault;
  log: (action: string, change: string, reason: string) => Promise<unknown>;
  /** The results whose keyed evidence the report cites; a found original is added to its owner's keyed. */
  results: ClaimResult[];
  /** Other maps that must know a new key (the Summary's keyed, the issued keys). */
  alsoKeyed?: Map<string, Evidence>[];
  issuedKeys?: Set<string>;
  /** Only these body lines (1-based) are checked (a follow-up checks what it wrote, not vN's text). */
  onlyLines?: (line: number, text: string) => boolean;
  /** The lines whose numbers are checked, when not `onlyLines` (a follow-up checks the numbers of vN's text too). */
  numberLines?: (line: number, text: string) => boolean;
}

const PAGE_HEADING = /^## 抓取原文\s*$/m;
const CLAIMS_HEADING = /^## 论断\s*$/;

/** Sentences of the page fetched into a source note (its "## 抓取原文" section). */
export function pageSentences(noteBody: string): string[] {
  const at = noteBody.search(PAGE_HEADING);
  if (at < 0) return [];
  const page = noteBody.slice(at).replace(PAGE_HEADING, '');
  return page
    .split(/\n+|(?<=[。！？!?])|(?<=\.)\s+(?=[A-Z0-9])/)
    .map((s) => s.replace(/^\s*(?:#+|[-*+]|\d+[.)])\s+/, '').replace(/\*\*|__/g, '').trim())
    .filter((s) => s.length >= 15 && s.length <= 400);
}

/** The note body with a new claim block appended to its "## 论断" list; returns it and the new block id. */
export function withNewBlock(noteBody: string, sentence: string, existing: string[]): { body: string; id: string } {
  const n = Math.max(0, ...existing.map((id) => Number(/^c(\d+)$/.exec(id)?.[1] ?? 0))) + 1;
  const id = `c${n}`;
  const line = `- 「${sentence}」— 位置：抓取原文（数字核对时补的块） ^${id}`;
  const lines = noteBody.split('\n');
  const start = lines.findIndex((l) => CLAIMS_HEADING.test(l));
  if (start < 0) return { body: `${noteBody.replace(/\n*$/, '')}\n\n## 论断\n\n${line}\n`, id };
  let end = lines.findIndex((l, k) => k > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, line);
  return { body: lines.join('\n'), id };
}

/**
 * numberInQuote, but magnitudes must agree: 3000 万 only matches 30 million, never "$3,000/month", and a plain 500
 * (500 人) never matches "$500 million". Finding an original to cite is stricter than accepting the one a sentence
 * already cites (M4's S0 run: the repair was told to cite "$500 million" for "500 人以上企业").
 */
export function sameMagnitude(t: NumberToken, quote: NumberToken[]): boolean {
  if (t.scaled === t.value) return numberInQuote(t, quote.filter((q) => q.scaled === q.value));
  const unit = t.scaled / t.value;
  const d = (String(t.value).split('.')[1] ?? '').length;
  return quote.some((q) => q.scaled === t.scaled || Math.round((q.scaled / unit) * 10 ** d) / 10 ** d === t.value);
}

/**
 * The original sentence with `number` in it, from the source at `path` (a block other than `notBlock`, or a sentence of
 * its 抓取原文 added as a new block now, logged). null when the source has no such sentence.
 */
export async function findOriginal(o: Pick<NumberCheckContext, 'vault' | 'log'>, path: string, notBlock: string, number: string): Promise<EvidenceDraft | null> {
  // the mismatch's raw number ("4" of "4 家" alone reads as no number in prose): parse it as a quote's
  const t = numbersIn(number)[0] ?? numbersInQuote(number)[0];
  if (!t) return null;
  const info = await loadSourceInfo(o.vault, path).catch(() => null);
  if (!info || info.kind === 'expert') return null;
  const blocks = await o.vault.getBlocks(path);
  let id = [...blocks.values()].find((b) => /^c\d+$/.test(b.id) && b.id !== notBlock && sameMagnitude(t, numbersInQuote(splitClaimText(b.text).quote)))?.id;
  if (!id) {
    const note = await o.vault.read(path);
    const sentence = pageSentences(note.body).find((s) => sameMagnitude(t, numbersInQuote(s)));
    if (!sentence) return null;
    const added = withNewBlock(note.body, sentence, [...blocks.keys()]);
    try {
      // only a block line is added: the note's links are the ones it already had
      await o.vault.write(path, { frontmatter: note.data, body: added.body }, { overwrite: true, checkLinks: false });
    } catch (err) {
      await o.log('research:block-add-failed', `${info.name}：补块没有写成（${err instanceof Error ? err.message.slice(0, 120) : String(err)}）`, '这一处只能删掉数字');
      return null;
    }
    await o.log('research:block-added', `${info.name}：数字核对时从抓取原文补了一个块 ^${added.id}（含 ${number}）`, '正文用的数字不在引用的块里，但资料页里有这句原文');
    id = added.id;
  }
  const [draft] = await claimBlocksOf(o.vault, info, new Set([id]));
  return draft ?? null;
}

async function originalWithNumber(o: NumberCheckContext, e: Evidence, number: string): Promise<Evidence | null> {
  if (e.sourceKind === 'expert') return null;
  const draft = await findOriginal(o, e.path, e.block, number);
  return draft ? { ...draft, claimId: e.claimId, subQuestionId: e.subQuestionId, round: e.round, stance: e.stance, reason: `含 ${number} 的原句（数字核对时找到）`, core: false, partial: false } : null;
}

/**
 * footnote id → the full original of the block it cites (the footnote itself shows at most 300 characters).
 * A block that cannot be resolved falls back to the quote written in the footnote.
 */
export async function footnoteQuotes(vault: Vault, body: string, fromPath?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [n, def] of footnoteDefs(body)) {
    const shown = /“([\s\S]*)”（/.exec(def)?.[1] ?? def;
    out.set(n, shown);
    const raw = [...def.matchAll(/\[\[[^\]]+#\^[A-Za-z0-9-]+[^\]]*\]\]/g)].at(-1)?.[0];
    const link = raw ? parseWikiLink(raw) : null;
    if (!link?.block) continue;
    const res = await vault.resolveLink(link, fromPath).catch(() => null);
    if (!res?.ok) continue;
    const block = (await vault.getBlocks(res.path).catch(() => new Map())).get(link.block);
    if (block) out.set(n, blockQuote(block.text));
  }
  return out;
}

/** The number check as self-check failures, each naming its two ways out (and adding the original it found as a key). */
export async function numberFailures(o: NumberCheckContext, body: string, fromPath?: string): Promise<CheckFailure[]> {
  const lines = body.split('\n');
  const quotes = await footnoteQuotes(o.vault, body, fromPath);
  const scoped = <T extends { line: number }>(xs: T[], only = o.onlyLines) => xs.filter((m) => !only || only(m.line, lines[m.line - 1]));
  const mismatches = scoped(numberMismatches(body, quotes), o.numberLines ?? o.onlyLines);
  // 回应 cells: the footnote goes after what the source says; the inference is labelled 推断 and carries none
  const responses: CheckFailure[] = scoped(responseProblems(body, quotes)).map((p) => ({
    code: p.kind === 'inference_cited' ? 'inference_cited' : 'quote_mismatch',
    message:
      p.kind === 'inference_cited'
        ? `回应「${p.text.slice(0, 80)}」：脚注挂在了你自己的推论后面。改成先写资料说了什么（脚注紧跟在那半句后面），再写“推断：……”，推论后面不带 [E#]`
        : `回应「${p.text.slice(0, 80)}」：引号里的「${p.quoted}」不在它引用的原文里。引号只能用来引原文；不是原话就去掉引号，或者改成原文里真有的说法`,
    excerpt: lines[p.line - 1].trim(),
    ...(p.kind === 'inference_cited' ? { clause: p.text.trim(), footnotes: p.footnotes } : {}),
  }));
  if (!mismatches.length) return responses;
  const refOf = new Map([...footnotesIn(body).defs].map(([n, d]) => [String(n), /\[\[[^\]]+#\^[A-Za-z0-9-]+\]\]/.exec(d)?.[0] ?? '']));
  const keyOf = (ref: string) => {
    for (const r of o.results) for (const [k, e] of r.keyed) if (e.ref === ref) return { key: k, e, owner: r };
    return null;
  };
  const rec = recommendationRange(lines);
  let max = Math.max(0, ...o.results.flatMap((r) => [...r.keyed.keys()].map((k) => Number(k.slice(1)) || 0)));
  const out: CheckFailure[] = [];
  for (const m of mismatches) {
    const found = m.footnotes.map((f) => keyOf(refOf.get(f) ?? '')).find(Boolean) ?? null;
    let alt = '这份资料里找不到含这个数字的原句：删掉这个数字，或者换成原文里真有的说法';
    // the number is in the original of another footnote on the same line ("[E1][E2] 的样本口径（500 人…）和[E4]"):
    // the footnote is in the wrong place, the number is fine
    const t = numbersIn(m.number)[0] ?? numbersInQuote(m.number)[0];
    const near = t ? [...new Set([...lines[m.line - 1].matchAll(/\[\^(\d+)\]/g)].map((x) => x[1]))].filter((f) => !m.footnotes.includes(f) && sameMagnitude(t, numbersInQuote(quotes.get(f) ?? ''))).map((f) => keyOf(refOf.get(f) ?? '')).find(Boolean) : null;
    if (near) {
      alt = `二选一：这个数字在同一行引用的 [${near.key}] 的原文里（“${near.e.quote.slice(0, 160)}”）——把 [${near.key}] 紧跟在这个数字所在的半句后面，不要让它落在别的引用前面；或者删掉这个数字`;
    } else if (found) {
      const original = await originalWithNumber(o, found.e, m.number);
      if (original) {
        let key = keyOf(original.ref)?.key;
        if (!key) {
          key = `E${++max}`;
          found.owner.keyed.set(key, original);
          for (const map of o.alsoKeyed ?? []) map.set(key, original);
          o.issuedKeys?.add(key);
        }
        alt = `二选一：改引 [${key}]——同一份资料里含这个数字的原句：“${original.quote.slice(0, 200)}”；或者删掉这个数字`;
      }
    }
    const inRec = rec !== null && m.line - 1 >= rec.start && m.line - 1 <= rec.end;
    out.push({
      code: 'number_not_in_quote',
      clause: m.text.trim(),
      numbers: [m.number],
      message: `${inRec ? '推荐判断里' : ''}「${m.text.slice(0, 80)}」里的数字 ${m.number} 不在它引用的原文里${found ? `（[${found.key}] 的原文：“${found.e.quote.slice(0, 100)}”）` : ''}。${alt}`,
      excerpt: lines[m.line - 1].trim(),
    });
  }
  return [...out, ...responses];
}

export type { NumberMismatch };

// ── number flags (D-21-4 f): what the repair could not fix is marked, not blocking ─────────────

/** One number the repair rounds could not fix, kept in the report's frontmatter (`number_flags`). */
export interface NumberFlag {
  check: 'number_not_in_quote' | 'uncited_number';
  /** The clause as written (a cited clause, a line, or the recommendation cell). */
  text: string;
  numbers: string[];
}

/**
 * The number checks: a number not in the original its clause cites, and a number with no source (in the
 * recommendation or in the text). They are pattern matching on prose and keep turning up false positives ("论点 1"),
 * so after the repair rounds they flag (the page marks them, recomputed on every display) instead of keeping the report
 * a draft. The citation checks themselves (quote in the block, the block exists), disproven sources and the other
 * checks that are not heuristics still block; inference_cited flags the same way (see inferenceFlagsOf).
 */
export const isNumberCheck = (f: CheckFailure): boolean => f.code === 'number_not_in_quote' || f.code === 'uncited_number';

/** The flags of the failures that are number checks, one per clause and check. */
export function numberFlagsOf(failures: CheckFailure[]): NumberFlag[] {
  const out: NumberFlag[] = [];
  for (const f of failures.filter(isNumberCheck)) {
    const check = f.code as NumberFlag['check'];
    const text = f.clause ?? f.excerpt ?? f.message;
    const same = out.find((x) => x.check === check && x.text === text);
    if (same) same.numbers = [...new Set([...same.numbers, ...(f.numbers ?? [])])];
    else out.push({ check, text, numbers: [...(f.numbers ?? [])] });
  }
  return out;
}

/** One log line per flag. */
export const describeFlag = (f: NumberFlag): string =>
  `「${f.text.length > 80 ? `${f.text.slice(0, 80)}…` : f.text}」里的 ${f.numbers.join('、')}${f.check === 'number_not_in_quote' ? ' 不在所引的原文里' : ' 没有出处'}`;

// ── inference flags: a footnote after the author's own inference, found by inference words (a heuristic) ──────────

/** One 回应 clause the repair rounds left with a footnote after an inference, kept in the frontmatter (`inference_flags`). */
export interface InferenceFlag {
  /** The clause as written. */
  text: string;
  footnotes: string[];
}

/**
 * inference_cited reads inference words (所以、因此、足以…) and once kept a live run a draft over a source's own
 * "meaning" (M1's acceptance run 1). Like the number checks it is pattern matching on prose: after the repair rounds
 * it flags (the page marks the clause, recomputed on every display) instead of keeping the report a draft.
 */
export const isInferenceCheck = (f: CheckFailure): boolean => f.code === 'inference_cited';

// ── key flags: a bare "E7" left after code turned the claim's own bare keys into footnotes (a heuristic) ──────────

/** A bare evidence key the text still has, kept in the frontmatter (`key_flags`). */
export interface KeyFlag {
  key: string;
  /** The words around it. */
  text: string;
}

/**
 * bare_evidence_key reads "E" + digits and once kept a live run a draft over Microsoft's "E7 Frontier Suite" (报告 v3).
 * It flags at once: no repair round (it could rewrite a product name), never blocking.
 */
export const isKeyCheck = (f: CheckFailure): boolean => f.code === 'bare_evidence_key';

export function keyFlagsOf(failures: CheckFailure[]): KeyFlag[] {
  const out: KeyFlag[] = [];
  for (const f of failures.filter(isKeyCheck)) {
    const key = f.excerpt ?? '';
    if (!out.some((x) => x.key === key)) out.push({ key, text: f.clause ?? f.message });
  }
  return out;
}

export const describeKeyFlag = (f: KeyFlag): string => `「${f.text}」里的 ${f.key} 像是没有转成脚注的证据编号`;

/** What a repair round is asked to fix (the key flags are not). */
export const needsRepair = (f: CheckFailure): boolean => !isKeyCheck(f);

/** The checks that flag instead of blocking once the repair rounds are spent. */
export const isFlagCheck = (f: CheckFailure): boolean => isNumberCheck(f) || isInferenceCheck(f) || isKeyCheck(f);

export function inferenceFlagsOf(failures: CheckFailure[]): InferenceFlag[] {
  const out: InferenceFlag[] = [];
  for (const f of failures.filter(isInferenceCheck)) {
    const text = f.clause ?? f.excerpt ?? f.message;
    if (!out.some((x) => x.text === text)) out.push({ text, footnotes: [...(f.footnotes ?? [])] });
  }
  return out;
}

/** One log line per flag. */
export const describeInferenceFlag = (f: InferenceFlag): string => `回应「${f.text.length > 80 ? `${f.text.slice(0, 80)}…` : f.text}」：脚注挂在了推论后面`;
