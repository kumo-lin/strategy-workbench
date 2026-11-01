/**
 * The evidence record is machine data in a file next to the report (D-21 v3: 2,784 frontmatter lines in Obsidian).
 * New reports write the sidecar; old reports with an inline `evidence_record` still read; the migration moves the
 * inline record without touching the body or any other field.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evidenceSidecarPath, loadEvidenceRecord, writeEvidenceSidecar, type EvidenceRecordEntry } from '@/lib/research/evidence-record';
import { createVault } from '@/lib/vault';
import { parseMarkdown, serializeMarkdown } from '@/lib/vault/frontmatter';
import { moveEvidenceRecord, withoutInlineRecord } from '../../scripts/move-evidence-record';
import { RDIR, setup } from './research-fixture';

const entry = (i: number): EvidenceRecordEntry => ({ claim: 'C1', sub: 'C1-Q1', ref: `[[资料甲#^c${i}]]`, stance: 'supports', core: false, partial: false, round: 'kb', reason: `理由 ${i}` });

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('the sidecar', () => {
  it('next to the report as 报告 vN.evidence.json; read back through evidence_record_file; old inline records still read', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const report = `${RDIR}/报告 v1.md`;
    expect(evidenceSidecarPath(report)).toBe(`${RDIR}/报告 v1.evidence.json`);
    const fields = await writeEvidenceSidecar(fx.vault, report, [entry(1), entry(2)]);
    expect(fields).toEqual({ evidence_record_file: '报告 v1.evidence.json' });
    expect(await loadEvidenceRecord(fx.vault, report, fields)).toEqual([entry(1), entry(2)]);
    expect(await loadEvidenceRecord(fx.vault, report, { evidence_record: [entry(3)] })).toEqual([entry(3)]);
    expect(await loadEvidenceRecord(fx.vault, report, {})).toEqual([]);
    // the vault lists notes only: the sidecar is never read or validated as a note
    expect((await fx.vault.list(RDIR)).map((e) => e.name)).not.toContain('报告 v1.evidence.json');
  });

  it('a new run writes the sidecar, and the report frontmatter carries only the file name', async () => {
    const { executeResearch } = await import('@/lib/research/execute');
    const { fakeWeb, scriptedModel } = await import('./research-fixture');
    const fx = await setup();
    cleanup = fx.cleanup;
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const note = await fx.vault.read(r.reportPath);
    expect(note.data.evidence_record).toBeUndefined();
    expect(note.data.evidence_record_file).toBe(path.posix.basename(evidenceSidecarPath(r.reportPath)));
    expect((await loadEvidenceRecord(fx.vault, r.reportPath, note.data)).length).toBeGreaterThan(0);
  });
});

describe('moving an inline record (the migration)', () => {
  it('only the evidence_record block changes: body and other fields byte for byte, checks identical', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const report = `${RDIR}/报告 v1.md`;
    const body = '\n# R 调查报告 v1\n\n## Summary\n- 要回答的问题：x\n\n正文“IT 可管理性是企业采购 AI PC 的首要考量。”（B 级，知识库）[[资料甲#^c1]]\n';
    const fm = { id: 'report-x', type: 'report', status: '进行中', created: '2026-10-25', updated: '2026-10-25', author: 'AI', derived_from: ['[[x]]'], relates_to: ['[[y]]'], evidence_record: [entry(1), entry(2)], research_run: { mode: 'full' } };
    const raw = serializeMarkdown(fm, body);
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.join(fx.vault.root, RDIR), { recursive: true });
    await writeFile(path.join(fx.vault.root, report), raw, 'utf8');

    const r = await moveEvidenceRecord(fx.vault, report);
    expect(r.entries).toBe(2);
    const after = await readFile(path.join(fx.vault.root, report), 'utf8');
    expect(parseMarkdown(after).body).toBe(parseMarkdown(raw).body);
    expect(after).toBe(withoutInlineRecord(raw, '报告 v1.evidence.json'));
    const data = parseMarkdown(after).data;
    expect(data.evidence_record).toBeUndefined();
    expect(data.research_run).toEqual({ mode: 'full' });
    expect(await loadEvidenceRecord(fx.vault, report, data)).toEqual([entry(1), entry(2)]);
  });

  it('the S3 snapshot v3 (the must-3 comparison) was moved: same body as before, 343 entries in the sidecar', async () => {
    const vault = createVault('demo-vault/.snapshots/S3-C7-ws-a');
    const p = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/报告 v3.md';
    const note = await vault.read(p);
    expect(note.data.evidence_record).toBeUndefined();
    expect(note.data.evidence_record_file).toBe('报告 v3.evidence.json');
    expect(await loadEvidenceRecord(vault, p, note.data)).toHaveLength(343);
    const raw = await readFile(path.join(vault.root, p), 'utf8');
    expect(raw.split('\n').length).toBeLessThan(500);
  });
});
