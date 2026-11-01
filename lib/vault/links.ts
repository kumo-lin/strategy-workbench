/**
 * Obsidian wikilink parsing. Pure string functions — no filesystem access.
 *
 * Supported forms (Obsidian syntax):
 *   [[笔记]]              note by basename
 *   [[目录/笔记]]          note by vault-relative path (no .md)
 *   [[笔记#标题]]          heading inside a note
 *   [[笔记#^c3]]          block inside a note (citations use this)
 *   [[笔记|显示名]]        alias (display text only)
 */

export interface WikiLink {
  /** The raw text including brackets, e.g. `[[资料#^c1|资料]]`. */
  raw: string;
  /** Note part: basename or vault-relative path, without `.md`. */
  target: string;
  /** Heading after `#` (not a block ref), if any. */
  heading?: string;
  /** Block id after `#^`, if any (e.g. `c1`). */
  block?: string;
  alias?: string;
}

const LINK_RE = /\[\[([^\[\]]+?)\]\]/g;
const SINGLE_LINK_RE = /^\[\[([^\[\]]+?)\]\]$/;

function parseInner(raw: string, inner: string): WikiLink {
  let rest = inner;
  let alias: string | undefined;
  const pipe = rest.indexOf('|');
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe);
  }
  let heading: string | undefined;
  let block: string | undefined;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    const frag = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash);
    if (frag.startsWith('^')) block = frag.slice(1);
    else if (frag) heading = frag;
  }
  const target = rest.trim().replace(/\.md$/, '');
  return { raw, target, ...(heading ? { heading } : {}), ...(block ? { block } : {}), ...(alias ? { alias } : {}) };
}

/** Parse exactly one `[[...]]` string; returns null if the string is not a single wikilink. */
export function parseWikiLink(value: string): WikiLink | null {
  const m = SINGLE_LINK_RE.exec(value.trim());
  if (!m) return null;
  const link = parseInner(value.trim(), m[1]);
  return link.target ? link : null;
}

/** Find every wikilink in free text (body markdown). */
export function extractWikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const link = parseInner(m[0], m[1]);
    if (link.target) out.push(link);
  }
  return out;
}

/** Build a link string. `target` is a basename or vault-relative path without `.md`. */
export function toWikiLink(target: string, opts: { block?: string; heading?: string; alias?: string } = {}): string {
  const t = target.replace(/\.md$/, '');
  const frag = opts.block ? `#^${opts.block}` : opts.heading ? `#${opts.heading}` : '';
  const alias = opts.alias ? `|${opts.alias}` : '';
  return `[[${t}${frag}${alias}]]`;
}
