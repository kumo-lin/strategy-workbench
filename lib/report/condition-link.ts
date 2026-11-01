/**
 * "（见 Q2-1 ②）" (D-48 round 5 A): where the recommendation and the one-line answer lean on a plan condition, the
 * report points at it in its card instead of carrying its footnotes. The page links it to that ①②③ line.
 */

/** "（见 Q2-1 ②…）" in a rendered report: what the page makes a link. */
export const CONDITION_LINK = /（见 (Q\d+(?:-\d+)?) ([①-⑳])(，待验证)?）/g;

/** The anchor of a card's ①②③ line, by the sub-question it answers ("Q2-1", "②"). */
export const conditionAnchor = (qid: string, label: string) => `cond-${qid}-${label}`;
