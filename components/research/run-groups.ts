/** The run's messages, grouped by the nine steps (UI/UX 方案 #11): which steps ran, what each did, which cards belong to which. */
import { isDecisionRead, toolNameOf } from '@/components/chat/chat-state';
import type { ResearchUIMessage, SearchCardEvent, StepEvent } from '@/lib/research/progress';

export const STEP_NAMES = ['拆问题', '查知识库', '查网上', '提取', '评估', '找反证', '补缺', '判断', '自检'] as const;

export type GroupStatus = 'todo' | 'running' | 'waiting' | 'done' | 'failed';

export interface RunTool {
  key: string;
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export interface RunGroup {
  /** 1–9 */
  n: number;
  name: string;
  status: GroupStatus;
  steps: StepEvent[];
  tools: RunTool[];
  /** How many of the tools read a decision the team has confirmed. */
  decisionReads: number;
}

function statusOf(steps: StepEvent[], allSteps: StepEvent[]): GroupStatus {
  if (!steps.length) return 'todo';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.some((s) => s.status === 'running')) return 'running';
  const last = steps[steps.length - 1];
  // A continued run leaves the vault pass's waiting rows in place; later progress supersedes them.
  if (last.status === 'waiting') {
    const at = allSteps.lastIndexOf(last);
    const superseded = allSteps.slice(at + 1).some((s) => s.step > last.step || s.status === 'running' || s.status === 'done');
    if (!superseded) return 'waiting';
  }
  return 'done';
}

/** D-64 T38: also the search-and-judgment cards (T26), in the order they came, once each. */
export function groupRun(messages: ResearchUIMessage[]): { groups: RunGroup[]; steps: StepEvent[]; cards: SearchCardEvent[] } {
  const byId = new Map<string, StepEvent>();
  const cards = new Map<string, SearchCardEvent>();
  const allSteps: StepEvent[] = [];
  const tools: { tool: RunTool; step: number }[] = [];
  let lastStep = 1;
  for (const m of messages) {
    m.parts.forEach((part, i) => {
      if (part.type === 'data-step') {
        byId.set(part.data.id, part.data);
        allSteps.push(part.data);
        lastStep = part.data.step;
        return;
      }
      if (part.type === 'data-card') {
        cards.set(part.id ?? `card-${cards.size}`, part.data);
        return;
      }
      const name = toolNameOf(part);
      const p = part as { toolCallId?: string; state?: string; input?: unknown; output?: unknown; errorText?: string };
      if (!name || !p.toolCallId) return;
      const tool: RunTool = { key: `${m.id}-${i}-${p.toolCallId}`, name, state: p.state ?? 'input-available', input: p.input, output: p.output, errorText: p.errorText };
      // a decision read is the run's step 2 (查知识库), whatever step event came last
      tools.push({ tool, step: isDecisionRead(name, p.input) ? 2 : lastStep });
    });
  }
  const steps = [...byId.values()];
  const groups: RunGroup[] = STEP_NAMES.map((name, i) => {
    const n = i + 1;
    const own = steps.filter((s) => s.step === n);
    const mine = tools.filter((t) => t.step === n).map((t) => t.tool);
    return { n, name, status: statusOf(own, allSteps), steps: own, tools: mine, decisionReads: mine.filter((t) => isDecisionRead(t.name, t.input)).length };
  });
  return { groups, steps, cards: [...cards.values()] };
}
