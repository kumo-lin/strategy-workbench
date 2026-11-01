/**
 * Obsidian block references (`^c3` at the end of a line). PRD §6.3.1 step 4:
 * every extracted claim in a source note carries a block id `^cN`, and
 * citations point at it as `[[资料名#^cN]]` (§9.7).
 *
 * Block text rules (subset of Obsidian's):
 *   - list item / quote line ending with ` ^id` → that line, marker stripped
 *   - paragraph line ending with ` ^id` → the whole paragraph (lines since the
 *     previous blank line), marker stripped
 *   - a line that is only `^id` → the paragraph immediately above it
 * Code fences are skipped.
 */

export interface Block {
  id: string;
  /** Block text without the `^id` marker and list/quote prefix. */
  text: string;
  /** 1-based line number of the marker within the body. */
  line: number;
}

const MARKER_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const LIST_OR_QUOTE_RE = /^\s*(?:[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+|>\s?)/;

function stripPrefix(line: string): string {
  return line.replace(LIST_OR_QUOTE_RE, '').trim();
}

export function parseBlocks(body: string): Map<string, Block> {
  const lines = body.split(/\r?\n/);
  const blocks = new Map<string, Block>();
  let inFence = false;
  let paraStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      paraStart = i + 1;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === '') {
      paraStart = i + 1;
      continue;
    }
    const m = MARKER_RE.exec(line);
    if (!m) continue;
    const id = m[1];
    const withoutMarker = line.slice(0, m.index).trimEnd();

    let text: string;
    if (withoutMarker.trim() === '') {
      // Standalone marker line: the paragraph above it.
      const para = lines.slice(paraStart, i).map(stripPrefix);
      text = para.join(' ').trim();
    } else if (LIST_OR_QUOTE_RE.test(withoutMarker)) {
      text = stripPrefix(withoutMarker);
    } else {
      const para = [...lines.slice(paraStart, i), withoutMarker].map((l) => l.trim());
      text = para.join(' ').trim();
    }
    // First definition wins (Obsidian behaves the same with duplicates).
    if (!blocks.has(id)) blocks.set(id, { id, text, line: i + 1 });
  }
  return blocks;
}

/** Whitespace/punctuation-insensitive comparison used for "does the quote match the block". */
export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s"'“”‘’「」『』《》()（）\[\]【】,，.。:：;；!！?？、…—\-*_`]+/g, '');
}

export function quoteMatchesBlock(quote: string, block: Block): boolean {
  const q = normalizeForQuote(quote);
  return q.length > 0 && normalizeForQuote(block.text).includes(q);
}
