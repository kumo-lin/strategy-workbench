/** POST /api/research/approve — the owner's click. The ONLY thing that unlocks the research tools. */
import { z } from 'zod';
import { ApprovalDenied, applyApprovalEvent } from '@/lib/harness';
import { BadResearchPath, assertResearchDir, latestVersion } from '@/lib/research/folders';
import { planApprovalProblems } from '@/lib/research/plan-checks';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ workspacePath: z.string(), researchDir: z.string(), plan: z.string().optional() });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const vault = getVault();
  try {
    assertResearchDir(parsed.data.workspacePath, parsed.data.researchDir);
    const latest = await latestVersion(vault, parsed.data.researchDir, '计划');
    if (!latest) return Response.json({ error: '还没有调查计划' }, { status: 409 });
    // The approval is for the version the owner was looking at; if a newer one exists, refuse.
    if (parsed.data.plan && parsed.data.plan !== latest.path) return Response.json({ error: '计划已经有更新的版本，请刷新后再批准' }, { status: 409 });
    // D-39: a question-tree plan that fails its checks is not approved (the page lists why)
    const problems = await planApprovalProblems(vault, latest.path);
    if (problems.length) return Response.json({ error: `计划的问题树还有 ${problems.length} 处要改，不能批准：${problems.join('；')}`, problems }, { status: 409 });
    const res = await applyApprovalEvent(
      vault,
      { type: 'research_plan.approve', actor: await getCurrentRole(), workspace: `${parsed.data.workspacePath}/workspace.md`, plan: latest.path },
      { logPath: `${parsed.data.workspacePath}/日志.md`, reason: '负责人批准调查计划，调查工具解锁' },
    );
    return Response.json({ ok: true, summary: res.summary, plan: latest.path });
  } catch (e) {
    if (e instanceof ApprovalDenied) return Response.json({ error: e.message }, { status: 403 });
    if (e instanceof BadResearchPath) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
