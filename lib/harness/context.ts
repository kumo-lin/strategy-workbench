/**
 * Build the per-request ToolContext from vault state. The phase is computed
 * HERE, on the server, from the workspace note and the research plan — the
 * client only says which surface (track) it is on.
 *
 * Context assembly for the system prompt (§10.2 context 组装) lives in
 * ./prompts; this file only resolves state.
 */
import path from 'node:path';
import type { Role } from '@/lib/config/roles';
import { getWebToolsClient } from '@/lib/deepseek';
import type { ResearchPlanNote, WorkspaceNote } from '@/lib/notes/schema';
import { readSelection, selectionView } from '@/lib/research/selection';
import { taskContextReadIn } from './tools/task-context';
import type { Vault } from '@/lib/vault';
import { PRE_G1_STAGES, resolvePhase, type Track } from './phases';
import type { ToolContext } from './types';

/** Latest `计划 vN.md` in a research folder, or null. */
export async function latestPlanPath(vault: Vault, researchDir: string): Promise<string | null> {
  let best: { n: number; path: string } | null = null;
  try {
    for (const e of await vault.list(researchDir)) {
      const m = /^计划 v(\d+)\.md$/.exec(e.name);
      if (e.kind === 'file' && m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), path: e.path };
    }
  } catch {
    return null; // folder not created yet
  }
  return best?.path ?? null;
}

export interface BuildContextInput {
  vault: Vault;
  role: Role;
  /** `20_项目/<项目>/<Workspace>` */
  workspacePath: string;
  track: Track;
  /** Required when track = research: `${workspacePath}/调查/<调查名>` */
  researchDir?: string;
  now?: () => Date;
  abortSignal?: AbortSignal;
}

/**
 * D-64 T33: a new project's framing (phase project_framing) — there is no Workspace yet. The project folder stands in
 * for one: its 日志.md takes the log, the framing state goes to 拆题/ there, and `workspace` names the person framing.
 */
export async function buildProjectContext(input: { vault: Vault; role: Role; projectPath: string; now?: () => Date; abortSignal?: AbortSignal }): Promise<ToolContext> {
  const { vault, role, projectPath } = input;
  if (!/^20_项目\/[^/]+$/.test(projectPath) || !(await vault.exists(`${projectPath}/项目.md`))) throw new Error(`not a project: ${projectPath}`);
  const now = input.now ?? (() => new Date());
  const day = now().toISOString().slice(0, 10);
  const logPath = `${projectPath}/日志.md`;
  const phase = 'project_framing' as const;
  const workspace = {
    id: 'project-framing',
    type: 'workspace',
    status: '进行中',
    created: day,
    updated: day,
    author: role.name,
    derived_from: [],
    relates_to: [],
    owner: role.name,
    reviewer: role.name,
    stage: '拆题中',
    flags: [],
    depends_on: [],
  } as unknown as WorkspaceNote;
  return {
    phase,
    vault,
    role,
    projectPath,
    workspacePath: projectPath,
    workspace,
    logPath,
    exploratory: false,
    taskContextRead: await taskContextReadIn(vault, logPath, { phase }),
    now,
    webTools: () => getWebToolsClient(vault),
    abortSignal: input.abortSignal,
  };
}

export async function buildToolContext(input: BuildContextInput): Promise<ToolContext> {
  if (input.track === 'project') return buildProjectContext({ ...input, projectPath: input.workspacePath });
  const { vault, workspacePath } = input;
  const ws = await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace');
  const projectPath = path.posix.dirname(workspacePath);
  const logPath = `${workspacePath}/日志.md`;

  let research: ToolContext['research'];
  if (input.track === 'research') {
    if (!input.researchDir || !input.researchDir.startsWith(`${workspacePath}/调查/`)) {
      throw new Error('research track needs researchDir inside the workspace 调查/ folder');
    }
    const planPath = await latestPlanPath(vault, input.researchDir);
    const plan = planPath ? ((await vault.read(planPath)).note as ResearchPlanNote | null) : null;
    research = { dir: input.researchDir, planPath, plan: plan?.type === 'research_plan' ? plan : null };
  }

  const phase =
    input.track === 'files'
      ? ('files_chat' as const)
      : input.track === 'research'
      ? resolvePhase({ track: 'research', plan: research?.plan ?? null })
      : resolvePhase({ track: 'workspace', stage: ws.note.stage });

  // D63 §2: the one place the Workspace's file selection applies — every tool and the research run read through this view
  const selection = await readSelection(vault, workspacePath);
  return {
    phase,
    vault: selectionView(vault, selection),
    selection,
    taskContextRead: await taskContextReadIn(vault, logPath, { phase, research }),
    role: input.role,
    projectPath,
    workspacePath,
    workspace: ws.note,
    logPath,
    research,
    exploratory: PRE_G1_STAGES.includes(ws.note.stage),
    now: input.now ?? (() => new Date()),
    webTools: () => getWebToolsClient(vault),
    abortSignal: input.abortSignal,
  };
}
