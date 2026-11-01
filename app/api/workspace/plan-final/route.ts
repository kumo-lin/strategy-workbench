/** D-64 T35: POST — the owner says the research plan is final (研究计划定了，往下做调查计划 →). */
import { z } from 'zod';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { handleJson, workspacePathSchema } from '@/lib/workplan/http';
import { markPlanFinal } from '@/lib/workplan/plan-final';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handleJson(req, z.object({ workspacePath: workspacePathSchema }), getCurrentRole, async ({ workspacePath }, actor) => {
    await markPlanFinal(getVault(), actor, workspacePath);
    return { ok: true };
  });
}
