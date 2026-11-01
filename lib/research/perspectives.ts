/**
 * Perspective coverage of a research plan (D-32): field comparison only, no keyword matching. A perspective of the
 * team list is covered when a claim or a sub-question names it, or skipped when the plan says why it is not looked at.
 * Pure — safe to import from client components.
 */

export interface PerspectiveFields {
  claims: { perspective?: string[]; sub_questions: { perspective?: string[] }[] }[];
  perspectives_skipped?: { perspective: string; reason: string }[];
}

/** Perspectives named by any claim or sub-question. */
export function coveredPerspectives(plan: PerspectiveFields): Set<string> {
  return new Set(plan.claims.flatMap((c) => [...(c.perspective ?? []), ...c.sub_questions.flatMap((q) => q.perspective ?? [])]).map((p) => p.trim()));
}

/** Perspectives of the list that no claim covers and no skip reason explains, in list order. */
export function perspectiveGaps(plan: PerspectiveFields, list: string[]): string[] {
  const covered = coveredPerspectives(plan);
  const skipped = new Set((plan.perspectives_skipped ?? []).filter((s) => s.reason.trim()).map((s) => s.perspective.trim()));
  return list.filter((p) => !covered.has(p) && !skipped.has(p));
}

/** Values the plan uses that are not on the team list (the model must use the list's own words). */
export function unknownPerspectives(plan: PerspectiveFields, list: string[]): string[] {
  if (!list.length) return [];
  const known = new Set(list);
  const used = [...coveredPerspectives(plan), ...(plan.perspectives_skipped ?? []).map((s) => s.perspective.trim())];
  return [...new Set(used.filter((p) => !known.has(p)))];
}
