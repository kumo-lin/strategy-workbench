/**
 * A follow-up investigation rewrites "AI 的推荐判断" on all of v(N+1)'s judgments. The new table replaces the old one
 * in Summary; the old one moves to the appendix as "vN 的推荐判断（已被本版替换）"; and "本版变化" lists the parts
 * that changed (see mergeRecommendation below).
 */
import { joinClauses } from './report';

export const REC_HEADING = '- AI 的推荐判断（提议，待你拍板）：';
export const REC_CLOSING = '以上全部是 AI 提议，状态只有人能改。';
/** A question-tree report's heading (D-39): it says once that all of it is AI's proposal, and has no closing line. */
export const REC_HEADING_TREE = '- AI 的推荐判断（待你拍板）：下面全部是 AI 的提议，状态只有人能改。';

export interface RecRow {
  label: string;
  text: string;
}

/** Where the recommendation block sits: from its heading line to its closing line (inclusive), or null. */
export function recommendationRange(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => l.trim() === REC_HEADING || l.trim() === REC_HEADING_TREE);
  if (start < 0) return null;
  let end = lines.findIndex((l, k) => k > start && l.trim() === REC_CLOSING);
  if (end < 0) {
    // no closing line: the block ends at the next top-level bullet or heading
    end = lines.findIndex((l, k) => k > start && (/^- /.test(l) || /^#/.test(l)));
    end = end < 0 ? lines.length - 1 : end - 1;
  }
  return { start, end };
}

/** The table rows of a recommendation block: first cell (label) and second cell (text, without footnote markers). */
export function recommendationRows(block: string[]): RecRow[] {
  const rows: RecRow[] = [];
  for (const l of block) {
    if (!/^\|/.test(l.trim()) || /^\|[\s|:-]+\|$/.test(l.trim()) || /^\|\s*\|\s*提议\s*\|$/.test(l.trim())) continue;
    const cells = l.trim().replace(/^\||\|$/g, '').split('|');
    if (cells.length < 2) continue;
    rows.push({ label: cells[0].trim(), text: cells.slice(1).join('|').replace(/\[\^\d+\]/g, '').trim() });
  }
  return rows;
}

/**
 * Puts `newBlock` where the old recommendation was (or at the end of Summary when there was none) and moves the old
 * block, relabelled, to the end of the appendix. Returns the new lines and the old block's rows (null: there was none).
 */
export function replaceRecommendation(lines: string[], newBlock: string[], vPrev: number): { lines: string[]; oldRows: RecRow[] | null } {
  const out = [...lines];
  const range = recommendationRange(out);
  let oldBlock: string[] | null = null;
  if (range) {
    oldBlock = out.slice(range.start, range.end + 1);
    out.splice(range.start, range.end - range.start + 1, ...newBlock);
  } else {
    const sum = out.findIndex((l) => /^## Summary/.test(l));
    let end = out.findIndex((l, k) => k > sum && /^## /.test(l));
    if (end < 0) end = out.length;
    out.splice(end, 0, ...newBlock, '');
  }
  if (oldBlock) {
    const kept = [`- v${vPrev} 的推荐判断（已被本版替换）：`, ...oldBlock.slice(1).filter((l) => l.trim() !== REC_CLOSING)];
    const app = out.findIndex((l) => /^## 附录/.test(l));
    if (app >= 0) {
      let end = out.findIndex((l, k) => k > app && /^## /.test(l));
      if (end < 0) end = out.length;
      while (end > app + 1 && out[end - 1].trim() === '') end--;
      out.splice(end, 0, ...kept, '');
    } else {
      const fn = out.findIndex((l) => /^## 引文出处/.test(l));
      const at = fn < 0 ? out.length : fn;
      out.splice(at, 0, '## 附录：过程记录', ...kept, '');
    }
  }
  return { lines: out, oldRows: oldBlock ? recommendationRows(oldBlock) : null };
}

/** The old recommendation as text, for the model (the rows, one per line). */
export function recommendationText(body: string): string | undefined {
  const lines = body.split('\n');
  const range = recommendationRange(lines);
  if (!range) return undefined;
  const rows = recommendationRows(lines.slice(range.start, range.end + 1));
  return rows.length ? rows.map((r) => `- ${r.label}：${r.text}`).join('\n') : undefined;
}

// ── A follow-up's rewrite, part by part ─────────────────────────────────────
//
// D-21 (b), live: the model rewrote all nine cells in other words, so a text diff called every cell "changed". The
// rewrite now says per part whether it changed and why; code keeps vN's exact rows for every part that did not
// (whatever the model wrote this time), and lists only the parts that did, in full. The alternatives are decided
// row by row (v4: one option's reason changed, and all four rows were listed as changed).

export const REC_FIELD_ORDER = ['decision_answer', 'directive_response', 'action', 'scale', 'metrics', 'alternatives', 'change_if'] as const;
export type RecPart = (typeof REC_FIELD_ORDER)[number];
export const REC_PART_LABEL: Record<RecPart, string> = {
  decision_answer: '对 D1 的回答',
  directive_response: '怎么回应高层指示',
  action: '做什么',
  scale: '量级',
  metrics: '看什么指标',
  alternatives: '其他选项',
  change_if: '什么情况下要改',
};

/** Which part a table row belongs to, by its first cell. */
export function partOfRow(label: string): RecPart | null {
  if (label === '对决策的回答') return 'decision_answer';
  if (label === '怎么回应高层指示') return 'directive_response';
  if (label === '做什么') return 'action';
  if (label === '量级') return 'scale';
  if (label === '看什么指标') return 'metrics';
  if (label.startsWith('其他选项')) return 'alternatives';
  if (label === '什么情况下要改') return 'change_if';
  return null;
}

const isRow = (l: string) => /^\|/.test(l.trim()) && !/^\|[\s|:-]+\|$/.test(l.trim()) && !/^\|\s*\|\s*提议\s*\|$/.test(l.trim());
const rowLabel = (l: string) => l.trim().replace(/^\|/, '').split('|')[0].trim();
const rowText = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').slice(1).join('|').trim();

export interface PartChange {
  part: RecPart;
  /** Rows as `label：text` (alternatives keep their own labels), before and after. */
  before: string[];
  after: string[];
  why: string;
}

/** What a follow-up decided for one part; the alternatives also row by row (one per row of the new table, in table order). */
export interface PartDecision {
  changed: boolean;
  why: string;
  rows?: { changed: boolean; why: string }[];
}

const rowFootnotes = (l: string) => [...l.matchAll(/\[\^(\d+)\]/g)].map((m) => m[1]);

/** Per part, which of the `disproven` footnotes its rows in `block` cite (parts citing none are left out). */
export function partsCiting(block: string[], disproven: ReadonlySet<string>): Map<RecPart, string[]> {
  const out = new Map<RecPart, string[]>();
  for (const l of block) {
    const part = isRow(l) ? partOfRow(rowLabel(l)) : null;
    const hit = part ? rowFootnotes(l).filter((n) => disproven.has(n)) : [];
    if (part && hit.length) out.set(part, [...new Set([...(out.get(part) ?? []), ...hit])]);
  }
  return out;
}

/** Why a cell that stood on a disproven source was not kept. */
export const disprovenWhy = (ids: string[]) => `上一版依据的来源已证伪（${ids.map((n) => `[^${n}]`).join('')}），这一格不能沿用`;

/** An alternative's name (the text before its first "："), without punctuation: v3 "终端管理/安全" = v4 "终端管理、安全". */
const optionName = (l: string) => rowText(l).split(/[：:]/)[0].replace(/[\s\p{P}]/gu, '');

/**
 * The v(N+1) table: per part, vN's rows verbatim unless `changed[part]` says it changed (then the new rows).
 * The alternatives are decided row by row: a row matches vN's by its option name (else by its label and place), and
 * only the rows marked changed are replaced. A vN row citing a `disproven` footnote is never kept, whatever was
 * marked. Returns the block, the parts that changed, and how many rows were kept from vN.
 */
export function mergeRecommendation(
  oldBlock: string[],
  newBlock: string[],
  changed: Partial<Record<RecPart, PartDecision>>,
  disproven: ReadonlySet<string> = new Set(),
): { block: string[]; changes: PartChange[]; keptRows: number } {
  const tree = newBlock[0]?.trim() === REC_HEADING_TREE;
  const rowsOf = (block: string[], part: RecPart) => block.filter((l) => isRow(l) && partOfRow(rowLabel(l)) === part);
  const show = (l: string, part: RecPart) => (part === 'alternatives' ? `${rowLabel(l)}：${rowText(l)}` : rowText(l));
  const whyOf = (bad: string[], d?: { changed: boolean; why: string }) => joinClauses([bad.length ? disprovenWhy(bad) : '', d?.changed ? d.why : '']);
  const rows: string[] = [];
  const changes: PartChange[] = [];
  let keptRows = 0;
  for (const part of REC_FIELD_ORDER) {
    const before = rowsOf(oldBlock, part);
    const after = rowsOf(newBlock, part);
    const c = changed[part];
    if (!before.length && after.length) {
      // a row vN did not have at all (e.g. 怎么回应高层指示 added after v3): it is new, there is nothing to keep
      rows.push(...after);
      changes.push({ part, before: [], after: after.map((l) => show(l, part)), why: c?.why || '上一版没有这一格，这一版新加' });
    } else if (part === 'alternatives' && before.length) {
      // row by row; a part marked changed without rows (whole-part decision) changes every row
      const decisions = after.map((_, i) => (c?.changed ? (c.rows?.[i] ?? (c.rows ? { changed: false, why: '' } : { changed: true, why: c.why })) : { changed: false, why: '' }));
      const slot = (list: string[], k: number) => `${rowLabel(list[k])}#${list.slice(0, k).filter((x) => rowLabel(x) === rowLabel(list[k])).length}`;
      const used = new Set<number>();
      const matchOf = (j: number) => {
        let i = after.findIndex((l, k) => !used.has(k) && optionName(l) === optionName(before[j]));
        if (i < 0) i = after.findIndex((_, k) => !used.has(k) && slot(after, k) === slot(before, j));
        if (i >= 0) used.add(i);
        return i;
      };
      const ch: PartChange = { part, before: [], after: [], why: '' };
      const whys: string[] = [];
      before.forEach((old, j) => {
        const i = matchOf(j);
        const bad = rowFootnotes(old).filter((n) => disproven.has(n));
        const d = i >= 0 ? decisions[i] : undefined;
        if (bad.length || d?.changed) {
          if (i >= 0) {
            rows.push(after[i]);
            ch.after.push(show(after[i], part));
          }
          ch.before.push(show(old, part));
          whys.push(whyOf(bad, d));
        } else {
          rows.push(old);
          keptRows += 1;
        }
      });
      // an option vN did not list, added only when marked changed
      after.forEach((l, i) => {
        if (used.has(i) || !decisions[i].changed) return;
        rows.push(l);
        ch.after.push(show(l, part));
        whys.push(decisions[i].why);
      });
      if (ch.before.length || ch.after.length) changes.push({ ...ch, why: joinClauses([...new Set(whys.filter(Boolean))]) });
    } else {
      const bad = before.flatMap(rowFootnotes).filter((n) => disproven.has(n));
      if (bad.length || (c?.changed && after.length)) {
        rows.push(...after);
        changes.push({ part, before: before.map((l) => show(l, part)), after: after.map((l) => show(l, part)), why: whyOf([...new Set(bad)], c) });
      } else {
        rows.push(...before);
        keptRows += before.length;
      }
    }
  }
  return { block: tree ? [REC_HEADING_TREE, '', '| | 提议 |', '|---|---|', ...rows] : [REC_HEADING, '', '| | 提议 |', '|---|---|', ...rows, '', REC_CLOSING], changes, keptRows };
}

/** "推荐判断的变化": only the parts that changed, before and after in full, with why; then "其余 N 格未变". */
/** A cell's `结论<br>依据：…` (D-48 round 2) in a list line: the break only a table cell has. */
const inLine = (t: string) => t.replace(/<br>/g, ' ');

export function renderPartChanges(changes: PartChange[], keptRows: number, ex: (t: string) => string): string[] {
  const out: string[] = [];
  for (const c of changes) {
    out.push(`  - ${REC_PART_LABEL[c.part]}（变了）：`);
    out.push(...(c.before.length ? c.before.map((t) => `    - 改前：${inLine(t)}`) : ['    - 改前：（没有）']));
    out.push(...(c.after.length ? c.after.map((t) => `    - 改后：${inLine(t)}`) : ['    - 改后：（没有）']));
    out.push(`    - 为什么：${ex(c.why)}`);
  }
  if (!changes.length) out.push('  - 各格都没有变：这次的新证据没有改变推荐判断');
  else if (keptRows) out.push(`  - 其余 ${keptRows} 格未变`);
  return out;
}
