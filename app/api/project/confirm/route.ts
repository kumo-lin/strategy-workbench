/** D-64 T34: POST — the Senior confirms the decision contract and the issue tree (确定，指派负责人). */
import { z } from 'zod';
import { confirmContract } from '@/lib/project/contract';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { handleJson } from '@/lib/workplan/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ project: z.string().min(1).max(100).regex(/^[^/\\.][^/\\]*$/) });

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, async ({ project }, actor) => {
    await confirmContract(getVault(), actor, project);
    return { ok: true };
  });
}
