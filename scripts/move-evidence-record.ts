/**
 * Moves a report's frontmatter `evidence_record` into the file next to it (`报告 vN.evidence.json`) and leaves
 * `evidence_record_file` in its place. Only the `evidence_record:` block of the frontmatter changes: the body and
 * every other frontmatter line stay byte for byte. check_citations and the self-check are run before and after,
 * and the move is undone if anything differs.
 *
 *   pnpm tsx scripts/move-evidence-record.ts <vault root> [<report path> …]   (no path: every report that has one)
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evidenceSidecarPath, loadEvidenceRecord, readEvidenceRecord, writeEvidenceSidecar } from '@/lib/research/evidence-record';
import { checkReportText, citationFailures, decisionFailures } from '@/lib/research/selfcheck';
import { createVault, type Vault } from '@/lib/vault';
import { parseMarkdown } from '@/lib/vault/frontmatter';

/** The frontmatter text with the top-level `evidence_record:` block replaced by one `evidence_record_file:` line. */
export function withoutInlineRecord(raw: string, fileName: string): string {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(raw);
  if (!m) throw new Error('no frontmatter');
  const lines = m[2].split('\n');
  const start = lines.findIndex((l) => /^evidence_record:/.test(l));
  if (start < 0) throw new Error('no evidence_record in the frontmatter');
  let end = start + 1;
  while (end < lines.length && (/^[\s-]/.test(lines[end]) || lines[end] === '')) end++;
  lines.splice(start, end - start, `evidence_record_file: ${JSON.stringify(fileName)}`);
  return `${m[1]}${lines.join('\n')}${m[3]}${raw.slice(m[0].length)}`;
}

async function checks(vault: Vault, reportPath: string): Promise<string> {
  const { body } = parseMarkdown(await readFile(path.join(vault.root, reportPath), 'utf8'));
  const cites = await vault.checkCitations(body, { fromPath: reportPath });
  return JSON.stringify({
    citations: cites.map((c) => [c.link, c.ok, c.error ?? null]),
    failures: [...citationFailures(cites), ...(await decisionFailures(vault, body, reportPath)), ...checkReportText(body)].map((f) => f.message),
  });
}

export async function moveEvidenceRecord(vault: Vault, reportPath: string): Promise<{ entries: number; sidecar: string }> {
  const full = path.join(vault.root, reportPath);
  const raw = await readFile(full, 'utf8');
  const before = parseMarkdown(raw);
  const entries = readEvidenceRecord(before.data.evidence_record);
  if (!Array.isArray(before.data.evidence_record)) throw new Error(`${reportPath}: no inline evidence_record`);
  if (entries.length !== (before.data.evidence_record as unknown[]).length) throw new Error(`${reportPath}: some entries do not read back; not moved`);
  const checksBefore = await checks(vault, reportPath);

  const { evidence_record_file } = await writeEvidenceSidecar(vault, reportPath, entries);
  await writeFile(full, withoutInlineRecord(raw, evidence_record_file), 'utf8');

  const after = parseMarkdown(await readFile(full, 'utf8'));
  const { evidence_record: _gone, ...restBefore } = before.data;
  const { evidence_record_file: _file, ...restAfter } = after.data;
  const problems = [
    after.body !== before.body ? 'the body changed' : '',
    JSON.stringify(restAfter) !== JSON.stringify(restBefore) ? 'other frontmatter fields changed' : '',
    JSON.stringify(await loadEvidenceRecord(vault, reportPath, after.data)) !== JSON.stringify(entries) ? 'the moved record does not read back the same' : '',
    (await checks(vault, reportPath)) !== checksBefore ? 'check_citations / self-check results differ' : '',
  ].filter(Boolean);
  if (problems.length) {
    await writeFile(full, raw, 'utf8');
    await rm(path.join(vault.root, evidenceSidecarPath(reportPath)), { force: true });
    throw new Error(`${reportPath}: ${problems.join('; ')} — undone`);
  }
  return { entries: entries.length, sidecar: evidenceSidecarPath(reportPath) };
}

async function main() {
  const [root, ...paths] = process.argv.slice(2);
  if (!root) throw new Error('usage: move-evidence-record.ts <vault root> [<report path> …]');
  const vault = createVault(root);
  const targets = paths.length ? paths : [];
  if (!targets.length) {
    for (const e of await vault.list('', { recursive: true })) {
      if (e.kind !== 'file' || !/\/调查\/[^/]+\/报告 v\d+\.md$/.test(e.path)) continue;
      if (/^evidence_record:/m.test(await readFile(path.join(vault.root, e.path), 'utf8'))) targets.push(e.path);
    }
  }
  for (const t of targets) {
    const r = await moveEvidenceRecord(vault, t);
    console.log(`${t}: ${r.entries} entries → ${r.sidecar}; body unchanged; check_citations and self-check identical`);
  }
  if (!targets.length) console.log('no report carries an inline evidence_record');
}

if (process.argv[1] && /move-evidence-record/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
