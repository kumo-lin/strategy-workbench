/** Display helpers for the decision card. The note on disk keeps raw wikilinks; only the preview is rewritten. */

/** `[[资料甲#^c1]]` → `〔资料甲 · c1〕`; `[[20_项目/x/报告 v1|报告 v1]]` → `报告 v1`. */
export function displayWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const [target, alias] = inner.split('|');
    const block = /#\^([A-Za-z0-9-]+)$/.exec(target)?.[1];
    const name = (alias ?? target.replace(/#.*$/, '').split('/').pop() ?? target).trim();
    return block ? `〔${name.replace(/#.*$/, '')} · ${block}〕` : name;
  });
}

/** D-64 T41: a plain link (no block) as the Senior sees it in an editable field (D10: no `[[` on the screen). */
function fieldToken(link: string): string {
  const [target, alias] = link.slice(2, -2).split('|');
  const name = (alias ?? target.replace(/#.*$/, '').split('/').pop() ?? target).trim();
  return `〔${name}〕`;
}

/**
 * 复核 P5: one citation of a decision — the quote, its grade and the block link, with the space before it — as one unit.
 * The Senior reads 〔1〕 in the text and the source under the field; the unit itself is never edited, so the check
 * that every citation is one the report made (checkDecisionBody) still holds after any rewording.
 */
// spaces and tabs only before it: a citation that opens a field must not take the line break with it (review)
const CITATION = /[ \t]*(?:“[^”\n]*”(?:（[^）\n]*）)?[ \t]*)?\[\[[^\]\n]*#\^[^\]\n]*\]\]/g;
const LABEL = /(^|\n)(\s*-\s*)\*\*(事实|推断|访谈支持)\*\*：/g;

export interface FieldCitation {
  n: number;
  name: string;
  quote: string | null;
  grade: string | null;
}

const unitsOf = (original: string) => [...new Set(original.match(CITATION) ?? [])];

/** The citations of a decision, numbered in the order they first appear in it. */
export function citationsOf(original: string): FieldCitation[] {
  return unitsOf(original).map((u, i) => {
    const link = /\[\[([^\]|#]+)/.exec(u)?.[1] ?? '';
    // the grade is the bracket right before the link (a quote may hold brackets of its own)
    return { n: i + 1, name: link.split('/').pop()?.trim() ?? link, quote: /“([^”]*)”/.exec(u)?.[1] ?? null, grade: /（([^）]*)）[ \t]*\[\[/.exec(u)?.[1] ?? null };
  });
}

/** A field's text for editing: each citation as 〔n〕, each plain link as 〔名字〕, the 事实/推断 labels without markdown. */
export function toFieldText(raw: string, original: string = raw): string {
  let out = raw;
  // longest first: a bare link cited elsewhere must not cut into a full citation of the same block (review)
  const units = unitsOf(original).map((u, i) => ({ u, n: i + 1 })).sort((a, b) => b.u.length - a.u.length);
  for (const { u, n } of units) out = out.split(u).join(` 〔${n}〕`);
  return out.replace(/(^|\n) 〔/g, '$1〔').replace(/\[\[[^\]]+\]\]/g, fieldToken).replace(LABEL, '$1$2$3：');
}

/** What the Senior typed, with each 〔n〕 and 〔名字〕 turned back into the citation or link of `original` it stands for. */
export function fromFieldText(shown: string, original: string): string {
  let out = shown;
  unitsOf(original).forEach((u, i) => (out = out.replace(new RegExp(`[ \\t]*〔${i + 1}〕`, 'g'), () => u)));
  for (const link of new Set(original.match(/\[\[[^\]]+\]\]/g) ?? [])) if (!link.includes('#^')) out = out.split(fieldToken(link)).join(link);
  const labels = new Set([...original.matchAll(LABEL)].map((m) => m[3]));
  return out.replace(/(^|\n)(\s*-\s*)(事实|推断|访谈支持)：/g, (m, a: string, b: string, l: string) => (labels.has(l) ? `${a}${b}**${l}**：` : m));
}
