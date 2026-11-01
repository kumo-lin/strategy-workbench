/** Request body of POST /api/agent (CONTRACT, frozen after M0). */
import { z } from 'zod';

export const agentRequestSchema = z.object({
  messages: z.array(z.unknown()),
  /** `20_项目/<项目>/<Workspace>`; for track = project (D-64 T33), the project folder `20_项目/<项目>` */
  workspacePath: z.string().startsWith('20_项目/'),
  track: z.enum(['workspace', 'research', 'project', 'files']),
  /** Required for track = research: `${workspacePath}/调查/<调查名>` */
  researchDir: z.string().optional(),
});
export type AgentRequestBody = Omit<z.infer<typeof agentRequestSchema>, 'messages'>;

/** `message.metadata` on assistant messages streamed by /api/agent. */
export interface AgentMessageMetadata {
  phase?: import('./phases').Phase;
  continuation?: boolean;
}
