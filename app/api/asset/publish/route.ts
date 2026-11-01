/** POST /api/asset/publish — a Senior publishes a confirmed report or decision as a company asset (D-64 T18). */
import { z } from 'zod';
import { publishAsset } from '@/lib/assets/publish';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { handleJson } from '@/lib/workplan/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ path: z.string().regex(/^20_项目\/.+\.md$/) });

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, async ({ path }, actor) => ({ ok: true, ...(await publishAsset(getVault(), actor, path)) }));
}
