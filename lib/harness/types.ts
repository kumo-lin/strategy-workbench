/**
 * Tool interface (PRD §10.2): name + zod parameters + execute. Every call is
 * logged by the registry wrapper, never by the tool itself.
 *
 * CONTRACT (frozen after M0).
 */
import type { z } from 'zod';
import type { Role } from '@/lib/config/roles';
import type { WebToolsClient } from '@/lib/deepseek/web-tools';
import type { ResearchPlanNote, WorkspaceNote } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import type { Selection } from '@/lib/research/selection';
import type { Phase, ToolName } from './phases';

/** Everything a tool may touch. Built per request by `buildToolContext` (./context.ts). */
export interface ToolContext {
  phase: Phase;
  vault: Vault;
  /** The human whose session this is. The AI acts on their behalf but never as them. */
  role: Role;
  /** `20_项目/<项目名>` */
  projectPath: string;
  /** `20_项目/<项目名>/<Workspace 名>` */
  workspacePath: string;
  workspace: WorkspaceNote;
  /** `${workspacePath}/日志.md` — every tool call is appended here. */
  logPath: string;
  /** Set on the research track. */
  research?: {
    /** `${workspacePath}/调查/<调查名>` */
    dir: string;
    /** Latest `计划 vN.md`, or null before the first draft. */
    planPath: string | null;
    plan: ResearchPlanNote | null;
  };
  /** True before G1 (D-8): research plans / reports written now are `exploratory`. */
  exploratory: boolean;
  now: () => Date;
  /** The Workspace's 资料选择.json (D63 §2); `vault` above is already filtered by it. Absent = the default. */
  selection?: Selection;
  /**
   * D-64 T20: has the task context been read in this phase (read_task_context)? false = only that tool is offered.
   * Absent (a context built by hand) = no such gate.
   */
  taskContextRead?: boolean;
  /** Lazily created DeepSeek Search/Fetch client (M2). */
  webTools: () => Promise<WebToolsClient>;
  abortSignal?: AbortSignal;
}

export interface ToolSpec<P extends z.ZodObject = z.ZodObject, R = unknown> {
  name: ToolName;
  /** Shown to the model. */
  description: string;
  /** Model-facing input schema. The registry adds an optional `why` field for the log. */
  parameters: P;
  /**
   * Server-side executor. Omit for client tools (ask_user): the UI renders
   * the call and the user's answer comes back as the tool result.
   */
  execute?: (args: z.infer<P>, ctx: ToolContext) => Promise<R>;
  /** One line for the log's "改了什么" column. Defaults to the JSON args. */
  summarize?: (args: z.infer<P>, result: R | undefined) => string;
  /** Session that owns the implementation (see docs/CONTRACTS.md). */
  owner: 'M0' | 'M1' | 'M2' | 'M3';
  /** false → registered for contract purposes but not passed to the model yet. */
  implemented: boolean;
}

/** What the registry records for each call (also the log row). */
export interface ToolCallRecord {
  tool: ToolName;
  phase: Phase;
  args: unknown;
  why?: string;
  ok: boolean;
  summary: string;
  error?: string;
  startedAt: string;
  durationMs: number;
}

export class ToolNotAllowedError extends Error {
  constructor(
    readonly tool: string,
    readonly phase: Phase,
    detail?: string,
  ) {
    super(detail ?? `tool "${tool}" is not available in phase "${phase}"`);
    this.name = 'ToolNotAllowedError';
  }
}
