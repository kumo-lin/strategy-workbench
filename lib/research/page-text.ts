/** Fetched pages come back as markdown with escapes (`32\.1\%`); quotes must be matched against plain text. */
export function unescapeMarkdown(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!%|~<>$&=,:;'"@?/])/g, '$1');
}
