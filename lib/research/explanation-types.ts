/** Private, read-only view of the selected report; never a persisted note or a new judgment. */
import type { Verdict } from '@/lib/notes/schema';
import type { ExplanationChange } from './interview-advice';
/** 复核 #1 adds `what_changed`: what the saved re-analysis says the interviews moved, read from the report body. */
export type ExplanationIntent = 'verdict_limit' | 'evidence_gap' | 'next_validation' | 'what_changed';
export interface ExplanationTarget {
  id: string;
  token: string;
  label: string;
  kind: 'claim' | 'key';
  verdict: Verdict;
  verdictLabel: string;
  members: { label: string; verdictLabel: string }[];
  recordedGaps: string[];
  recordedNextSteps: string[];
  /** 复核 P3: what the interviews of this version said about it (「访谈名：一句」), from the saved hits; absent before any. */
  interviewSaid?: string[];
}
export interface ExplanationContext {
  identity: string;
  reportName: string;
  state: 'ready' | 'unavailable';
  unavailableReason?: 'legacy' | 'invalid' | 'missing' | 'updating';
  notice?: string;
  interviewProvenance: 'reported_simulated' | 'reported_real' | 'reported_mixed' | 'unknown';
  targets: ExplanationTarget[];
  /** Rows of the saved 「因为追加了访谈，结论变了什么」 table (key questions only); absent on a v1 report. */
  changes?: ExplanationChange[];
}
