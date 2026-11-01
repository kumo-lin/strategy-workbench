/** Log the human's answer to an ask_user card (the question itself is logged by the agent runner). */
import { z } from 'zod';
import { handleJson, workspacePathSchema } from '@/lib/workplan/http';
import { recordAnswer } from '@/lib/workplan/review-flow';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  workspacePath: workspacePathSchema,
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(4000),
  /** true: the shell sent the card back (options written into the question text); logged as the AI's row. */
  rejected: z.boolean().optional(),
});

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, async (input, actor) => {
    await recordAnswer({ vault: getVault(), actor, ...input });
    return { ok: true };
  });
}
