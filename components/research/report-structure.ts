/**
 * What the report page reads off a question-tree report's structure (D-48): the question tree drawn from the
 * `## Qx` / `### Qx-y` headings, and the third layer of each hypothesis card (evidence, counter-evidence,
 * gaps) that the page folds. Pure functions over markdown-lite's blocks; the file itself is never changed.
 */
import type { Block, Inline, ListItem } from './markdown-lite';

/**
 * A quote is a passage from a source only when a footnote or a block link follows it right away (`“原文”[^3]`,
 * `“原文”（B 级，知识库）[[资料#^c1]]`). Any other quoted words are the author's own: a stressed term, a condition, a question.
 */
export function isSourceQuote(inline: Inline[], index: number): boolean {
  let next = inline[index + 1];
  if (next?.kind === 'text' && /^[（(][^）)]*[）)]$/.test(next.text.trim())) next = inline[index + 2];
  return next?.kind === 'footnote' || next?.kind === 'citation';
}

export function inlineText(inline: Inline[]): string {
  return inline
    .map((n) => {
      switch (n.kind) {
        case 'text':
        case 'bold':
        case 'code':
          return n.text;
        case 'quote':
          return `“${n.text}”`;
        case 'link':
          return n.label;
        case 'citation':
          return n.link;
        case 'footnote':
          return `[${n.id}]`;
      }
    })
    .join('');
}

type HeadingBlock = Extract<Block, { kind: 'heading' }>;

const headingText = (b: HeadingBlock): string => inlineText(b.inline).trim();
const HYPOTHESIS_HEADING = /^假设\s*H\d/;
const TOP_QUESTION = /^(Q\d+)\s+(.+)$/;
const SUB_QUESTION = /^(Q\d+-\d+)\s+(.+)$/;
const ANSWER_HEADING = /^Q\d+(?:-\d+)?\s*的回答$/;

/** A report in the question-tree format: a `## Qx` section per question and `假设 Hx` cards in them. Others show as they are. */
export function isQuestionTree(blocks: Block[]): boolean {
  let questions = false;
  let hypotheses = false;
  for (const b of blocks) {
    if (b.kind !== 'heading') continue;
    const text = headingText(b);
    if (b.level === 2 && TOP_QUESTION.test(text)) questions = true;
    if (HYPOTHESIS_HEADING.test(text)) hypotheses = true;
  }
  return questions && hypotheses;
}

export interface TreeNode {
  id: string;
  text: string;
  children: TreeNode[];
}

/** `## Q2 …` with its `### Q2-1 …` children, in the report's order. A question with no sub-questions has no children. */
export function questionTree(blocks: Block[]): TreeNode[] {
  const roots: TreeNode[] = [];
  for (const b of blocks) {
    if (b.kind !== 'heading') continue;
    const text = headingText(b);
    if (b.level === 2) {
      const m = TOP_QUESTION.exec(text);
      if (m && !ANSWER_HEADING.test(text)) roots.push({ id: m[1] ?? '', text: m[2] ?? '', children: [] });
      continue;
    }
    if (b.level === 3) {
      const m = SUB_QUESTION.exec(text);
      const parent = roots[roots.length - 1];
      if (m && parent && !ANSWER_HEADING.test(text)) parent.children.push({ id: m[1] ?? '', text: m[2] ?? '', children: [] });
    }
  }
  return roots;
}

/** The anchor a question heading gets, so the tree's nodes can link to it. */
export const questionAnchor = (id: string): string => `q-${id}`;

/** The id of a `## Qx …` / `### Qx-y …` heading, when it is one. */
export function questionIdOf(b: HeadingBlock): string | null {
  const text = headingText(b);
  if (ANSWER_HEADING.test(text)) return null;
  if (b.level !== 2 && b.level !== 3) return null;
  return (b.level === 2 ? TOP_QUESTION : SUB_QUESTION).exec(text)?.[1] ?? null;
}

export interface FoldCounts {
  support: number;
  counter: number;
  asks: number;
}

export interface Fold {
  /** Index of the list block holding the `- 支持的证据：` item. */
  start: number;
  /** First item of that list that goes into the fold (the 支持的证据 item itself); the ones before it stay out. */
  fromItem: number;
  /** First block after the card (the next heading, or the end). */
  end: number;
  counts: FoldCounts;
}

type Label = 'support' | 'counter' | 'gaps' | 'other';

function labelOf(item: ListItem): Label {
  const text = inlineText(item.inline).trim();
  if (/^支持的证据/.test(text)) return 'support';
  if (/^反证和挑战/.test(text)) return 'counter';
  if (/^缺口/.test(text)) return 'gaps';
  return 'other';
}

/** 支持 N · 反证 M · 要问专家 K: the rows of the two evidence tables, or their sub-items when written as a list; the 要问专家 lines under 缺口. */
function countsOf(blocks: Block[], start: number, fromItem: number, end: number): FoldCounts {
  const counts: FoldCounts = { support: 0, counter: 0, asks: 0 };
  let current: Label = 'other';
  for (let i = start; i < end; i += 1) {
    const b = blocks[i];
    if (!b) continue;
    if (b.kind === 'table') {
      if (current === 'support') counts.support += b.rows.length;
      if (current === 'counter') counts.counter += b.rows.length;
    } else if (b.kind === 'list') {
      for (const item of b.items.slice(i === start ? fromItem : 0)) {
        current = labelOf(item);
        if (current === 'support') counts.support += item.children.length;
        if (current === 'counter') counts.counter += item.children.length;
        if (current === 'gaps') counts.asks += item.children.filter((c) => /^要问专家/.test(inlineText(c.inline).trim())).length;
      }
    }
  }
  return counts;
}

/** One fold per hypothesis card: from its `- 支持的证据：` item to the card's end. Cards without that item are left as they are. */
export function findFolds(blocks: Block[]): Fold[] {
  const folds: Fold[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const heading = blocks[i];
    if (heading?.kind !== 'heading' || !HYPOTHESIS_HEADING.test(headingText(heading))) continue;
    let end = i + 1;
    while (end < blocks.length && blocks[end]?.kind !== 'heading') end += 1;
    for (let at = i + 1; at < end; at += 1) {
      const b = blocks[at];
      if (b?.kind !== 'list') continue;
      const fromItem = b.items.findIndex((item) => labelOf(item) === 'support');
      if (fromItem < 0) continue;
      folds.push({ start: at, fromItem, end, counts: countsOf(blocks, at, fromItem, end) });
      break;
    }
    i = end - 1;
  }
  return folds;
}

export const foldTitle = (c: FoldCounts): string => `证据、反证和挑战、缺口（支持 ${c.support} · 反证 ${c.counter} · 要问专家 ${c.asks}）`;

const normalize = (text: string): string => text.replace(/\[\d+\]/g, '').replace(/[\s。；;，,]/g, '');

/**
 * A sub-question that was not split shows its answer twice: `- 回答：…` in its card and the same sentence under
 * `### Qx 的回答`. The page shows the card's, so this finds the `### Qx 的回答` section (heading and body, by block
 * index) to leave out. Obsidian keeps both. A roll-up answer that differs from every card's is not touched.
 */
export function duplicateAnswerBlocks(blocks: Block[]): Set<number> {
  const hidden = new Set<number>();
  for (let i = 0; i < blocks.length; i += 1) {
    const heading = blocks[i];
    if (heading?.kind !== 'heading' || heading.level !== 3 || !ANSWER_HEADING.test(headingText(heading))) continue;
    let end = i + 1;
    while (end < blocks.length && blocks[end]?.kind !== 'heading') end += 1;
    const body = normalize(
      blocks
        .slice(i + 1, end)
        .map((b) => (b.kind === 'paragraph' ? inlineText(b.inline) : ''))
        .join(''),
    );
    if (!body) continue;
    let from = i - 1;
    while (from >= 0 && !(blocks[from]?.kind === 'heading' && (blocks[from] as HeadingBlock).level <= 2)) from -= 1;
    const cardAnswers = blocks
      .slice(from + 1, i)
      .flatMap((b) => (b.kind === 'list' ? b.items : []))
      .map((item) => /^回答[：:]\s*(.*)$/.exec(inlineText(item.inline).trim())?.[1])
      .filter((t): t is string => t !== undefined)
      .map(normalize);
    if (cardAnswers.includes(body)) for (let k = i; k < end; k += 1) hidden.add(k);
  }
  return hidden;
}

export type ConditionStatus = '成立' | '不成立' | '证据不足';

export interface ConditionLine {
  mark: string;
  /** The condition, as the plan words it. */
  before: Inline[];
  status: ConditionStatus;
  /** What follows the status: `：说明`, footnotes, `（系统复核：…）`. */
  after: Inline[];
}

const CIRCLED = /^([①-⑩])\s*/;
const STATUS_ARROW = /\s*→\s*(成立|不成立|证据不足)/;

/** `① 条件 → 成立[^3]` / `② 条件 → 不成立：说明[^7]`: a list item of the card's 逐条对照. Other items give null. */
export function conditionLine(inline: Inline[]): ConditionLine | null {
  const first = inline[0];
  if (first?.kind !== 'text') return null;
  const mark = CIRCLED.exec(first.text)?.[1];
  if (!mark) return null;
  for (let i = inline.length - 1; i >= 0; i -= 1) {
    const node = inline[i];
    if (node?.kind !== 'text') continue;
    const at = node.text.search(STATUS_ARROW);
    if (at < 0) continue;
    const m = STATUS_ARROW.exec(node.text);
    if (!m) continue;
    const status = m[1] as ConditionStatus;
    const head: Inline[] = inline.slice(0, i);
    const lead = node.text.slice(0, at);
    const tail = node.text.slice(at + m[0].length);
    const before = [...head, ...(lead ? [{ kind: 'text' as const, text: lead }] : [])];
    const firstBefore = before[0];
    if (firstBefore?.kind === 'text') before[0] = { kind: 'text', text: firstBefore.text.replace(CIRCLED, '') };
    return { mark, before, status, after: [...(tail ? [{ kind: 'text' as const, text: tail }] : []), ...inline.slice(i + 1)] };
  }
  return null;
}

/**
 * The Summary's `问题树：` line is the split basis, then the whole tree as one long sentence (`核心问题 → Q1 …／Q2 …`).
 * With the tree drawn the page keeps only the basis: the nodes before `核心问题 →`, or none when the report has no basis.
 */
export function splitBasisOf(inline: Inline[]): Inline[] {
  for (let i = 0; i < inline.length; i += 1) {
    const node = inline[i];
    if (node?.kind !== 'text') continue;
    const at = node.text.search(/核心问题\s*→/);
    if (at < 0) continue;
    const head = node.text.slice(0, at);
    return [...inline.slice(0, i), ...(head ? [{ kind: 'text' as const, text: head }] : [])];
  }
  return inline;
}
