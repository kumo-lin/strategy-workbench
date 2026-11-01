/**
 * A block link the model wrote into the text without its quote (M1's fourth walk-through, run 7: the decisions in the
 * run's context carry "[[资料#^c6]]" links, and the model copied one into its text: "引用没有写出原文：[[45% of
 * professionals use shadow AI tools – here's how to man#^c6]]", three times). The block's original is in the vault,
 * so code settles it when the report is assembled, never the repair round: the link becomes a footnote whose
 * definition is the block's own text + the link, like every footnote code writes (the body keeps only the marker,
 * D-20). The citation check is not relaxed: the quote it reads is the block itself, and a link whose block does not
 * exist is left as it was (and still keeps the report a draft).
 */
import type { Vault } from '@/lib/vault';
import { extractWikiLinks, parseWikiLink } from '@/lib/vault/links';
import type { Evidence } from './evidence';
import { blockQuote } from './number-check';
import { footnoteText, footnotesIn, FOOTNOTE_HEADING } from './report';
import { claimBlocksOf, loadSourceInfo } from './sources';

export interface BareLinkOptions {
  vault: Vault;
  log: (action: string, change: string, reason: string) => Promise<unknown>;
  /** The report the links resolve from. */
  fromPath?: string;
}

export interface BareLinkResult {
  body: string;
  /** The links turned into footnotes, with the footnote each became. */
  cited: { link: string; footnote: number }[];
}

/** A quote right before a link (“…” / "…" / 「…」, then an optional （…）): the citation check reads it as the link's quote. */
const QUOTE_BEFORE = /(?:“[^”]+”|"[^"]+"|「[^」]+」)\s*(?:[（(][^）)]*[）)])?\s*$/;
const FOOTNOTE_DEF_LINE = /^\[\^\d+\]:/;
const NO_CITATIONS = '（没有引用）';

/** The definition for a block: a source's claim block reads like any evidence footnote; any other block shows its text. */
async function definitionFor(o: BareLinkOptions, link: string): Promise<{ ref: string; text: string } | null> {
  const parsed = parseWikiLink(link);
  if (!parsed?.block) return null;
  const res = await o.vault.resolveLink(parsed, o.fromPath).catch(() => null);
  if (!res?.ok) return null;
  const info = await loadSourceInfo(o.vault, res.path).catch(() => null);
  if (info && info.kind !== 'expert') {
    const [draft] = await claimBlocksOf(o.vault, info, new Set([parsed.block]));
    if (draft) return { ref: draft.ref, text: footnoteText(draft as Evidence) };
  }
  const block = (await o.vault.getBlocks(res.path).catch(() => new Map())).get(parsed.block);
  if (!block) return null;
  const quote = blockQuote(block.text).replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  return quote ? { ref: link, text: `“${quote}”（原文）${link}` } : null;
}

export async function citeBareBlockLinks(o: BareLinkOptions, body: string): Promise<BareLinkResult> {
  const lines = body.split('\n');
  const known = footnotesIn(body);
  const byRef = new Map(known.byRef);
  let max = known.max;
  const newDefs: string[] = [];
  const cited: BareLinkResult['cited'] = [];
  const memo = new Map<string, Awaited<ReturnType<typeof definitionFor>>>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FOOTNOTE_DEF_LINE.test(line) || !line.includes('#^')) continue;
    let out = '';
    let cursor = 0;
    for (const l of extractWikiLinks(line)) {
      if (!l.block) continue;
      const at = line.indexOf(l.raw, cursor);
      if (at < 0) continue;
      if (QUOTE_BEFORE.test(line.slice(0, at))) continue;
      if (!memo.has(l.raw)) memo.set(l.raw, await definitionFor(o, l.raw));
      const def = memo.get(l.raw);
      if (!def) continue; // no such block: the citation check still reports it
      let n = byRef.get(def.ref) ?? byRef.get(l.raw);
      if (n === undefined) {
        n = ++max;
        byRef.set(def.ref, n);
        newDefs.push(`[^${n}]: ${def.text}`);
      }
      out += `${line.slice(cursor, at)}[^${n}]`;
      cursor = at + l.raw.length;
      cited.push({ link: l.raw, footnote: n });
    }
    if (cursor > 0) lines[i] = out + line.slice(cursor);
  }

  if (newDefs.length) {
    let fn = lines.findIndex((l) => l.trim() === FOOTNOTE_HEADING);
    if (fn < 0) {
      lines.push('', FOOTNOTE_HEADING);
      fn = lines.length - 1;
    }
    const placeholder = lines.findIndex((l, k) => k > fn && l.trim() === NO_CITATIONS);
    if (placeholder >= 0) lines.splice(placeholder, 1);
    let end = lines.findIndex((l, k) => k > fn && /^## /.test(l));
    if (end < 0) end = lines.length;
    while (end > fn + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, ...newDefs);
  }
  for (const c of cited) await o.log('research:citation-quoted', `正文里只写了块链接 ${c.link}：改成脚注 [^${c.footnote}]，脚注里写出这个块的原文`, '引用必须是"原文" + 链接；块的原文在资料里，由代码补，不进修复轮');
  return { body: lines.join('\n'), cited };
}
