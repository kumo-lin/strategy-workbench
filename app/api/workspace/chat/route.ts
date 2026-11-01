/**
 * The Workspace chat log, stored in the vault per role (`<workspacePath>/对话/<role id>.json`).
 * GET returns it for the current role (`null` when there is none); PUT saves it. The file name always comes
 * from the session role, never from the request: a role can only write its own log.
 */
import { z } from 'zod';
import { ChatLogTooLarge, readChatLog, writeChatLog } from '@/lib/workplan/chat-log';
import { errorResponse, workspacePathSchema } from '@/lib/workplan/http';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  workspacePath: workspacePathSchema,
  messages: z.array(z.unknown()).max(2000),
});

export async function GET(req: Request) {
  try {
    const workspacePath = workspacePathSchema.parse(new URL(req.url).searchParams.get('workspacePath') ?? '');
    const role = await getCurrentRole();
    return Response.json({ messages: await readChatLog(getVault(), workspacePath, role.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    const input = bodySchema.parse(await req.json());
    const role = await getCurrentRole();
    const { bytes } = await writeChatLog(getVault(), input.workspacePath, role.id, input.messages);
    return Response.json({ ok: true, bytes });
  } catch (e) {
    if (e instanceof ChatLogTooLarge) return Response.json({ error: 'too_large', message: e.message }, { status: 413 });
    return errorResponse(e);
  }
}
