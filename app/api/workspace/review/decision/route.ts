/** 通过 / 打回: fires `review.approve` / `review.reject`. The reviewer check is applyApprovalEvent's, on the server. */
import { z } from 'zod';
import { handleJson } from '@/lib/workplan/http';
import { decideReview } from '@/lib/workplan/review-flow';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reviewPath: z.string().regex(/^20_项目\/[^/]+\/[^/]+\/review\/[^/]+\.md$/),
  decision: z.enum(['approve', 'reject']),
});

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, (input, actor) => decideReview({ vault: getVault(), actor, ...input }));
}
