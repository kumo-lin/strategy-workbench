/**
 * The one numbered workflow of a Workspace (D-64 T30: 7 steps, 验收清单 §0) and where a Workspace is on it. Asking the
 * Senior for an opinion is not a step: it never holds the line, and shows in the first cell only.
 * Pure: the page gathers the facts (lib/workflow/load.ts), this says which step is current and who is up.
 */
export interface FlowStepDef {
  n: number;
  name: string;
}

export const FLOW_STEPS: readonly FlowStepDef[] = [
  { n: 1, name: '研究计划' },
  { n: 2, name: '调查计划' },
  { n: 3, name: '调查与报告' },
  { n: 4, name: '访谈建议' },
  { n: 5, name: '追加分析' },
  { n: 6, name: '提交确认' },
  { n: 7, name: '存入项目文件' },
];

export interface FlowFacts {
  /** 项目.md exists and is 已确认: step 0 is done. */
  projectConfirmed: boolean;
  projectOwner: string;
  owner: string;
  reviewer: string;
  /** The Workspace's stage in workspace.md. */
  stage: string;
  /** The latest G1 review: none yet, waiting for the reviewer, passed, or sent back. */
  g1: 'none' | 'pending' | 'approved' | 'rejected';
  /** Comments of a decided review that no workplan version has acted on yet. */
  unhandledComments: number;
  /** How far the furthest investigation of this Workspace has got. */
  research: 'none' | 'planning' | 'approved' | 'running' | 'reported';
  /** A decision drafted from one of this Workspace's reports exists / is confirmed. */
  decisionDrafted: boolean;
  decisionConfirmed: boolean;
  /** The Workspace's latest 结论 review: none yet, waiting for the Senior, confirmed, or sent back. Absent = none. */
  reportReview?: 'none' | 'open' | 'confirmed' | 'sent_back';
  /** T30: the latest delivered report has rows in its gap table (缺乏信息、需要另外验证的问题). */
  reportGaps?: boolean;
  /** T30: interviews were put in and matched to judgments (访谈命中.json in the investigation). */
  interviewHits?: boolean;
  /** 复核 P7: a research plan (workplan) version is written. */
  workplanWritten?: boolean;
  /** Whoever works next to this Workspace on the same branch of the issue tree, e.g. `WS-B 用户（Junior B）`. */
  next: { workspace: string; owner: string } | null;
}

export interface FlowState {
  /** The step that is current (1–7). */
  current: number;
  /** Who is up at the current step: a person's name, or `AI`. */
  who: string;
  /** Per step, who the cell names. */
  cellWho: string[];
  /** G1 is only an opinion: none asked yet, waiting for the reviewer, or replied (approved or sent back). */
  opinion: 'none' | 'waiting' | 'replied';
}

const LATE_STAGES = ['骨架待审', '撰写中', '终稿待审', '完成'];
/** The plan was said final (研究计划定了，往下做调查计划 →), or a later stage. */
const PLAN_DONE_STAGES = ['执行中', '结论待审', ...LATE_STAGES];

export function computeFlow(f: FlowFacts): FlowState {
  const cellWho = [f.owner, f.owner, f.research === 'running' ? 'AI' : f.owner, f.owner, f.owner, f.reviewer, f.reviewer];
  const opinion: FlowState['opinion'] = f.g1 === 'none' ? 'none' : f.g1 === 'pending' ? 'waiting' : 'replied';
  if (opinion === 'waiting') cellWho[0] = `已发给 ${f.reviewer} 征求意见（不挡你）`;
  if (opinion === 'replied') cellWho[0] = `${f.reviewer} 已回复`;
  const at = (current: number, who: string): FlowState => ({ current, who, cellWho, opinion });

  if (f.decisionConfirmed || f.reportReview === 'confirmed' || LATE_STAGES.includes(f.stage)) return at(7, '');
  if (f.stage === '结论待审' || f.reportReview === 'open' || f.decisionDrafted) return at(6, f.reviewer);
  if (f.interviewHits) return at(5, f.owner);
  if (f.research === 'reported') return at(f.reportGaps ? 4 : 3, f.owner);
  if (f.research === 'running') return at(3, 'AI');
  if (f.research !== 'none' || PLAN_DONE_STAGES.includes(f.stage)) return at(2, f.owner);
  return at(1, f.owner);
}

export type StepStatus = 'done' | 'current' | 'todo';

export function stepStatus(state: FlowState, n: number): StepStatus {
  return n < state.current ? 'done' : n === state.current ? 'current' : 'todo';
}
