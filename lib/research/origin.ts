/**
 * "这次调查的出发点": where this investigation's focus came from, written into the report by CODE
 * (not by the model), so a reader can point at the text and say "this conclusion could only be reached
 * with the vault": the exec directive, the confirmed decisions and the project the plan hangs from, each
 * with a block link and, where the note has blocks, the original words.
 *
 * Found by following the plan's own links, one hop: the plan's derived_from / relates_to, its claims'
 * hypotheses, and what those notes (workplan, project, hypothesis, workspace) link to. Only meetings,
 * decisions and the project note are listed. A line that carries a block link carries the quote right in
 * front of it, so check_citations verifies it like any other citation in the report.
 */
import { readerName } from '@/lib/notes/reader-name';
import type { ResearchPlanNote } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { parseWikiLink } from '@/lib/vault/links';

export type OriginKind = '会议' | '决定' | '项目';

export interface OriginItem {
  kind: OriginKind;
  /** Note name (file name without .md). */
  name: string;
  path: string;
  /** What the report writes: `[[path#^m1]]` for a quoted block, `[[path]]` otherwise. */
  link: string;
  /** Verbatim excerpt of the block (what precedes the link), when the item is a block. */
  quote: string | null;
  /** Where the plan reaches it from, e.g. `workplan v2`. */
  via: string;
}

const KIND_OF: Record<string, OriginKind | undefined> = { meeting: '会议', decision: '决定', project: '项目' };
/** A decision is a note of type decision that sits in a 决策/ folder; anything else that calls itself one is not offered. */
const DECISION_PATH = /(^|\/)决策\/[^/]+\.md$/;

/** The text under "## 决定" (or the whole body when there is no such heading). */
export function decisionSection(body: string): string {
  const m = /^##\s*决定\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(body);
  return (m ? m[1] : body).trim();
}

const KIND_ORDER: OriginKind[] = ['会议', '决定', '项目'];
const MAX_ITEMS = 8;
const MAX_BLOCKS_PER_NOTE = 2;
const NOTE_LINK_RE = /\[\[([^\]]+?)\]\]/g;

const base = (p: string) => p.replace(/\.md$/, '').split('/').pop() ?? p;
const noExt = (p: string) => p.replace(/\.md$/, '');

/** A short verbatim stretch of a block: the sentence(s) that carry the point, ≤ 90 chars, markdown emphasis stripped. */
export function excerptOf(blockText: string): string {
  const plain = blockText.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const sentences = plain.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
  const key = sentences.findIndex((s) => /重点|指示|方向|决定|结论|必须|要求/.test(s));
  const start = key >= 0 ? key : 0;
  let out = '';
  for (const s of sentences.slice(start)) {
    if ((out + s).length > 90) break;
    out += s;
  }
  out = out.replace(/[“”"]/g, '');
  return out.length >= 6 ? out : plain.slice(0, 90).replace(/[“”"]/g, '');
}

interface Reach {
  /** Resolved note path. */
  path: string;
  /** Block ids the referring text names next to the link (`#^m1`, or "（^m1、^m3）" on the same line). */
  blocks: string[];
  via: string;
}

/** Block ids written right after a link on the same line: `[[会议]]（^m1、^m3、^m5）`. */
function trailingBlocks(line: string, linkEnd: number): string[] {
  const m = /^\s*[（(]\s*((?:\^[A-Za-z0-9-]+[、,，\s]*)+)[）)]/.exec(line.slice(linkEnd));
  return m ? [...m[1].matchAll(/\^([A-Za-z0-9-]+)/g)].map((x) => x[1]) : [];
}

async function reachesIn(vault: Vault, fromPath: string, text: string, via: string): Promise<Reach[]> {
  const out: Reach[] = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(NOTE_LINK_RE)) {
      const link = parseWikiLink(m[0]);
      if (!link) continue;
      const res = await vault.resolveLink(link, fromPath);
      if (!res.ok) continue;
      const blocks = [...(link.block ? [link.block] : []), ...trailingBlocks(line, (m.index ?? 0) + m[0].length)];
      out.push({ path: res.path, blocks, via });
    }
  }
  return out;
}

export async function collectOrigins(vault: Vault, planPath: string, plan: Pick<ResearchPlanNote, 'derived_from' | 'relates_to' | 'claims'>): Promise<OriginItem[]> {
  // 1. roots: what the plan itself links to
  const rootLinks = [...plan.derived_from, ...plan.relates_to, ...plan.claims.flatMap((c) => (c.hypothesis ? [c.hypothesis] : []))];
  const reached: Reach[] = [];
  const roots: { path: string; via: string }[] = [];
  for (const raw of rootLinks) {
    const link = parseWikiLink(raw);
    if (!link) continue;
    const res = await vault.resolveLink(link, planPath);
    if (!res.ok) continue;
    reached.push({ path: res.path, blocks: link.block ? [link.block] : [], via: '调查计划' });
    roots.push({ path: res.path, via: base(res.path) });
  }
  // 2. one hop further: what the roots link to (frontmatter lists and body)
  for (const r of roots) {
    let note;
    try {
      note = await vault.read(r.path);
    } catch {
      continue;
    }
    const fm = [...((note.data.derived_from as string[] | undefined) ?? []), ...((note.data.relates_to as string[] | undefined) ?? [])];
    reached.push(...(await reachesIn(vault, r.path, fm.join('\n'), r.via)));
    reached.push(...(await reachesIn(vault, r.path, note.body, r.via)));
  }

  // 3. keep meetings / decisions / the project note; merge the blocks asked for per note
  const byPath = new Map<string, { kind: OriginKind; blocks: string[]; via: string }>();
  for (const r of reached) {
    let type: string | undefined;
    try {
      type = (await vault.read(r.path)).data.type as string | undefined;
    } catch {
      continue;
    }
    const kind = type ? KIND_OF[type] : undefined;
    if (!kind) continue;
    if (kind === '决定' && !DECISION_PATH.test(r.path)) continue;
    const e = byPath.get(r.path) ?? { kind, blocks: [], via: r.via };
    for (const b of r.blocks) if (!e.blocks.includes(b)) e.blocks.push(b);
    byPath.set(r.path, e);
  }

  const items: OriginItem[] = [];
  for (const [path, e] of [...byPath].sort(([, a], [, b]) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))) {
    const blocks = await vault.getBlocks(path).catch(() => new Map());
    let ids = e.blocks.filter((id) => blocks.has(id));
    if (ids.length === 0 && e.kind === '会议') {
      // the plan cites the meeting as a whole: show the blocks that carry the directive
      ids = [...blocks.values()].filter((b) => /重点|指示|方向/.test(b.text)).map((b) => b.id);
    }
    ids = ids.slice(0, MAX_BLOCKS_PER_NOTE);
    if (ids.length === 0) {
      // a decision has no blocks: it is quoted from its 决定 section, so the line can be checked like any citation
      const quote = e.kind === '决定' ? decisionQuote(await vault.read(path).then((n) => n.body).catch(() => '')) : null;
      items.push({ kind: e.kind, name: base(path), path, link: `[[${noExt(path)}]]`, quote, via: e.via });
      continue;
    }
    for (const id of ids) {
      items.push({ kind: e.kind, name: base(path), path, link: `[[${noExt(path)}#^${id}]]`, quote: excerptOf(blocks.get(id)!.text), via: e.via });
    }
  }
  return items.slice(0, MAX_ITEMS);
}

/** A short verbatim stretch of a decision's 决定 section (what a report quotes when it cites the decision). */
export function decisionQuote(body: string): string | null {
  const q = excerptOf(decisionSection(body).replace(/^[-*]\s+/gm, ''));
  return q.length >= 6 ? q : null;
}

/** Bullet lines for "怎么查的". Block items read `“quote”（块）[[…#^m1]]`, so check_citations can verify them. */
export function renderOriginLines(items: OriginItem[]): string[] {
  if (items.length === 0) return ['- 这次调查的出发点：计划没有关联到会议、决定或项目笔记'];
  return [
    '- 这次调查的出发点（系统按计划链接到的研究计划、项目和假设写出，不是模型写的）：',
    ...items.map((i) => (i.quote ? `  - ${i.kind}「${readerName(i.name)}」：“${i.quote}”（来自 ${readerName(i.via)}）${i.link}` : `  - ${i.kind}「${readerName(i.name)}」（来自 ${readerName(i.via)}）：${i.link}`)),
  ];
}

