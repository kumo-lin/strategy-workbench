/**
 * D-64 T25: interviews put into the chat (.md / .txt, text read in the browser) are saved as 访谈/<名字>.md; with
 * `researchDir` the follow-up runs on them (only the judgments they touch are judged again). Only the Workspace owner.
 */
import path from 'node:path';
import { z } from 'zod';
import { buildToolContext } from '@/lib/harness';
import { FollowUpDenied } from '@/lib/research/followup';
import { executeInterviewFollowUp, INTERVIEW_EXTENSIONS, saveInterview } from '@/lib/research/interview-followup';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { errorResponse, workspacePathSchema } from '@/lib/workplan/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  workspacePath: workspacePathSchema,
  simulated: z.boolean(),
  files: z.array(z.object({ filename: z.string().min(1).max(200), content: z.string().max(200_000) })).min(1).max(10),
  researchDir: z.string().min(1).max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const bad = body.files.filter((f) => !(INTERVIEW_EXTENSIONS as readonly string[]).includes(path.extname(f.filename).toLowerCase()));
    if (bad.length) return Response.json({ error: 'unsupported_media_type', message: `只接受 .md 和 .txt：${bad.map((f) => f.filename).join('、')}` }, { status: 415 });
    const vault = getVault();
    const actor = await getCurrentRole();
    const saved: string[] = [];
    for (const f of body.files) saved.push((await saveInterview(vault, actor, body.workspacePath, { name: f.filename, content: f.content, simulated: body.simulated })).path);
    if (!body.researchDir) return Response.json({ ok: true, saved });
    const ctx = await buildToolContext({ vault, role: actor, workspacePath: body.workspacePath, track: 'research', researchDir: body.researchDir });
    return Response.json({ ok: true, saved, ...(await executeInterviewFollowUp({ ctx, interviews: saved })) });
  } catch (e) {
    if (e instanceof FollowUpDenied) return Response.json({ error: 'conflict', message: e.message }, { status: 409 });
    return errorResponse(e);
  }
}
