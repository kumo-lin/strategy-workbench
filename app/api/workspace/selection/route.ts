/** Save what the AI reads in a Workspace (资料选择.json, D63 §2). Only the Workspace owner. */
import { z } from 'zod';
import { selectionEntryPath, writeSelection } from '@/lib/research/selection';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { handleJson, workspacePathSchema } from '@/lib/workplan/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  workspacePath: workspacePathSchema,
  excluded: z.array(selectionEntryPath).max(2000),
  starred: z.array(selectionEntryPath).max(2000),
  web: z.boolean(),
});

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, async ({ workspacePath, ...sel }, actor) => ({
    ok: true,
    selection: await writeSelection(getVault(), actor, workspacePath, sel),
  }));
}
