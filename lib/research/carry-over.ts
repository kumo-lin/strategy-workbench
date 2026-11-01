/**
 * What a follow-up's v(N+1) carries over from vN besides its text (D-21 (b) v4 lost both):
 *   - source_warnings: vN's, kept for the footnotes still in the body, plus one written by code for every source note
 *     marked `reliability: disproven` that the body still cites (vN's paragraphs are kept verbatim, citations included);
 *   - human_edits: vN's corrections whose corrected text is still in the body.
 */
import type { SourceWarning } from '@/lib/report/source-warnings';
import type { Vault } from '@/lib/vault';
import { parseWikiLink } from '@/lib/vault/links';
import { footnotesIn } from './report';
import { loadSourceInfo, type SourceInfo } from './sources';

export interface DisprovenCitation {
  name: string;
  /** `[[…]]` to the source note. */
  link: string;
  /** The note's reliability_note (why it was found wrong). */
  note: string | null;
  /** Footnote ids citing it, in the order they are defined. */
  footnotes: string[];
}

/** The footnotes of `body` whose source note is marked `reliability: disproven`, by source. */
export async function disprovenCitations(vault: Vault, body: string, fromPath?: string): Promise<DisprovenCitation[]> {
  const bySource = new Map<string, DisprovenCitation>();
  const infos = new Map<string, SourceInfo | null>();
  for (const [n, def] of footnotesIn(body).defs) {
    // the source link is the definition's last [[…]] (the quote may contain other links)
    const raw = [...def.matchAll(/\[\[[^\]]+\]\]/g)].at(-1)?.[0];
    const link = raw ? parseWikiLink(raw) : null;
    if (!link) continue;
    const res = await vault.resolveLink(link, fromPath);
    if (!res.ok) continue;
    if (!infos.has(res.path)) infos.set(res.path, await loadSourceInfo(vault, res.path).catch(() => null));
    const info = infos.get(res.path);
    if (info?.reliability !== 'disproven') continue;
    const c = bySource.get(res.path) ?? { name: info.name, link: `[[${info.linkTarget}]]`, note: info.reliabilityNote, footnotes: [] };
    c.footnotes.push(String(n));
    bySource.set(res.path, c);
  }
  return [...bySource.values()];
}

const sourceKey = (link: string) => (parseWikiLink(link)?.target ?? link).split('/').pop()!.trim();

/**
 * v(N+1)'s source_warnings: vN's (only the footnotes still defined in `body`; a warning left with none is dropped),
 * and for each disproven source the body cites, its footnotes added to vN's warning about it or a new warning
 * written by code (problem from the note's reliability_note).
 */
export function mergeSourceWarnings(previous: SourceWarning[], found: DisprovenCitation[], body: string, o: { today: string; vNext: number }): SourceWarning[] {
  const defined = new Set([...footnotesIn(body).defs.keys()].map(String));
  const out = previous.map((w) => ({ ...w, footnotes: w.footnotes.filter((f) => defined.has(f)) })).filter((w) => w.footnotes.length > 0);
  for (const c of found) {
    const same = out.find((w) => sourceKey(w.source) === sourceKey(c.link));
    if (same) {
      same.footnotes = [...new Set([...same.footnotes, ...c.footnotes])];
      continue;
    }
    out.push({
      footnotes: c.footnotes,
      source: c.link,
      problem: c.note ?? '资料笔记标了 reliability: disproven（经人工核实不可靠），笔记里没有写原因',
      action: `v${o.vNext} 沿用上一版的段落仍引用这份资料：这些脚注不能当依据，以 v${o.vNext} 的判断和更正为准`,
      found_by: '系统（资料笔记标了 reliability: disproven）',
      found_on: o.today,
    });
  }
  return out;
}

/** The `## ` section of `body` the text first appears in (its heading without "## "), or null. */
function sectionOf(body: string, text: string): string | null {
  const at = body.indexOf(text);
  if (at < 0) return null;
  const heading = [...body.slice(0, at).matchAll(/^## (.+)$/gm)].at(-1)?.[1];
  return heading?.trim() ?? null;
}

/**
 * vN's human_edits whose corrected text (`after`) is still in v(N+1)'s body, each marked `carried_from`. When the text
 * now sits in another section than `where` names (a replaced recommendation row moves to the appendix), `where` says so.
 */
export function carryHumanEdits(raw: unknown, body: string, o: { from: string; vNext: number }): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const r = e as Record<string, unknown>;
    if (typeof r.after !== 'string' || !r.after || !body.includes(r.after)) return [];
    const now = sectionOf(body, r.after);
    const where = typeof r.where === 'string' ? r.where : '';
    const moved = now && where && !where.startsWith(now.split(/[（(]/)[0]) ? `${where}（v${o.vNext} 里在“${now}”）` : where;
    return [{ ...r, where: moved, carried_from: r.carried_from ?? o.from }];
  });
}
