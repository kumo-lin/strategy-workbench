/**
 * 内部资料清单 → what the run area shows (M2_5b): one row per sub-question, its vault sources and whether that is
 * enough, plus the subs that may go to the web. Pure and client-safe: the page and the stream hand in an Inventory.
 */
import type { Inventory, InventorySource } from './inventory';

export interface InventoryRow {
  claimId: string;
  label: string;
  subId: string;
  question: string;
  sourceCount: number;
  /** e.g. "A 1 · B 2 · C 1"; sources with grade null count as 未分级; '' when no sources. */
  gradeText: string;
  supports: number;
  refutes: number;
  status: 'enough' | 'gap' | 'kb_only';
  note: string;
  webAllowed: boolean;
}

export interface InventoryView {
  mode: 'small' | 'full';
  rows: InventoryRow[];
  /** The subs the panel checks by default: a gap that may search the web. */
  defaultSelection: string[];
}

function gradeTextOf(sources: InventorySource[]): string {
  if (!sources.length) return '';
  const counts = { A: 0, B: 0, C: 0, ungraded: 0 };
  for (const s of sources) {
    if (s.grade === 'A' || s.grade === 'B' || s.grade === 'C') counts[s.grade] += 1;
    else counts.ungraded += 1;
  }
  const parts: string[] = [];
  for (const g of ['A', 'B', 'C'] as const) if (counts[g]) parts.push(`${g} ${counts[g]}`);
  if (counts.ungraded) parts.push(`未分级 ${counts.ungraded}`);
  return parts.join(' · ');
}

export function inventoryView(inv: Inventory): InventoryView {
  const rows = (Array.isArray(inv.subs) ? inv.subs : []).map((sub): InventoryRow => {
    const sources = Array.isArray(sub.sources) ? sub.sources : [];
    return {
      claimId: sub.claimId,
      label: sub.label,
      subId: sub.subId,
      question: sub.question,
      sourceCount: sources.length,
      gradeText: gradeTextOf(sources),
      supports: sources.reduce((n, s) => n + (Number(s.supports) || 0), 0),
      refutes: sources.reduce((n, s) => n + (Number(s.refutes) || 0), 0),
      status: sub.status,
      note: sub.note,
      webAllowed: Boolean(sub.webAllowed),
    };
  });
  return { mode: inv.mode, rows, defaultSelection: rows.filter((r) => r.status === 'gap' && r.webAllowed).map((r) => r.subId) };
}
