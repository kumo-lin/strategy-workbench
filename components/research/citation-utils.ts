import { isSimulatedInterview, type CitationDetail } from '@/lib/research/citation-types';

import { parseMarkdown, type Block, type Inline, type ListItem } from './markdown-lite';

export interface CitedSource {
  sourceName: string;
  sourcePath: string | null;
  grade: 'A' | 'B' | 'C' | null;
  gradedBy: 'AI' | '人' | null;
  origin: '知识库' | '网络' | '专家访谈' | null;
  /** Interview note that was simulated: shown as 专家意见, not as a graded source. */
  simulated: boolean;
  publisher: string | null;
  url: string | null;
  /** 这份资料在报告里被引用了几次（块引用的次数，同一个链接出现几次算几次）。 */
  count: number;
}

type CitationInline = Extract<Inline, { kind: 'citation' }>;

function visitInline(inline: Inline[], visit: (node: CitationInline) => void): void {
  for (const node of inline) {
    if (node.kind === 'citation') visit(node);
  }
}

function visitItems(items: ListItem[], visit: (node: CitationInline) => void): void {
  for (const item of items) {
    visitInline(item.inline, visit);
    visitItems(item.children, visit);
  }
}

/** 按出现顺序取第一个非 null 的值；全都为 null（或没有详情）时返回 null。 */
function pickFirst<T>(
  details: CitationDetail[],
  read: (detail: CitationDetail) => T | null,
): T | null {
  for (const detail of details) {
    const value = read(detail);
    if (value !== null) return value;
  }
  return null;
}

/** 按报告里首次被引用的顺序，每份资料一行（以 sourceName 区分）。找不到详情的引用跳过。 */
export function uniqueCitedSources(
  markdown: string,
  citations: Record<string, CitationDetail>,
): CitedSource[] {
  const order: string[] = [];
  const grouped = new Map<string, CitationDetail[]>();

  const visit = (node: CitationInline): void => {
    const detail = citations[node.link];
    if (detail === undefined) return;

    const existing = grouped.get(detail.sourceName);
    if (existing === undefined) {
      order.push(detail.sourceName);
      grouped.set(detail.sourceName, [detail]);
      return;
    }
    existing.push(detail);
  };

  for (const block of parseMarkdown(markdown)) {
    if (block.kind === 'list') visitItems(block.items, visit);
    else if (block.kind === 'table') {
      for (const cell of block.header) visitInline(cell, visit);
      for (const row of block.rows) for (const cell of row) visitInline(cell, visit);
    } else visitInline(block.inline, visit);
  }

  return order.map((sourceName) => {
    const details = grouped.get(sourceName) ?? [];
    return {
      sourceName,
      sourcePath: pickFirst(details, (detail) => detail.sourcePath),
      grade: pickFirst(details, (detail) => detail.grade),
      gradedBy: pickFirst(details, (detail) => detail.gradedBy),
      origin: pickFirst(details, (detail) => detail.origin),
      simulated: details.some((detail) => detail.simulated === true),
      publisher: pickFirst(details, (detail) => detail.publisher),
      url: pickFirst(details, (detail) => detail.url),
      count: details.length,
    };
  });
}

/**
 * Footnote ids whose definition cites a simulated interview block. The report text never says "模拟" next to the
 * marker (D-21 v3 is frozen): the viewer and the compare page add the tag from this, the file stays as it is.
 */
export function simulatedFootnotes(blocks: Block[], citations: Record<string, CitationDetail> | undefined): Set<string> {
  const out = new Set<string>();
  if (!citations) return out;
  for (const b of blocks) {
    if (b.kind !== 'footnote') continue;
    const first = b.inline.find((n): n is CitationInline => n.kind === 'citation');
    if (first && isSimulatedInterview(citations[first.link])) out.add(b.id);
  }
  return out;
}
