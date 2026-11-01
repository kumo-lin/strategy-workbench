/**
 * The single agent endpoint (OWNER: M0). Used by the workspace chat (M1) and
 * Deep Research (M2) with useChat + DefaultChatTransport({ api: '/api/agent', body }).
 *
 * The client says WHERE it is (workspace, track, research folder). The server
 * decides the PHASE from vault state and passes only that phase's tools.
 */
import { convertToModelMessages, type UIMessage } from 'ai';
import { buildToolContext, runAgent } from '@/lib/harness';
import { agentRequestSchema, type AgentMessageMetadata } from '@/lib/harness/agent-request';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// compose_workplan runs inside a chat request and takes 3–6 minutes (three splits votes, the tree, the review)
export const maxDuration = 600;

export async function POST(req: Request) {
  const parsed = agentRequestSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const { messages, workspacePath, track, researchDir } = parsed.data;

  const ctx = await buildToolContext({
    vault: getVault(),
    role: await getCurrentRole(),
    workspacePath,
    track,
    researchDir,
    abortSignal: req.signal,
  });
  const result = await runAgent({ ctx, messages: await convertToModelMessages(messages as UIMessage[]) });
  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }): AgentMessageMetadata | undefined => (part.type === 'start' ? { phase: ctx.phase } : undefined),
  });
}
