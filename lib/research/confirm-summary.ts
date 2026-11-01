/**
 * D-64 T41 (ui-4e): what the Senior reads next to the decision — the report's So what and its (at most three) reasons,
 * read from the report as written. An older report has no So what: its Summary's first paragraph stands in. Pure.
 */
export interface ConfirmSummary {
  soWhat: string;
  reasons: string[];
}

const noMarks = (s: string) => s.replace(/\[\^\d+[!~]*\]/g, '').trim();

function section(body: string, heading: string): string[] | null {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

const firstParagraph = (lines: string[]) => noMarks(lines.join('\n').trim().split(/\n\s*\n/)[0] ?? '');

export function confirmSummaryOf(body: string): ConfirmSummary {
  const soWhat = section(body, 'So what') ?? section(body, 'Summary') ?? [];
  const reasons = (section(body, '为什么（三条支撑）') ?? []).flatMap((l) => /^\d+\.\s+(.+)$/.exec(l)?.[1] ?? []).map(noMarks).slice(0, 3);
  return { soWhat: firstParagraph(soWhat), reasons };
}

export interface ReasonDetail {
  title: string;
  basis: { kind: string; text: string }[];
}

/** 复核 P3 (ui-4d): the three reasons with what each rests on (事实 / 推断 / 访谈支持), as the report writes them. Pure. */
export function reasonDetailsOf(body: string): ReasonDetail[] {
  const out: ReasonDetail[] = [];
  for (const l of section(body, '为什么（三条支撑）') ?? []) {
    const title = /^\d+\.\s+(.+)$/.exec(l)?.[1];
    if (title) {
      out.push({ title: noMarks(title), basis: [] });
      continue;
    }
    const basis = /^\s+-\s*(事实|推断|访谈支持)：(.+)$/.exec(l);
    if (basis && out.length) out[out.length - 1].basis.push({ kind: basis[1], text: noMarks(basis[2]).replace(/\[\[[^\]]*\]\]/g, '') });
  }
  return out.slice(0, 3);
}
