/**
 * D-48: --rerender. WS-A 报告 v9 rendered again by today's rules from its judgment file alone (tests/fixtures/d48/ws-a-v9,
 * copied from C's S3), on its evidence (v9's record is v4's, tests/fixtures/d47/ws-a-v4): no model call at all; the
 * words as v9 has them, only footnotes may differ (the renderer's evidence-role rule was fixed after v9).
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRoles } from '@/lib/config/roles';
import { buildToolContext } from '@/lib/harness';
import { rewriteReport, RewriteDenied } from '@/lib/research/rewrite';
import { createVault } from '@/lib/vault';
import { scriptedModel } from '../m2/research-fixture';

vi.setConfig({ testTimeout: 180_000 });

const WS = '20_项目/个人AI战略/WS-A 买方';
const DIR = `${WS}/调查/买方采购逻辑（问题树）`;
const V9 = `${DIR}/报告 v9.md`;

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

async function vaultWithV9() {
  root = await mkdtemp(path.join(tmpdir(), 'd48-rerender-'));
  await cp('tests/fixtures/d47/ws-a-v4', root, { recursive: true });
  await cp('tests/fixtures/d48/WS-A 计划 v3.md', path.join(root, `${DIR}/计划 v3.md`));
  // where the investigation started (计划 v1 links them): the exec meeting and the W1 decisions, as the S3 snapshot has them
  await cp('tests/fixtures/d48/ws-a-v9/计划 v1.md', path.join(root, `${DIR}/计划 v1.md`));
  for (const d of ['会议', '决策']) await cp(`demo-vault/.snapshots/S3-C7-ws-a/20_项目/个人AI战略/${d}`, path.join(root, `20_项目/个人AI战略/${d}`), { recursive: true });
  await cp('tests/fixtures/d48/ws-a-v9/报告 v9.md', path.join(root, V9));
  await cp('tests/fixtures/d48/ws-a-v9/报告 v9.judgment.json', path.join(root, `${DIR}/报告 v9.judgment.json`));
  // v9's record is v4's, entry for entry
  await cp(path.join(root, `${DIR}/报告 v4.evidence.json`), path.join(root, `${DIR}/报告 v9.evidence.json`));
  // 怎么查的 goes back along rewrite_of to the run that searched (v4): v5–v8 as rewrites, their frontmatter only
  await cp('tests/fixtures/ws-a-tree-versions/报告 v4.md', path.join(root, `${DIR}/报告 v4.md`));
  for (let v = 5; v <= 8; v++) {
    await writeFile(path.join(root, `${DIR}/报告 v${v}.md`), `---\ntype: report\nversion: ${v}\nrewrite_of: "[[${DIR}/报告 v${v - 1}|报告 v${v - 1}]]"\nresearch_run:\n  rewrite: true\n---\n`);
  }
  const vault = createVault(root);
  const role = (await loadRoles(vault)).find((r) => r.name === 'Junior A')!;
  const ctx = await buildToolContext({ vault, role, workspacePath: WS, researchDir: DIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
  return { vault, ctx };
}

/** The words of a body: footnotes, their definitions, the title, 本版变化 and the appendix (counts of this run) left out. */
function words(body: string): string[] {
  const out: string[] = [];
  let skip = false;
  for (const l of body.split('\n')) {
    if (/^## /.test(l)) skip = /^## (本版变化|附录|引文出处)/.test(l);
    if (skip || /^# /.test(l) || /^\[\^\d+\]:/.test(l)) continue;
    out.push(l.replace(/\[\^\d+\]/g, '').replace(/（还缺证据）/g, '').trimEnd());
  }
  return out.filter((l) => l.trim());
}

describe('--rerender WS-A 报告 v9', () => {
  it('v10 from v9\'s judgment file: no model call, no search; the words as v9 has them; 本版变化 says so', async () => {
    const { vault, ctx } = await vaultWithV9();
    const m = scriptedModel();
    const out = await rewriteReport({ ctx, reportPath: V9, model: m.model, rerender: { note: '修复证据角色检查误删撑数字的脚注' } });
    expect(m.tasks).toEqual([]);
    expect(out.usage).toMatchObject({ searches: 0, fetches: 0 });
    expect(out.reportName).toBe('报告 v10');
    const [v9, v10] = [await vault.read(V9), await vault.read(out.reportPath)];
    expect(v10.body).toContain('- 只重新渲染：修复证据角色检查误删撑数字的脚注，判断和文字都没变\n');
    expect(v10.data.verdicts_proposed).toEqual(v9.data.verdicts_proposed);
    // v9 was flagged: so is v10, its one-line answer and 对决策的回答 checked again by today's rule (code, no model)
    expect((v9.data.summary_flags as unknown[]).length).toBeGreaterThan(0);
    expect(v10.data.summary_flags).toEqual(expect.arrayContaining([{ sentence: expect.stringMatching(/^提议：押管理\/安全栈/), q: '', kind: 'untagged' }]));
    // 复核 A renamed two lines the system writes (not the model's words): compare v9 in today's wording
    const today = (l: string) => l.replace('## 对 workplan 的影响', '## 对研究计划的影响').replace('链接到的 workplan、', '链接到的研究计划、');
    const [a, b] = [words(v9.body).map(today), words(v10.body)];
    // line for line, the words the same
    const differ = a.flatMap((l, i) => (l === b[i] ? [] : [{ v9: l, v10: b[i] }]));
    expect(differ).toEqual([]);
    expect(b).toHaveLength(a.length);
    // its own judgment file, the same judgments
    const log = await vault.readLog(ctx.logPath);
    expect(log.some((x) => x.action === 'research:rerender')).toBe(true);
  });

  it('a judgment file without the one-line answer or the recommendation: refused, nothing written', async () => {
    const { vault, ctx } = await vaultWithV9();
    const file = path.join(root, `${DIR}/报告 v9.judgment.json`);
    const f = JSON.parse(await readFile(file, 'utf8'));
    delete f.recommendation;
    await writeFile(file, JSON.stringify(f));
    await expect(rewriteReport({ ctx, reportPath: V9, model: scriptedModel().model, rerender: {} })).rejects.toThrow(RewriteDenied);
    await expect(rewriteReport({ ctx, reportPath: V9, model: scriptedModel().model, rerender: {} })).rejects.toThrow(/没存推荐判断/);
    expect((await vault.list(DIR)).some((e) => e.name === '报告 v10.md')).toBe(false);
  });
});
