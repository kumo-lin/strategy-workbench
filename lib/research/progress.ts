/** What the orchestrator tells the UI while it runs (mapped to a UI message stream by app/api/research/execute). */
export interface StepEvent {
  kind: 'step';
  /** Stable id so the UI can update one row: `s2:C1-Q1`. */
  id: string;
  /** PRD §6.3.1 step number 1–9. */
  step: number;
  title: string;
  status: 'running' | 'done' | 'skipped' | 'failed' | 'waiting';
  detail?: string;
}

export interface ToolStartEvent {
  kind: 'tool-start';
  id: string;
  tool: string;
  input: unknown;
}

export interface ToolEndEvent {
  kind: 'tool-end';
  id: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

/** D-64 T26: one search of the run, as the run page shows it (检索与判断记录); `stop`: the card that says the gap search stopped. */
export interface SearchCardEvent {
  kind: 'search-card';
  /** Which search of the run (1, 2, …); the stop card carries the last one's. */
  n: number;
  source: 'files' | 'web';
  /** The stored id: keys only, never shown (复核 A). */
  subQuestion: string;
  /** How the page names the sub-question: its words. Older stored runs have none (the page falls back to the id). */
  question?: string;
  query: string;
  results: number;
  /** One line: what this search came to. */
  judgment: string;
  stop?: boolean;
}

export const STOP_CARD = '连续 2 轮无新证据，停止补查';

export type ProgressEvent = StepEvent | ToolStartEvent | ToolEndEvent | SearchCardEvent;
export type Emit = (e: ProgressEvent) => void;

/** Keep UI payloads small: long strings are cut. */
export function clipForUi(v: unknown, max = 1500): unknown {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…（共 ${v.length} 字）` : v;
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => clipForUi(x, max));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clipForUi(x, max)]));
  return v;
}

import type { UIMessage } from 'ai';
import type { AgentMessageMetadata } from '@/lib/harness/agent-request';

/** The message the execute route streams: tool-* parts (cards), data-step parts (the 9 steps), data-result at the end. */
export type ResearchUIMessage = UIMessage<AgentMessageMetadata, { step: StepEvent; card: SearchCardEvent; result: Record<string, unknown>; job: { startedAt: number; mode?: 'small' | 'full' }; attach: { replay: boolean } }>;
