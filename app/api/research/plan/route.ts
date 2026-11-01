/** POST /api/research/plan — the owner saves an edited plan as a new version (unapproved). */
import { BadResearchPath, assertResearchDir } from '@/lib/research/folders';
import { PlanSaveDenied, savePlanVersion } from '@/lib/research/plan-save';
import { planSaveRequestSchema } from '@/lib/research/plan-request';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const parsed = planSaveRequestSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  try {
    assertResearchDir(parsed.data.workspacePath, parsed.data.researchDir);
    const saved = await savePlanVersion({ vault: getVault(), role: await getCurrentRole(), ...parsed.data });
    return Response.json({ ok: true, name: saved.name, path: saved.path });
  } catch (e) {
    const status = e instanceof PlanSaveDenied ? 403 : e instanceof BadResearchPath ? 400 : 500;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
