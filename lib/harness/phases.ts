/**
 * Phases and the phase → tool table (PRD §10.2 工具和阶段).
 *
 * Principle: every model call receives ONLY the tools of the current phase.
 * The phase is derived on the server from vault state (workspace `stage`,
 * research plan approval) plus which surface the human is using (`track`).
 * The model can never change it; only human ApprovalEvents change the state
 * it is derived from (see ./events.ts).
 *
 * CONTRACT (frozen after M0).
 */
import type { NoteType, ResearchPlanNote, WorkspaceStage } from '@/lib/notes/schema';

export const PHASES = ['workplan', 'research_plan', 'research_execute', 'conclusion', 'project_framing', 'files_chat'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  workplan: '研究计划：共创和处理意见',
  research_plan: '调查计划：逐个问清楚再出计划',
  research_execute: '调查执行（计划批准之后）',
  conclusion: '结论和撰写',
  project_framing: '新建项目：和 AI 定义问题（决策契约和议题树）',
  files_chat: '文件管理：按你的任务找资料',
};

export const TOOL_NAMES = [
  'read_task_context',
  'ask_user',
  'vault_list',
  'vault_read',
  'vault_search',
  'write_draft',
  'web_search',
  'web_fetch',
  'ingest_source',
  'check_citations',
  'submit_for_review',
  'propose_decision',
  'propose_knowledge',
  'frame_topic',
  'compose_workplan',
  'draft_contract',
  'draft_issue_tree',
  'set_selection',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** §10.2 table, verbatim. A tool absent from a phase's list is not passed to the model. */
export const PHASE_TOOLS: Record<Phase, readonly ToolName[]> = {
  workplan: ['read_task_context', 'ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft', 'submit_for_review', 'frame_topic', 'compose_workplan'],
  research_plan: ['read_task_context', 'ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft'],
  research_execute: [
    'read_task_context',
    'ask_user',
    'vault_list',
    'vault_read',
    'vault_search',
    'write_draft',
    'web_search',
    'web_fetch',
    'ingest_source',
    'check_citations',
    'propose_decision',
  ],
  conclusion: [
    'read_task_context',
    'ask_user',
    'vault_list',
    'vault_read',
    'vault_search',
    'write_draft',
    'check_citations',
    'submit_for_review',
    'propose_decision',
    'propose_knowledge',
  ],
  // D-64 T33: a new project, before any Workspace — the decision contract and the issue tree, nothing else
  project_framing: ['read_task_context', 'ask_user', 'frame_topic', 'draft_contract', 'draft_issue_tree'],
  // D-64 T37: the files page's chat — it reads, and proposes a selection the analyst accepts on the card
  files_chat: ['read_task_context', 'vault_search', 'set_selection'],
};

/**
 * Which note types `write_draft` may write in each phase (§10.2 row write_draft).
 * conclusion: §10.2 says "骨架、成稿", which are not note types in §9.2; in the
 * demo the conclusion output is the final report (§6.2 step 6), so `report`.
 */
export const WRITE_DRAFT_SCOPE: Record<Phase, readonly NoteType[]> = {
  workplan: ['workplan', 'hypothesis'],
  research_plan: ['research_plan'],
  research_execute: ['report'],
  conclusion: ['report'],
  project_framing: [],
  files_chat: [],
};

export function isToolAllowed(phase: Phase, tool: ToolName): boolean {
  return PHASE_TOOLS[phase].includes(tool);
}

// ── Phase resolution ─────────────────────────────────────────────────────────

/** Which surface the human is talking to the AI from. Chosen by the UI, never by the model. */
export type Track = 'workspace' | 'research' | 'project' | 'files';

export type PlanApprovalState = Pick<ResearchPlanNote, 'status' | 'approved_by_owner' | 'approved_at'>;

export type PhaseInput =
  | { track: 'workspace'; stage: WorkspaceStage }
  /** plan = latest plan version in the research folder, or null before the first draft. */
  | { track: 'research'; plan: PlanApprovalState | null };

const CONCLUSION_STAGES: readonly WorkspaceStage[] = ['结论待审', '骨架待审', '撰写中', '终稿待审', '完成'];

/**
 * Stages before G1 approval (D-8). G1 no longer blocks anything (it only asks the
 * Senior for an opinion), so there is no "before approval" stage any more and no
 * research is `exploratory`. Kept as an empty list so old call sites keep compiling.
 */
export const PRE_G1_STAGES: readonly WorkspaceStage[] = [];

/** A plan is approved only by the owner's approval event: status 已确认 + approver + time. */
export function isPlanApproved(plan: PlanApprovalState | null): boolean {
  return Boolean(plan && plan.status === '已确认' && plan.approved_by_owner && plan.approved_at);
}

export function resolvePhase(input: PhaseInput): Phase {
  if (input.track === 'research') return isPlanApproved(input.plan) ? 'research_execute' : 'research_plan';
  return CONCLUSION_STAGES.includes(input.stage) ? 'conclusion' : 'workplan';
}
