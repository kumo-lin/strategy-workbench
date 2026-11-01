/**
 * Finds names from the app's internals in visible page text. A user must never read a file name,
 * a tool name, a block id or a vault folder path on the page. Pure; no I/O.
 */
const PATTERNS: { what: string; re: RegExp }[] = [
  // File names ending in .md (the name may hold spaces/Chinese; a bare `v1.md` inside `计划 v1.md` is enough).
  { what: 'file name ending in .md', re: /[^\s/\\]*\.md\b/g },
  // snake_case tool names: vault_read, ask_user, write_draft, report_format.
  { what: 'tool name (snake_case)', re: /\b[a-z]{2,}(?:_[a-z0-9]+)+\b/g },
  // Wiki links and block references: [[, ]], #^ and block ids such as ^c1 / ^m1 / ^e3.
  { what: 'wiki link or block reference', re: /\[\[|\]\]|#\^|\^[a-z]+\d+/g },
  // Internal claim and sub-question ids: C2, C1-Q1.
  { what: 'claim or sub-question id', re: /\bC\d+-Q\d+\b|\bC\d+\b/g },
  // Numbered vault folders: 20_项目/, 90_配置, 00_团队知识 (followed by `/`, whitespace or the end of the text).
  { what: 'numbered vault folder', re: /\b\d{2}_[^\s/]+(?=\/|\s|$)/g },
];

const isAllowed = (match: string, allow: RegExp[]): boolean =>
  allow.some((re) => new RegExp(re.source, re.flags.replace(/g/g, '')).test(match));

/** Internal names that must never be visible to a user. Returns each distinct offending substring, in order of first appearance. */
export function findInternals(text: string, allow: RegExp[] = []): string[] {
  const hits: { at: number; order: number; value: string }[] = [];
  PATTERNS.forEach(({ re }, order) => {
    for (const m of text.matchAll(re)) hits.push({ at: m.index, order, value: m[0] });
  });
  hits.sort((a, b) => a.at - b.at || a.order - b.order);
  const found: string[] = [];
  for (const hit of hits) {
    if (isAllowed(hit.value, allow)) continue;
    if (!found.includes(hit.value)) found.push(hit.value);
  }
  return found;
}
