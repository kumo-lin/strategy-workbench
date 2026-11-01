/** Leave a comment on a pending review (one line, block id ^mN). */
import { z } from 'zod';
import { handleJson } from '@/lib/workplan/http';
import { addComment } from '@/lib/workplan/review-flow';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reviewPath: z.string().regex(/^20_项目\/[^/]+\/[^/]+\/review\/[^/]+\.md$/),
  text: z.string().trim().min(1).max(2000),
  target: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, (input, actor) => addComment({ vault: getVault(), actor, ...input }));
}
