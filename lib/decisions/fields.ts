/** D-64 T17/T41: a decision's three parts as the Senior edits them. Pure, so the page's fields use it too. */

/** The three parts the Senior edits (ui-4e): the 决定, 理由 and 适用边界 sections of the body, as markdown. */
export interface DecisionFields {
  decision: string;
  reason: string;
  scope: string;
}

const FIELD_HEADINGS: Record<keyof DecisionFields, string> = { decision: '## 决定', reason: '## 理由', scope: '## 适用边界' };

/** One `## ` section's text (trimmed), or '' when the body has no such section. */
function sectionOf(body: string, heading: string): string {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) return '';
  const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n').trim();
}

export function decisionFields(body: string): DecisionFields {
  return { decision: sectionOf(body, FIELD_HEADINGS.decision), reason: sectionOf(body, FIELD_HEADINGS.reason), scope: sectionOf(body, FIELD_HEADINGS.scope) };
}

/** The body with each field written back into its section; a missing 适用边界 section goes right after 理由. */
export function withFields(body: string, fields: DecisionFields): string {
  let lines = body.split('\n');
  for (const key of ['decision', 'reason', 'scope'] as const) {
    const heading = FIELD_HEADINGS[key];
    let at = lines.findIndex((l) => l.trim() === heading);
    if (at < 0) {
      const after = lines.findIndex((l) => l.trim() === FIELD_HEADINGS.reason);
      const next = after < 0 ? -1 : lines.findIndex((l, i) => i > after && /^## /.test(l));
      at = next < 0 ? lines.length : next;
      lines = [...lines.slice(0, at), heading, '', ...lines.slice(at)];
    }
    const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
    lines = [...lines.slice(0, at + 1), '', fields[key].trim(), '', ...(end < 0 ? [] : lines.slice(end))];
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
