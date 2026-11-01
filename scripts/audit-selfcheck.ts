/**
 * One-off (M4 audit, 2026-10-25): run the report self-check and the number check — the rules as they are now — over every
 * real-model report the sessions left behind, to find the remaining false positives in one go. Read only: no report is
 * changed, no model is called, no server is started.
 *
 *   pnpm tsx scripts/audit-selfcheck.ts <out.json> <root>...
 *
 * Question-tree reports (D-39) are read by the same checks, which know their headings ("### / #### 假设 H2-1：") and
 * labels (H2-1, Q3-2 are identifiers, not numbers); each result says which format it is.
 *
 * Finds `报告 vN.md` and `普通模式报告 vN.md` under each root (skipping node_modules and the E2E vaults, which hold mock
 * output), keeps one copy of each distinct body, and runs on it:
 *   citationFailures(checkCitations) + linkFailures + decisionFailures + checkReportText   (= selfCheck in execute.ts)
 *   numberMismatches + responseProblems against the full block originals                   (= numberFailures, detection part)
 * Not run: challengeFailures / revisionFailures / recommendationFailures — they need the run's in-memory evidence.
 * issuedKeys: E1…En with n = the entries of the report's evidence record, when it has one (the record keeps no keys).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEvidenceRecord } from '@/lib/research/evidence-record';
import { numberMismatches, responseProblems } from '@/lib/research/number-check';
import { footnoteQuotes } from '@/lib/research/number-repair';
import { citationFailures, checkReportText, decisionFailures, linkFailures, type CheckFailure } from '@/lib/research/selfcheck';
/** A question-tree report (D-39): "### / #### 假设 Hn：" sections under "## Qx". */
const isTreeReport = (body: string): boolean => body.split('\n').some((l) => /^#{3,4} 假设 (H\d+(?:-\d+)?)[：:]/.test(l)) && /^## Q\d+ /m.test(body);
import { createVault } from '@/lib/vault';

const [out, ...roots] = process.argv.slice(2);

async function walk(dir: string, found: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name === 'node_modules' || e.name.startsWith('e2e-vault') || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, found);
    else if (/^(普通模式)?报告 v\d+\.md$/.test(e.name) && p.includes(`${path.sep}20_项目${path.sep}`)) found.push(p);
  }
  return found;
}

interface Hit {
  check: string;
  code: string;
  message: string;
  excerpt?: string;
  line?: number;
  /** The hypothesis the hit is under (H2, or a question tree's H2-1), when the check knows it. */
  claim?: string | null;
}

async function main() {
  const files = (await Promise.all(roots.map((r) => walk(path.resolve(r))))).flat();
  const byBody = new Map<string, { files: string[] }>();
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
    const h = createHash('sha1').update(body).digest('hex').slice(0, 12);
    (byBody.get(h) ?? byBody.set(h, { files: [] }).get(h)!).files.push(f);
  }
  console.log(`${files.length} report files, ${byBody.size} distinct bodies`);

  const results = [];
  for (const [hash, { files: fs }] of byBody) {
    const file = fs[0];
    const at = file.indexOf(`${path.sep}20_项目${path.sep}`);
    const root = file.slice(0, at);
    const rel = file.slice(at + 1).split(path.sep).join('/');
    const vault = createVault(root);
    const n = await vault.read(rel);
    const plain = n.data.mode === 'baseline' || path.basename(file).startsWith('普通模式');
    const hits: Hit[] = [];
    let issued: Set<string> | undefined;
    if (!plain) {
      const record = await loadEvidenceRecord(vault, rel, n.data).catch(() => []);
      if (record.length) issued = new Set(record.map((_, i) => `E${i + 1}`));
      const self: CheckFailure[] = [
        ...citationFailures(await vault.checkCitations(n.body, { fromPath: rel })),
        ...(await linkFailures(vault, n.body, rel)),
        ...(await decisionFailures(vault, n.body, rel)),
        ...checkReportText(n.body, [], issued),
      ];
      hits.push(...self.map((f) => ({ check: 'selfcheck', code: f.code, message: f.message, excerpt: f.excerpt })));
      const quotes = await footnoteQuotes(vault, n.body, rel);
      for (const m of numberMismatches(n.body, quotes)) hits.push({ check: 'number', code: 'number_not_in_quote', message: `${m.number} 不在 [^${m.footnotes.join('][^')}] 的原文里`, excerpt: m.text, line: m.line, claim: m.claim });
      for (const p of responseProblems(n.body, quotes)) hits.push({ check: 'number', code: p.kind, message: p.kind === 'inference_cited' ? '脚注挂在推论后面' : `引号里的「${p.quoted}」不在原文里`, excerpt: p.text, line: p.line, claim: p.claim });
    } else {
      // plain reports: the text check only, to see how the uncited-number rule reads a report written without our format
      hits.push(...checkReportText(n.body).filter((f) => f.code === 'uncited_number').map((f) => ({ check: 'selfcheck', code: f.code, message: f.message, excerpt: f.excerpt })));
    }
    results.push({
      hash,
      plain,
      files: fs.map((f) => path.relative(process.cwd(), f)),
      delivery: n.data.delivery ?? null,
      failedChecksStored: Array.isArray(n.data.failed_checks) ? n.data.failed_checks.length : null,
      model: (n.data.research_run as { model?: string } | undefined)?.model ?? null,
      // D-39: a question-tree report (## Qx → ### / #### 假设 Hn：); the checks read either skeleton
      format: plain ? null : n.data.report_format === 'question_tree' || isTreeReport(n.body) ? 'question_tree' : 'legacy',
      issuedKeys: issued?.size ?? null,
      hits,
    });
    console.log(`${hash} ${plain ? 'plain' : 'team '} hits ${String(hits.length).padStart(3)}  ${path.relative(process.cwd(), file)}`);
  }
  await writeFile(out, JSON.stringify(results, null, 1));
  console.log(`wrote ${out}: ${results.reduce((s, r) => s + r.hits.length, 0)} hits`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
