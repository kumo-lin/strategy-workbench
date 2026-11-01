/**
 * Which tools the model gets in a workplan co-creation request (D-56 ③ v2): the code decides, from the state file.
 *
 *   framing / confirm  → ask_user, frame_topic          (nothing that writes; the model can only ask and record)
 *   ready              → ask_user, frame_topic, compose_workplan
 *   anything else      → the phase's usual tools without the two compose tools
 *
 * The gate returns a rule (`only` / `without`) and the runner applies it to the tools it built: this file must not
 * import the tool registry, which imports the compose tools, which import this file.
 *
 * "Co-creation" = stage 拆题中, not a rework, and no workplan yet (or a redo is pending): the first draft of a version.
 * Read again before every step (the runner's prepareStep): the click on the confirm card starts a request whose first
 * step records the confirmation (frame_topic, confirmed: true), and the next step can already compose.
 */
import type { ToolName } from '@/lib/harness/phases';
import type { ToolContext } from '@/lib/harness/types';
import { isRedoPending } from '../redo';
import { listWorkplans } from '../state';
import { isFirstCocreate } from './cocreate';
import { frameStatus } from './frame';
import { readState } from './state';

export const COMPOSE_TOOLS: readonly ToolName[] = ['frame_topic', 'compose_workplan'];
/** Every tool a first co-creation can use at some step; the gate narrows it step by step. */
export const COMPOSE_PHASE_TOOLS: readonly ToolName[] = ['ask_user', ...COMPOSE_TOOLS];

/** Is this request the co-creation of a new workplan version? */
export async function isCocreateRequest(ctx: ToolContext): Promise<boolean> {
  if (ctx.phase !== 'workplan') return false;
  const workplans = await listWorkplans(ctx.vault, ctx.workspacePath);
  return isFirstCocreate(ctx.workspace, workplans.length, isRedoPending(await ctx.vault.readLog(ctx.logPath)));
}

/** `reason`: why compose_workplan is held back (D-64 T21: the decision contract is not confirmed yet). */
export type ToolRule = { only: readonly ToolName[]; reason?: string } | { without: readonly ToolName[] };

export const CONTRACT_UNCONFIRMED = '决策契约要先由 Senior 确认，确认以后才能拆题';

/** D-64 T21 (step 1): the project's decision contract, when it has one, must be confirmed before composing. No contract (an older project): no gate. */
export async function contractBlocksCompose(ctx: Pick<ToolContext, 'vault' | 'projectPath'>): Promise<boolean> {
  const p = `${ctx.projectPath}/决策契约.md`;
  if (!(await ctx.vault.exists(p))) return false;
  return (await ctx.vault.read(p)).data.status !== '已确认';
}

/** How the workplan phase's tools are cut down for this request, or null when the phase's usual set applies unchanged. */
export async function composeToolGate(ctx: ToolContext): Promise<ToolRule | null> {
  if (ctx.phase !== 'workplan') return null;
  if (!(await isCocreateRequest(ctx))) return { without: COMPOSE_TOOLS };
  const stage = frameStatus(await readState(ctx.vault, ctx.workspacePath)).stage;
  if (stage === 'ready' && (await contractBlocksCompose(ctx))) return { only: ['ask_user', 'frame_topic'], reason: CONTRACT_UNCONFIRMED };
  return { only: stage === 'ready' ? ['ask_user', 'frame_topic', 'compose_workplan'] : ['ask_user', 'frame_topic'] };
}
