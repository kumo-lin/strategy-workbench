/**
 * What a delivered report remembers about its evidence: per evidence block,
 * the claim / sub-question it was judged for and the stance. A follow-up investigation reads it to continue
 * from exactly the same evidence instead of re-deriving it from the report's prose. Everything else
 * (quote, grade, publisher, …) is read again from the vault, so it can never drift from the source note.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Vault } from '@/lib/vault';
import { parseWikiLink } from '@/lib/vault/links';
import type { Evidence, EvidenceRound, Stance } from './evidence';
import { claimBlocksOf, loadSourceInfo } from './sources';

export interface EvidenceRecordEntry {
  claim: string;
  sub: string;
  ref: string;
  stance: Exclude<Stance, 'irrelevant'>;
  core: boolean;
  partial: boolean;
  round: EvidenceRound;
  reason: string;
}

export function serializeEvidence(evidence: Evidence[]): EvidenceRecordEntry[] {
  return evidence
    .filter((e) => e.stance !== 'irrelevant')
    .map((e) => ({
      claim: e.claimId,
      sub: e.subQuestionId,
      ref: e.ref,
      stance: e.stance as 'supports' | 'refutes',
      core: e.core,
      partial: e.partial,
      round: e.round,
      reason: e.reason.slice(0, 200),
    }));
}

/** Evidence objects for the recorded entries (entries whose block is gone from the vault are dropped). */
export async function restoreEvidence(vault: Vault, record: EvidenceRecordEntry[], fromPath?: string): Promise<Evidence[]> {
  const out: Evidence[] = [];
  for (const r of record) {
    const link = parseWikiLink(r.ref);
    if (!link?.block) continue;
    const res = await vault.resolveLink(link, fromPath);
    if (!res.ok) continue;
    const info = await loadSourceInfo(vault, res.path).catch(() => null);
    if (!info) continue;
    const [draft] = await claimBlocksOf(vault, info, new Set([link.block]));
    if (!draft) continue;
    out.push({ ...draft, claimId: r.claim, subQuestionId: r.sub, round: r.round, stance: r.stance, reason: r.reason, core: r.core, partial: r.partial });
  }
  return out;
}

/** Defensive read of the frontmatter value. */
export function readEvidenceRecord(v: unknown): EvidenceRecordEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is EvidenceRecordEntry =>
      !!x && typeof x === 'object' && typeof (x as EvidenceRecordEntry).ref === 'string' && typeof (x as EvidenceRecordEntry).claim === 'string' && ['supports', 'refutes'].includes((x as EvidenceRecordEntry).stance),
  );
}

// ── Where the record lives ───────────────────────────────────────────────────
//
// A full run records hundreds of entries; in the frontmatter they pushed the report body ~2,800 lines down in
// Obsidian (D-21 v3). The record is machine data: it lives next to the report as `报告 vN.evidence.json`
// (the vault lists `.md` only, so it is never read or validated as a note) and the frontmatter keeps the file
// name in `evidence_record_file`. Older reports still carry `evidence_record` inline; both are read.

/** `…/报告 v3.md` → `…/报告 v3.evidence.json` (vault-relative). */
export function evidenceSidecarPath(reportPath: string): string {
  return `${reportPath.replace(/\.md$/, '')}.evidence.json`;
}

export function absoluteInVault(vault: Vault, rel: string): string {
  const root = path.resolve(vault.root);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error(`path escapes the vault: ${rel}`);
  return full;
}

export interface EvidenceSidecar {
  /** The report this record belongs to (file name). */
  report: string;
  entries: EvidenceRecordEntry[];
}

/** Writes the record next to the report (atomic); returns the frontmatter fields that point at it. */
export async function writeEvidenceSidecar(vault: Vault, reportPath: string, entries: EvidenceRecordEntry[]): Promise<{ evidence_record_file: string }> {
  const rel = evidenceSidecarPath(reportPath);
  const full = absoluteInVault(vault, rel);
  await mkdir(path.dirname(full), { recursive: true });
  const body: EvidenceSidecar = { report: path.posix.basename(reportPath), entries };
  const tmp = `${full}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 1)}\n`, 'utf8');
  await rename(tmp, full);
  return { evidence_record_file: path.posix.basename(rel) };
}

/** The record of a report: the sidecar it points at, else the inline `evidence_record` of older reports, else none. */
export async function loadEvidenceRecord(vault: Vault, reportPath: string, frontmatter: Record<string, unknown>): Promise<EvidenceRecordEntry[]> {
  if (typeof frontmatter.evidence_record_file === 'string' && frontmatter.evidence_record_file.trim()) {
    const rel = path.posix.join(path.posix.dirname(reportPath), frontmatter.evidence_record_file.trim());
    try {
      const parsed = JSON.parse(await readFile(absoluteInVault(vault, rel), 'utf8')) as Partial<EvidenceSidecar>;
      return readEvidenceRecord(parsed.entries);
    } catch {
      return [];
    }
  }
  return readEvidenceRecord(frontmatter.evidence_record);
}
