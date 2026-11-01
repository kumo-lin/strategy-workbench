/**
 * The internal half of a run: what each sub-question found in the team library and whether that is enough.
 * D-64 T22 (D2): the run no longer stops here to ask the owner — whatever has a gap goes to the web by itself. The
 * record stays in memory and is shown on the run page (the 「在文件管理的资料中检索」 step); nothing is written to disk.
 */
import type { UIMessageChunk } from 'ai';
import type { ResearchMode } from './constants';
import type { EvidenceRecordEntry } from './evidence-record';

export interface InventorySource {
  path: string;
  title: string;
  grade: 'A' | 'B' | 'C' | null;
  simulated: boolean;
  supports: number;
  refutes: number;
}

export interface InventorySub {
  claimId: string;
  /** The report label of the claim (as judgeAndWrite uses it). */
  label: string;
  subId: string;
  question: string;
  /** The plan's methods include '网络'. */
  webAllowed: boolean;
  sources: InventorySource[];
  /** enough: stopFor === 'decidable'; kb_only: !webAllowed; gap otherwise. */
  status: 'enough' | 'gap' | 'kb_only';
  /** enough → st.stopNote; gap → run.describeGap(claimId, subId); kb_only → st.stopNote. */
  note: string;
  tried: string[];
  /** The kb pass's web_queries (the web half needs them). */
  webQueries: string[];
}

export interface Inventory {
  version: 1;
  /** The approved plan the pass ran on. */
  planPath: string;
  planVersion: number;
  mode: ResearchMode;
  /** ISO. */
  createdAt: string;
  /** selectScope's selection, in order. */
  claimIds: string[];
  notExecuted: string[];
  subs: InventorySub[];
  /** claimId → the vault half's notes (counterKb's notes joined with '；'). */
  counterNotes: Record<string, string>;
  /** claimId → counterKb's qp.web_queries. */
  counterQueries: Record<string, string[]>;
  /** serializeEvidence(run.evidence) after the pass. */
  evidence: EvidenceRecordEntry[];
  /** client.usage() after the pass (0 / 0 expected). */
  searches: number;
  fetches: number;
  /** Older runs stored the vault-only stage's chunks here. */
  replay?: UIMessageChunk[];
}
