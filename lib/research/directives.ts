/**
 * "怎么回应高层指示" (D-28): the recommendation says whether the findings support, revise or overturn the direction
 * the investigation started from — the exec directive of the starting meeting (2026-10-16 周会 ^m1 / ^m3) and, where
 * they bear on it, the decisions — quoting their own blocks. The model is shown them under keys ([M1], [W1]); code
 * turns a key into a footnote that holds the verbatim block and its link, so check_citations verifies it.
 */
import type { Recommendation } from './schemas';
import type { Footnotes } from './report';
import type { OriginItem } from './origin';

export interface DirectiveRef {
  /** `M1` for a meeting block (the directive), `W1` for a decision. */
  key: string;
  kind: '会议' | '决定';
  name: string;
  /** `[[path#^m1]]` / `[[path]]`. */
  link: string;
  /** Verbatim excerpt of the block / of the decision. */
  quote: string;
}

/** The starting meeting's blocks and the decisions the plan reaches, keyed for the model (only those with words to quote). */
export function directiveRefs(items: OriginItem[]): DirectiveRef[] {
  const out: DirectiveRef[] = [];
  let m = 0;
  let w = 0;
  for (const i of items) {
    if (!i.quote) continue;
    if (i.kind === '会议') out.push({ key: `M${++m}`, kind: '会议', name: i.name, link: i.link, quote: i.quote });
    else if (i.kind === '决定') out.push({ key: `W${++w}`, kind: '决定', name: i.name, link: i.link, quote: i.quote });
  }
  return out;
}

const KEY = /[\[【]\s*((?:[MW]\d+[\s、,，]*)+)[\]】]/g;

/** `[M1]` / `[M1、W2]` → footnote markers whose definitions quote the block (or, without footnotes, the inline citation). */
export function expandDirectiveKeys(text: string, refs: DirectiveRef[], notes?: Footnotes): string {
  if (!refs.length) return text;
  return text.replace(KEY, (whole, group: string) => {
    const keys = group.match(/[MW]\d+/g) ?? [];
    const parts = keys.flatMap((k) => {
      const r = refs.find((x) => x.key === k);
      if (!r) return [];
      // no note name inside the parentheses: names like "高层周会（模拟）" would break the quote-before-link match
      const def = `“${r.quote}”（${r.kind === '会议' ? '高层指示' : '决定'}）${r.link}`;
      return [notes ? notes.citeRaw(r.link, def) : def];
    });
    return parts.length ? parts.join(notes ? '' : ' ') : whole;
  });
}

/** What the directive row lacks (checked like the other parts of the recommendation). */
export function directiveGaps(rec: Recommendation | undefined, refs: DirectiveRef[]): string[] {
  if (!rec || !refs.some((r) => r.kind === '会议')) return [];
  const text = rec.directive_response.trim();
  if (!text) return ['没有写“怎么回应高层指示”：要说清调查结果对高层指示是支持、修正还是推翻'];
  const gaps: string[] = [];
  const cited = new Set((text.match(KEY) ?? []).flatMap((g) => g.match(/[MW]\d+/g) ?? []));
  if (!refs.some((r) => r.kind === '会议' && cited.has(r.key))) gaps.push('“怎么回应高层指示”没有引用高层指示的原块（写成 [M1] 这样的编号）');
  if (!/支持|修正|推翻/.test(text)) gaps.push('“怎么回应高层指示”没有说清是支持、修正还是推翻');
  return gaps;
}
