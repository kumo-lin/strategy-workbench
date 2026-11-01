/**
 * D-24: a person's corrections to a system-written report, recorded in its frontmatter (`human_edits`: one item per
 * edit, with `kind`, `where`, `before`, `after`, `date`, `basis`, `content_changed`). Pages show them next to the
 * report's name so nobody mistakes the text for untouched system output. A report without the field shows nothing.
 */
export const HUMAN_EDITS_KEY = 'human_edits';

export interface HumanEdit {
  kind: string;
  where: string;
  before: string;
  after: string;
  /** Only an explicit `content_changed: false` counts as a pure typo fix. */
  contentChanged: boolean;
}

export function readHumanEdits(data: Record<string, unknown>): HumanEdit[] {
  const v = data[HUMAN_EDITS_KEY];
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const r = e as Record<string, unknown>;
    if (typeof r.before !== 'string' || typeof r.after !== 'string') return [];
    const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
    return [{ kind: str('kind'), where: str('where'), before: r.before, after: r.after, contentChanged: r.content_changed !== false }];
  });
}

/** "人工修正 N 处错别字，内容未改"; "人工修正 N 处（含内容改动）" when any edit changed content; null when there are none. */
export function humanEditsLine(edits: HumanEdit[]): string | null {
  if (edits.length === 0) return null;
  return edits.some((e) => e.contentChanged) ? `人工修正 ${edits.length} 处（含内容改动）` : `人工修正 ${edits.length} 处错别字，内容未改`;
}
