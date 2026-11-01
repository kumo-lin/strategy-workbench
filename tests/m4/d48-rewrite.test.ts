/**
 * D-48 只重写: WS-A 报告 v4 written again, the new way, on v4's own evidence — restored from its evidence file
 * (tests/fixtures/d47/ws-a-v4: the plan, the evidence file and the 69 source notes it cites, copied as they are from
 * C's S3 copy; 报告 v4 itself from tests/fixtures/ws-a-tree-versions). Mock model; no search, no fetch.
 */
import { readFileSync } from 'node:fs';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRoles } from '@/lib/config/roles';
import { buildToolContext } from '@/lib/harness';
import { rewriteReport, RewriteDenied, RewriteMissing } from '@/lib/research/rewrite';
import { versionStatuses } from '@/lib/research/version-status';
import { createVault } from '@/lib/vault';
import { scriptedModel } from '../m2/research-fixture';

vi.setConfig({ testTimeout: 120_000 });

const WS = '20_项目/个人AI战略/WS-A 买方';
const DIR = `${WS}/调查/买方采购逻辑（问题树）`;
const V4 = `${DIR}/报告 v4.md`;

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

async function vaultWithV4(o: { planV3?: boolean; approved?: boolean } = {}) {
  root = await mkdtemp(path.join(tmpdir(), 'd48-rewrite-'));
  await cp('tests/fixtures/d47/ws-a-v4', root, { recursive: true });
  await cp('tests/fixtures/ws-a-tree-versions/报告 v4.md', path.join(root, V4));
  if (o.planV3) {
    // WS-A's 计划 v3: only Q3's question changed, numbering kept
    const v2 = await readFile(path.join(root, `${DIR}/计划 v2.md`), 'utf8');
    const v3 = v2.replace(/^(id: .*)$/m, '$1-v3').replace(/^version: 2$/m, 'version: 3').replace('question: 钱从哪里出、在什么条件下批？', 'question: 钱花在哪、什么条件下批？');
    expect(v3).toContain('钱花在哪、什么条件下批？');
    await writeFile(path.join(root, `${DIR}/计划 v3.md`), o.approved === false ? v3.replace(/^approved_by_owner: .*$/m, 'approved_by_owner: null') : v3);
  }
  const vault = createVault(root);
  const role = (await loadRoles(vault)).find((r) => r.name === 'Junior A')!;
  const ctx = await buildToolContext({ vault, role, workspacePath: WS, researchDir: DIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
  return { vault, ctx };
}

/** The judge writes the D-48 fields; the verdict is the default script's (成立) except H3-2's. */
const judge = ({ supports, refutes }: { supports: string[]; refutes: string[] }) => ({
  verdict: '成立',
  rebutted: refutes,
  revised_statement: null,
  support_lines: supports.slice(0, 2).map((k) => `IT 部门把关准入 [${k}]`),
  counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'],
  challenge_responses: refutes.map((k) => ({ key: k, challenge: '说员工会绕开管理', response: `不否定 IT 把关准入 [${supports[0]}]`, effect: '不影响判断' })),
  reasoning: `多家独立来源都指向 IT 把关 [${supports[0]}]`,
  model_knowledge: [],
  so_what: ['所以联想先对准 IT'],
  gaps: ['缺少预算口径'],
  expert_questions: ['预算由谁批？'],
  answer: `IT 管准入 [${supports[0]}]`,
  reasons: [`监管要求建准入机制 [${supports[0]}]`, `IT 侧接入 [${supports[1] ?? supports[0]}]`],
  changed: '没改',
  short_statement: 'IT 把关',
});

describe('只重写 WS-A 报告 v4', () => {
  it('v5 on v4\'s evidence: 本版变化 after Summary, rewrite_of and research_run.rewrite, 0 searches and fetches, v4\'s evidence file kept', async () => {
    const { vault, ctx } = await vaultWithV4({ planV3: true });
    const before = JSON.parse(await readFile(path.join(root, `${DIR}/报告 v4.evidence.json`), 'utf8'));
    const m = scriptedModel({ judge });
    const out = await rewriteReport({ ctx, reportPath: V4, model: m.model });

    expect(out.failedChecks).toEqual([]);
    expect(out.delivered).toBe(true);
    expect(out.reportName).toBe('报告 v5');
    expect(out.usage.searches).toBe(0);
    expect(out.usage.fetches).toBe(0);
    expect(m.tasks.filter((t) => t.startsWith('queries') || t === 'extract' || t === 'evaluate')).toEqual([]); // nothing searched for, read or judged again
    expect(m.tasks.filter((t) => t === 'judge')).toHaveLength(6);

    const v5 = await vault.read(out.reportPath);
    expect(v5.data).toMatchObject({ version: 5, rewrite_of: `[[${DIR}/报告 v4|报告 v4]]`, research_run: { rewrite: true, searches: 0, fetches: 0, mode: 'full' } });
    expect(v5.data.follow_up).toBeUndefined();
    // the evidence file holds v4's entries as they were
    const after = JSON.parse(await readFile(path.join(root, DIR, String(v5.data.evidence_record_file)), 'utf8'));
    expect(after.entries).toEqual(before.entries);
    expect(after.entries).toHaveLength(580);

    const b = v5.body;
    const summaryEnd = b.indexOf('\n## ', b.indexOf('## Summary') + 1);
    expect(b.slice(summaryEnd + 1)).toMatch(/^## 本版变化（v5，只改写法）\n/);
    expect(b).toContain(`- 本版只改写法，证据沿用 v4（[[${DIR}/报告 v4|报告 v4]]），没有重新调查。`);
    expect(b).toContain('- 计划：计划 v3（和 v4 用的计划 v2 比：Q3 的问句改了；编号没变）');
    // v4 judged all six 需要修改; this version's verdicts, compared one by one
    const now = v5.data.verdicts_proposed as Record<string, string>;
    const moved = Object.entries(now).filter(([, v]) => v !== '需要修改');
    expect(moved.length).toBeGreaterThan(0);
    expect(b).toMatch(/^- 判断变了的：H1：需要修改 → (成立|证据不足|不成立)；/m);
    expect(b).toContain('- 判断每次重跑会有出入（同一个判断模型自己跟自己约 84% 一致），上面如实列出。');
    // 怎么查的 says how the evidence was found: v4's run
    expect(b).toMatch(/^- 查了：知识库 39 份、网上 51 份.*；联网搜索 24 次、抓取 45 次（v4 当时；本版没有重新调查）；完整调查。$/m);
    // the new layout
    expect(b).toContain('| 子问题 | 假设 | 提议的判断 | 回答 |');
    expect(b).toMatch(/^\| Q2-1 \| H2-1 IT 把关 \| \S+ \| IT 管准入\[\^\d+\] \|$/m);
    expect(b).toMatch(/^- 改了什么：没改$/m);
    expect(b).toMatch(/^- 回答：IT 管准入\[\^\d+\]$/m); // Q1, not split
    expect(b).toMatch(/^- Q2-1 的回答：IT 管准入\[\^\d+\]\n- 理由：\n {2}- 监管要求建准入机制\[\^\d+\]\n/m);
    // the rewrite is labelled for what it is
    const vs = versionStatuses([{ path: out.reportPath, n: 5, data: v5.data, body: b }]);
    expect(vs.get(out.reportPath)?.label).toBe('用 v4 的证据重写，没有重新调查');
    const log = readFileSync(path.join(root, `${WS}/日志.md`), 'utf8');
    expect(log).toContain('research:rewrite');
  });

  it('a rewrite of a rewrite (v4 → v5 → v6): 怎么查的 says v4\'s counts, and that nothing was searched since', async () => {
    const { vault, ctx } = await vaultWithV4();
    const v5 = await rewriteReport({ ctx, reportPath: V4, model: scriptedModel({ judge }).model });
    const v6 = await rewriteReport({ ctx, reportPath: v5.reportPath, model: scriptedModel({ judge }).model });
    expect(v6.reportName).toBe('报告 v6');
    const d = await vault.read(v6.reportPath);
    expect(d.data).toMatchObject({ rewrite_of: `[[${DIR}/报告 v5|报告 v5]]`, research_run: { rewrite: true, searches: 0, fetches: 0 } });
    expect(d.body).toMatch(/^- 查了：知识库 39 份、网上 51 份.*；联网搜索 24 次、抓取 45 次（v4 当时；之后都没有重新调查）；完整调查。$/m);
    expect(d.body).toContain(`- 本版只改写法，证据沿用 v5（[[${DIR}/报告 v5|报告 v5]]），没有重新调查。`);
  });

  it('a rewrite whose rewrite_of cannot be read: refused, not "0 次"', async () => {
    const { ctx } = await vaultWithV4();
    const v5 = await rewriteReport({ ctx, reportPath: V4, model: scriptedModel({ judge }).model });
    await rm(path.join(root, V4));
    await expect(rewriteReport({ ctx, reportPath: v5.reportPath, model: scriptedModel({ judge }).model })).rejects.toThrow(`找不到 ${DIR}/报告 v4`);
  });

  it('the plan vN used, unchanged: "沿用计划 v2"', async () => {
    const { vault, ctx } = await vaultWithV4();
    const out = await rewriteReport({ ctx, reportPath: V4, model: scriptedModel({ judge }).model });
    expect((await vault.read(out.reportPath)).body).toContain('- 计划：沿用计划 v2');
  });

  it('refused: the latest plan not approved; a report with no evidence record', async () => {
    const a = await vaultWithV4({ planV3: true, approved: false });
    await expect(rewriteReport({ ctx: a.ctx, reportPath: V4, model: scriptedModel().model })).rejects.toThrow(RewriteDenied);
    await rm(root, { recursive: true, force: true });
    const b = await vaultWithV4();
    await rm(path.join(root, `${DIR}/报告 v4.evidence.json`));
    await expect(rewriteReport({ ctx: b.ctx, reportPath: V4, model: scriptedModel().model })).rejects.toThrow('没有证据记录');
  });

  // W5 on S3: 211 entries recorded, 209 restored, a report written anyway with nothing said
  const GONE = '10_资料库/陈旧的现代化改造引发安全担忧，拖累 AI 计划.md';

  it('a source note of the record not in this vault: refused, nothing written, the missing ref and path listed', async () => {
    const { ctx } = await vaultWithV4();
    await rm(path.join(root, GONE));
    const err = await rewriteReport({ ctx, reportPath: V4, model: scriptedModel({ judge }).model }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RewriteMissing);
    const m = err as RewriteMissing;
    expect(m.recorded).toBe(580);
    expect(m.missing).toEqual([{ ref: expect.stringContaining('[[陈旧的现代化改造引发安全担忧，拖累 AI 计划#^'), path: '陈旧的现代化改造引发安全担忧，拖累 AI 计划.md' }]);
    expect(m.message).toContain('证据记录有 580 条，只恢复了 579 条，没有写报告');
    expect(m.message).toContain('--allow-missing');
    await expect(access(path.join(root, `${DIR}/报告 v5.md`))).rejects.toThrow();
    expect(readFileSync(path.join(root, `${WS}/日志.md`), 'utf8')).not.toContain('research:rewrite');
  });

  it('allowMissing (the owner decided): written, 本版变化 says how many did not come back and from where', async () => {
    const { vault, ctx } = await vaultWithV4();
    await rm(path.join(root, GONE));
    const out = await rewriteReport({ ctx, reportPath: V4, model: scriptedModel({ judge }).model, allowMissing: true });
    expect(out.delivered).toBe(true);
    const b = (await vault.read(out.reportPath)).body;
    expect(b).toContain(`- 本版只改写法，证据沿用 v4（[[${DIR}/报告 v4|报告 v4]]），有 1 条没能恢复（缺 陈旧的现代化改造引发安全担忧，拖累 AI 计划.md），没有重新调查。`);
  });
});
