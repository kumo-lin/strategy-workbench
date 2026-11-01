/** POST /api/decision/draft — the Senior's "起草决定" on a delivered report: AI drafts, `propose_decision` writes (status 推断). */
import { z } from 'zod';
import { buildToolContext } from '@/lib/harness';
import { draftDecision } from '@/lib/decisions/draft';
import { loadDecisionCard } from '@/lib/decisions/review';
import { assertResearchDir } from '@/lib/research/folders';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { errorResponse } from '@/lib/workplan/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({ workspacePath: z.string(), researchDir: z.string(), reportPath: z.string() });

export async function POST(req: Request) {
  try {
    const { workspacePath, researchDir, reportPath } = bodySchema.parse(await req.json());
    assertResearchDir(workspacePath, researchDir);
    if (!reportPath.startsWith(`${researchDir}/`)) return Response.json({ error: 'invalid_request', message: '报告不在这次调查里' }, { status: 400 });
    const ctx = await buildToolContext({ vault: getVault(), role: await getCurrentRole(), workspacePath, track: 'research', researchDir, abortSignal: req.signal });
    const drafted = await draftDecision({ ctx, reportPath, signal: req.signal });
    // The card itself, so the page shows it without refetching (router.refresh() was not reliable).
    return Response.json({ ...drafted, card: await loadDecisionCard(ctx.vault, drafted.path) });
  } catch (e) {
    return errorResponse(e);
  }
}
