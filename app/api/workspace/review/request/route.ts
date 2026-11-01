/** "提交给 Senior": the Junior's button. The only thing that sends a G1 review request (dev plan 3-d). */
import { z } from 'zod';
import { gateSchema } from '@/lib/notes/schema';
import { handleJson, workspacePathSchema } from '@/lib/workplan/http';
import { requestReview } from '@/lib/workplan/review-flow';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  workspacePath: workspacePathSchema,
  gate: gateSchema,
  subject: z.string().min(1),
  summary: z.string().trim().min(1).max(4000),
  focus: z.array(z.string().trim().min(1).max(500)).max(8),
});

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, (input, actor) => requestReview({ vault: getVault(), actor, ...input }));
}
