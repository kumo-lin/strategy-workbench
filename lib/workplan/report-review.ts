/**
 * A delivered report's 结论 review, as the report page needs it (C1): has it been
 * submitted, sent back, or confirmed by the Senior? Only the Workspace's 结论
 * review notes count, and only the latest one for this report path.
 */
import type { Vault } from '@/lib/vault';
import { listReviews } from './state';

export type ReportReviewState = 'none' | 'open' | 'confirmed' | 'sent_back';

export interface ReportReviewInfo {
  state: ReportReviewState;
  /** The review note this state comes from; null when there is none. */
  reviewPath: string | null;
}

export async function reportReviewOf(vault: Vault, workspacePath: string, reportPath: string): Promise<ReportReviewInfo> {
  let latest: { path: string; result: '通过' | '打回' | null } | null = null;
  // listReviews is oldest first: the last match is the latest.
  for (const review of await listReviews(vault, workspacePath)) {
    if (review.note.gate !== '结论') continue;
    const derived = review.note.derived_from[0];
    if (!derived) continue;
    const resolved = await vault.resolveLink(derived, review.path);
    if (!resolved.ok || resolved.path !== reportPath) continue;
    latest = { path: review.path, result: review.note.result };
  }
  if (!latest) return { state: 'none', reviewPath: null };
  if (latest.result === null) return { state: 'open', reviewPath: latest.path };
  if (latest.result === '通过') return { state: 'confirmed', reviewPath: latest.path };
  return { state: 'sent_back', reviewPath: latest.path };
}
