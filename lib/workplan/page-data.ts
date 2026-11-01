/** Server-side helpers shared by the Workspace pages (params decoding, role, vault, phase). */
import { buildToolContext, PHASE_LABELS, toolNamesForPhase } from '@/lib/harness';
import type { Role } from '@/lib/config/roles';
import { getCurrentRole } from '@/lib/session/role';
import { getVault, type Vault } from '@/lib/vault';

export interface WorkspaceParams {
  project: string;
  workspace: string;
}

export interface WorkspaceLocation {
  project: string;
  workspace: string;
  workspacePath: string;
  /** `/workspace/<项目>/<Workspace>`, URL-encoded. */
  basePath: string;
  vault: Vault;
  role: Role;
}

/** Route params arrive percent-encoded (CONTRACTS §5.2). */
export async function locateWorkspace(params: Promise<WorkspaceParams>): Promise<WorkspaceLocation> {
  const p = await params;
  const project = decodeURIComponent(p.project);
  const workspace = decodeURIComponent(p.workspace);
  return {
    project,
    workspace,
    workspacePath: `20_项目/${project}/${workspace}`,
    basePath: `/workspace/${encodeURIComponent(project)}/${encodeURIComponent(workspace)}`,
    vault: getVault(),
    role: await getCurrentRole(),
  };
}

/** What the AI may do in this Workspace right now, for the stage bar. */
export async function workspacePhase(loc: WorkspaceLocation) {
  const ctx = await buildToolContext({ vault: loc.vault, role: loc.role, workspacePath: loc.workspacePath, track: 'workspace' });
  return { ctx, phase: { label: PHASE_LABELS[ctx.phase], tools: toolNamesForPhase(ctx.phase, { web: ctx.selection?.web }) as string[] } };
}
