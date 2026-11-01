/**
 * Frontmatter split / join. YAML is parsed with the CORE schema so dates stay
 * strings (`2026-10-24` is never turned into a Date) — schemas validate them.
 */
import yaml from 'js-yaml';

export interface ParsedMarkdown {
  /** Raw frontmatter object ({} when the file has none). */
  data: Record<string, unknown>;
  /** Markdown body after the closing `---`. */
  body: string;
  hasFrontmatter: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseMarkdown(text: string): ParsedMarkdown {
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text, hasFrontmatter: false };
  const loaded = yaml.load(m[1], { schema: yaml.CORE_SCHEMA });
  const data = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? (loaded as Record<string, unknown>) : {};
  return { data, body: text.slice(m[0].length), hasFrontmatter: true };
}

export function serializeMarkdown(data: Record<string, unknown>, body: string): string {
  // A date-only string is written quoted (`created: "2026-10-24"`), the way notes are written by hand: an unquoted one reads as a date in Obsidian.
  const fm = yaml
    .dump(data, { schema: yaml.CORE_SCHEMA, lineWidth: -1, noRefs: true, quotingType: '"' })
    .replace(/^([A-Za-z_]+): (\d{4}-\d{2}-\d{2})$/gm, '$1: "$2"');
  const normalizedBody = body.startsWith('\n') ? body : `\n${body}`;
  return `---\n${fm}---\n${normalizedBody.endsWith('\n') ? normalizedBody : `${normalizedBody}\n`}`;
}
