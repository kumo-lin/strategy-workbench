/**
 * D-64 T21 (step 7 提出建议): every recommendation stands on at least one judgment of the report (a hypothesis H1 or a
 * key question K3, as the report labels them). The report's self-check puts these problems into the existing repair
 * round (T23 wires it to the new report structure).
 */
export interface RecommendationWithRefs {
  title: string;
  how: string;
  /** The judgments it stands on: `H1`, `K3`. */
  refs: string[];
}

export function recommendationProblems(recs: RecommendationWithRefs[], judgmentIds: string[]): string[] {
  const known = new Set(judgmentIds);
  const out: string[] = [];
  for (const r of recs) {
    if (r.refs.length === 0) out.push(`建议「${r.title}」没有引用报告里的判断：每条建议至少写一个它所依据的判断（${judgmentIds.join('、')}）`);
    for (const ref of r.refs) if (!known.has(ref)) out.push(`建议「${r.title}」引用的 ${ref} 不是报告里的判断：只能用 ${judgmentIds.join('、')}`);
  }
  return out;
}
