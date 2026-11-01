/** POST /api/research/new — create the folder for a new investigation (名字由用户起). */
import { z } from 'zod';
import { BadResearchPath, createResearchDir } from '@/lib/research/folders';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ workspacePath: z.string(), name: z.string() });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const vault = getVault();
  const role = await getCurrentRole();
  try {
    const ws = await vault.readTyped(`${parsed.data.workspacePath}/workspace.md`, 'workspace');
    if (role.name !== ws.note.owner) return Response.json({ error: `只有 Workspace 的负责人（${ws.note.owner}）可以新建调查` }, { status: 403 });
    const researchDir = await createResearchDir(vault, parsed.data.workspacePath, parsed.data.name);
    return Response.json({ researchDir });
  } catch (e) {
    if (e instanceof BadResearchPath) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
