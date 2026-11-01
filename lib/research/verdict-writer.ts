/**
 * PRD §6.3.1 step 8 / CONTRACTS 3-c: once the report has passed the self-check, SYSTEM CODE
 * (not an AI tool) writes each claim's proposed verdict into the matching hypothesis note's
 * `verdict_proposed`. `verdict` (the human decision) is never touched here — a person sets
 * it with the `verdict.set` approval event.
 */
import type { Verdict } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { localDate } from '@/lib/local-date';

export interface ProposedVerdict {
  claimId: string;
  /** Resolved hypothesis note path, or null when the claim has no (resolvable) hypothesis. */
  hypothesisPath: string | null;
  verdict: Verdict;
}

export interface VerdictWriteResult extends ProposedVerdict {
  written: boolean;
  reason?: string;
}

export async function writeProposedVerdicts(opts: {
  vault: Vault;
  logPath: string;
  proposals: ProposedVerdict[];
  reportName: string;
  now: Date;
}): Promise<VerdictWriteResult[]> {
  const out: VerdictWriteResult[] = [];
  const today = localDate(opts.now);
  for (const p of opts.proposals) {
    if (!p.hypothesisPath) {
      out.push({ ...p, written: false, reason: '论点没有对应的假设笔记' });
      continue;
    }
    try {
      const note = await opts.vault.read(p.hypothesisPath);
      if (note.data.type !== 'hypothesis') {
        out.push({ ...p, written: false, reason: `${p.hypothesisPath} 不是假设笔记` });
        continue;
      }
      await opts.vault.write(
        p.hypothesisPath,
        { frontmatter: { ...note.data, verdict_proposed: p.verdict, updated: today }, body: note.body },
        { overwrite: true },
      );
      await opts.vault.appendLog(opts.logPath, {
        time: opts.now.toISOString(),
        actor: 'AI',
        action: 'system:verdict_proposed',
        change: `${p.hypothesisPath.replace(/\.md$/, '')}.verdict_proposed = ${p.verdict}`,
        reason: `${opts.reportName} 通过引用自检；这只是提议，需要人用 verdict.set 拍板`,
      });
      out.push({ ...p, written: true });
    } catch (e) {
      out.push({ ...p, written: false, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
