/**
 * Minimal, dependency-free markdown parsing for research reports.
 * Pure functions only — no IO, no environment access, no side effects.
 */
import { readerName } from '@/lib/notes/reader-name';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string } // **粗体**
  | { kind: 'code'; text: string } // `代码`
  | { kind: 'quote'; text: string } // “…” 或 「…」 之间的原文（不含引号本身）
  | { kind: 'citation'; link: string; block: string; target: string } // [[target#^block]] / [[target#^block|别名]]
  | { kind: 'link'; label: string } // 其他 [[…]]：别名，或最后一段路径
  | { kind: 'footnote'; id: string; numberFlag?: true; inferenceFlag?: true }; // 角标 [^3]：原文、等级、来源在文末的脚注里；numberFlag：显示时标的 [^3!]，这句的数字不在原文里；inferenceFlag：[^3~]，脚注挂在推论后面

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; items: ListItem[] } // 一整段连续的列表
  | { kind: 'blockquote'; inline: Inline[] } // 连续的 `> ` 行合成一段
  | { kind: 'footnote'; id: string; inline: Inline[] } // 脚注定义 `[^3]: “原文”（等级，来源）[[资料#^c1]]`
  | TableBlock; // GFM 表格

export type TableAlign = 'left' | 'center' | 'right' | null;
export interface TableBlock {
  kind: 'table';
  header: Inline[][];
  align: TableAlign[];
  /** Every row has exactly `header.length` cells (short rows padded with empty cells, extra cells dropped). */
  rows: Inline[][][];
}

export interface ListItem {
  inline: Inline[];
  children: ListItem[];
}

/** 去掉开头的 `---` … `---` frontmatter 块。没有 frontmatter 时原样返回。 */
export function stripFrontmatter(src: string): string {
  const withoutBom = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  const lines = withoutBom.split('\n');
  const first = lines[0];
  if (first === undefined || first.trim() !== '---') return src;

  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '---' || line === '...') {
      return lines.slice(i + 1).join('\n');
    }
  }
  // 没有闭合行：当成普通内容。
  return src;
}

function parseWikilink(link: string, inner: string): Inline {
  const pipeIndex = inner.indexOf('|');
  const targetPart = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex);
  const alias = pipeIndex === -1 ? '' : inner.slice(pipeIndex + 1).trim();
  const blockIndex = targetPart.indexOf('#^');

  if (blockIndex !== -1) {
    return {
      kind: 'citation',
      link,
      block: targetPart.slice(blockIndex + 2).trim(),
      target: targetPart.slice(0, blockIndex).trim(),
    };
  }

  const withoutAnchor = targetPart.split('#')[0] ?? '';
  const segments = withoutAnchor.split('/').filter((segment) => segment.trim().length > 0);
  const lastSegment = segments.length > 0 ? segments[segments.length - 1] ?? '' : '';
  const label = alias.length > 0 ? alias : readerName(lastSegment.trim());

  return { kind: 'link', label };
}

/** 表格单元格里的 `<br>`（报告的推荐表格：`结论<br>依据：…`）换成 `\n`；显示时单元格按 pre-line 换行。只在表格里。 */
export function cellText(cell: string): string {
  return cell.replace(/<br\s*\/?>/gi, '\n');
}

/** 把一行内联文本拆成 text / bold / code / quote / citation / link。 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer.length > 0) {
      out.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  while (i < src.length) {
    const ch = src.charAt(i);

    if (ch === '*' && src.charAt(i + 1) === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: 'bold', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[' && src.charAt(i + 1) === '^') {
      const m = /^\[\^(\d+)([!~]*)\]/.exec(src.slice(i));
      if (m) {
        flush();
        const flags = m[2] ?? '';
        out.push({ kind: 'footnote', id: m[1] ?? '', ...(flags.includes('!') ? { numberFlag: true as const } : {}), ...(flags.includes('~') ? { inferenceFlag: true as const } : {}) });
        i += m[0].length;
        continue;
      }
    }

    if (ch === '[' && src.charAt(i + 1) === '[') {
      const end = src.indexOf(']]', i + 2);
      if (end > i + 2) {
        flush();
        out.push(parseWikilink(src.slice(i, end + 2), src.slice(i + 2, end)));
        i = end + 2;
        continue;
      }
    }

    if (ch === '“' || ch === '「') {
      const closer = ch === '“' ? '”' : '」';
      const end = src.indexOf(closer, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'quote', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return out;
}

/**
 * Split one table row into cells. A `|` splits cells unless it is escaped (`\|`), inside a wikilink
 * (`[[资料|别名]]`) or inside backticks. The optional leading / trailing pipe does not make an empty cell.
 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let i = 0;
  const s = line.trim();
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch === '\\' && s.charAt(i + 1) === '|') {
      cell += '|';
      i += 2;
      continue;
    }
    if (ch === '[' && s.charAt(i + 1) === '[') {
      const end = s.indexOf(']]', i + 2);
      if (end > 0) {
        cell += s.slice(i, end + 2);
        i = end + 2;
        continue;
      }
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        cell += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ch === '|') {
      cells.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  cells.push(cell);
  if (s.startsWith('|')) cells.shift();
  if (s.endsWith('|') && !s.endsWith('\\|')) cells.pop();
  return cells.map((c) => c.trim());
}

const SEPARATOR_CELL = /^:?-{1,}:?$/;

/** `| --- | :---: |` — a delimiter row: only dashes / colons / pipes, at least one pipe. */
export function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|') && !/^:?-+:?$/.test(t)) return false;
  if (!t.includes('|')) return false;
  const cells = splitTableRow(t);
  return cells.length > 0 && cells.every((c) => SEPARATOR_CELL.test(c));
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function indentationLevel(indent: string): number {
  let tabs = 0;
  let spaces = 0;
  for (let i = 0; i < indent.length; i += 1) {
    const ch = indent.charAt(i);
    if (ch === '\t') {
      tabs += 1;
      spaces = 0;
    } else {
      spaces += 1;
    }
  }
  return tabs + Math.floor(spaces / 2);
}

function buildListItems(entries: Array<{ level: number; text: string }>): ListItem[] {
  const root: ListItem[] = [];
  const stack: Array<{ level: number; children: ListItem[] }> = [{ level: -1, children: root }];

  for (const entry of entries) {
    const item: ListItem = { inline: parseInline(entry.text), children: [] };

    let top = stack[stack.length - 1];
    while (stack.length > 1 && top !== undefined && top.level >= entry.level) {
      stack.pop();
      top = stack[stack.length - 1];
    }

    if (top !== undefined) top.children.push(item);
    else root.push(item);

    stack.push({ level: entry.level, children: item.children });
  }

  return root;
}

/** 把报告 markdown 解析成块结构。 */
export function parseMarkdown(src: string): Block[] {
  const body = stripFrontmatter(src);
  const lines = body.split('\n');
  const blocks: Block[] = [];

  let paragraphLines: string[] = [];
  let listEntries: Array<{ level: number; text: string }> | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(' ').trim();
    paragraphLines = [];
    if (text.length > 0) blocks.push({ kind: 'paragraph', inline: parseInline(text) });
  };

  const flushList = () => {
    if (listEntries === null) return;
    const entries = listEntries;
    listEntries = null;
    if (entries.length > 0) blocks.push({ kind: 'list', items: buildListItems(entries) });
  };

  let quoteLines: string[] = [];
  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    const text = quoteLines.join(' ').trim();
    quoteLines = [];
    if (text.length > 0) blocks.push({ kind: 'blockquote', inline: parseInline(text) });
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = (lines[lineIndex] ?? '').replace(/\r$/, '');
    const trimmed = line.trim();

    // GFM table: a row with a pipe, directly followed by a delimiter row.
    if (trimmed.includes('|') && isTableSeparator((lines[lineIndex + 1] ?? '').replace(/\r$/, ''))) {
      const headerCells = splitTableRow(trimmed);
      const separatorCells = splitTableRow(lines[lineIndex + 1] ?? '');
      if (headerCells.length === separatorCells.length) {
        flushAll();
        const width = headerCells.length;
        const rows: Inline[][][] = [];
        let next = lineIndex + 2;
        while (next < lines.length) {
          const rowLine = (lines[next] ?? '').replace(/\r$/, '');
          if (rowLine.trim().length === 0 || !rowLine.includes('|')) break;
          const cells = splitTableRow(rowLine);
          rows.push(Array.from({ length: width }, (_, c) => parseInline(cellText(cells[c] ?? ''))));
          next += 1;
        }
        blocks.push({
          kind: 'table',
          header: headerCells.map((c) => parseInline(cellText(c))),
          align: separatorCells.map(alignOf),
          rows,
        });
        lineIndex = next - 1;
        continue;
      }
    }

    const quote = /^>[ \t]?(.*)$/.exec(trimmed);
    if (quote !== null) {
      flushParagraph();
      flushList();
      quoteLines.push((quote[1] ?? '').trim());
      continue;
    }
    flushQuote();

    if (trimmed.length === 0) {
      flushAll();
      continue;
    }

    const footnote = /^\[\^(\d+)\]:\s*(.*)$/.exec(trimmed);
    if (footnote !== null) {
      flushAll();
      blocks.push({ kind: 'footnote', id: footnote[1] ?? '', inline: parseInline(footnote[2] ?? '') });
      continue;
    }

    const heading = /^(#{1,6})(?:\s+(.*))?$/.exec(trimmed);
    const hashes = heading?.[1];
    if (heading !== null && hashes !== undefined) {
      flushAll();
      const level = Math.min(hashes.length, 4) as 1 | 2 | 3 | 4;
      const text = (heading[2] ?? '').replace(/\s+#+\s*$/, '').trim();
      blocks.push({ kind: 'heading', level, inline: parseInline(text) });
      continue;
    }

    const item = /^([ \t]*)(?:[-*]|\d+\.)[ \t]+(.*)$/.exec(line);
    if (item !== null) {
      flushParagraph();
      if (listEntries === null) listEntries = [];
      listEntries.push({
        level: indentationLevel(item[1] ?? ''),
        text: (item[2] ?? '').trim(),
      });
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushAll();
  return blocks;
}
