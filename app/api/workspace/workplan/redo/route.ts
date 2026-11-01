/** "重新做一版 workplan": the Junior asks for a new version; the old one stays (M1 task 4b). */
import { z } from 'zod';
import { handleJson, workspacePathSchema } from '@/lib/workplan/http';
import { requestRedo } from '@/lib/workplan/redo';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ workspacePath: workspacePathSchema });

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, (input, actor) =>
    requestRedo({ vault: getVault(), actor, workspacePath: input.workspacePath }),
  );
}
