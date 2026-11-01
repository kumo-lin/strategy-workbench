/** T40 supplementary: the page supplies a validated snapshot of the report it actually renders. */
import { createHash } from 'node:crypto';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadExplanationContext } from '@/lib/research/explanation-context';
import type { Role } from '@/lib/config/roles';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';
import { EX_DIR, EX_PLAN, EX_REPORT, explanationFiles, explanationJudgment } from '../helpers/explanation-fixture';

const cap = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role, props: {} as Record<string, unknown> }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => cap.vault }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => cap.role }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
vi.mock('@/components/research/research-workbench', () => ({ ResearchWorkbench: (props: Record<string, unknown>) => { cap.props = props; return null; } }));
interface View { state: string; identity: string; reportName: string; notice?: string; unavailableReason?: string; targets: { id: string; token: string; kind: string; verdict: string; verdictLabel: string; recordedGaps: string[]; recordedNextSteps: string[]; members: unknown[] }[]; interviewProvenance: string }
let cleanup = async () => {};
afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });
async function fixture() {
  const fx = await makeFixtureVault(explanationFiles());
  cleanup = fx.cleanup; cap.vault = fx.vault; cap.role = ROLES.juniorA;
  for (const p of [EX_PLAN, `${EX_DIR}/计划 v2.md`, EX_REPORT(1), EX_REPORT(2)]) expect((await fx.vault.read(p)).note, p).not.toBeNull();
  return fx;
}
async function view(v = 2): Promise<View> {
  const { default: Page } = await import('@/app/workspace/[project]/[workspace]/research/[name]/page');
  renderToString(await Page({ params: Promise.resolve({ project: 'P', workspace: 'WS-A', name: 'R1' }), searchParams: Promise.resolve({ v: EX_REPORT(v) }) }));
  return cap.props.explanationContext as View;
}
async function sidecar(root: string, value: unknown) { await writeFile(path.join(root, EX_REPORT(2).replace(/\.md$/, '.judgment.json')), typeof value === 'string' ? value : JSON.stringify(value)); }
async function hashes(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of (await readdir(root, { recursive: true })).sort()) {
    try { out[p] = createHash('sha256').update(await readFile(path.join(root, p))).digest('hex'); } catch { /* directories */ }
  }
  return out;
}
describe('T40 version-bound explanation snapshot', () => {
  it('uses selected v1 and its old plan, not the newest report or plan', async () => {
    await fixture(); const c = await view(1);
    expect(c).toMatchObject({ state: 'ready', reportName: '报告 v1' });
    expect(c.targets.find((t) => t.token === 'K3')).toMatchObject({ verdict: '证据不足', recordedGaps: expect.arrayContaining(['没有跨设备与单设备用户的留存对比']) });
    expect(c.targets.some((t) => t.token === 'K4')).toBe(false);
  });
  it('the selected report advice uses its historical plan statement, never the newest plan', async () => {
    const fx = await fixture();
    const newer = path.join(fx.root, `${EX_DIR}/计划 v2.md`);
    await writeFile(newer, (await readFile(newer, 'utf8')).replace('statement: 跨设备有增量', 'statement: NEW PLAN MUST NOT LEAK'));
    await view(1);
    const advice = cap.props.interviewAdvice as { rows: { verify: string }[] };
    expect(advice.rows[0].verify).toBe('H1 跨设备有增量');
    expect(JSON.stringify(advice)).not.toContain('NEW PLAN MUST NOT LEAK');
  });
  it('v2 reads the stored verdict, not the stale inner judgment or conditions', async () => {
    await fixture(); const c = await view();
    expect(c.targets.find((t) => t.token === 'K3')).toMatchObject({ verdict: '访谈支持', verdictLabel: '访谈支持' });
    expect(c.targets.find((t) => t.token === 'H1')).toMatchObject({ recordedGaps: ['没有可核对的留存数字'], recordedNextSteps: ['请产品分析负责人提供留存数据'] });
    expect(JSON.stringify(c)).not.toMatch(/旧条件|keyed|\[\[|#\^|20_项目/);
    expect(c.interviewProvenance).toBe('reported_simulated');
  });
  it('H gaps are not invented from a K-wide gap, missing information stays empty', async () => {
    const fx = await fixture(); const j = explanationJudgment(); j.claims[0].judgment.gaps = []; j.claims[0].judgment.expert_questions = []; await sidecar(fx.root, j);
    const c = await view();
    expect(c.targets.find((t) => t.token === 'H1')?.recordedGaps).toEqual([]);
    expect(c.targets.find((t) => t.token === 'K3')?.recordedGaps).toContain('没有跨设备与单设备用户的留存对比');
  });
  it.each(['broken-json', 'wrong-report', 'invalid-verdict', 'duplicate-id', 'verdict-mismatch', 'invalid-gaps'])('%s degrades locally, never the whole page', async (kind) => {
    const fx = await fixture(); const j = explanationJudgment();
    if (kind === 'wrong-report') j.report = '报告 v1.md';
    if (kind === 'invalid-verdict') j.claims[0].verdict = 'unknown';
    if (kind === 'duplicate-id') j.claims.push(j.claims[0]);
    if (kind === 'verdict-mismatch') j.claims[0].verdict = '成立';
    if (kind === 'invalid-gaps') (j.summary as unknown as Record<string, unknown>).gaps = 'not an array';
    await sidecar(fx.root, kind === 'broken-json' ? '{' : j);
    expect(await view()).toMatchObject({ state: 'unavailable', targets: [] });
  });
  it('missing sidecar does not guess judgments from the body or create a sidecar', async () => {
    const fx = await fixture(); await rm(path.join(fx.root, EX_REPORT(2).replace(/\.md$/, '.judgment.json')));
    const before = await hashes(fx.root);
    expect(await view()).toMatchObject({ state: 'unavailable', unavailableReason: 'missing', targets: [] });
    expect(await hashes(fx.root)).toEqual(before);
  });
  it('missing or cross-investigation plan preserves H only, without reading outside the investigation', async () => {
    const fx = await fixture(); const raw = await readFile(path.join(fx.root, EX_REPORT(2)), 'utf8');
    await writeFile(path.join(fx.root, EX_REPORT(2)), raw.replace(EX_PLAN.replace(/\.md$/, ''), '20_项目/Other/WS/调查/R2/计划 v1'));
    const spy = vi.spyOn(fx.vault, 'read'); const c = await view();
    expect(c).toMatchObject({ state: 'ready', notice: expect.stringContaining('分组') });
    expect(c.targets.map((t) => t.token)).toEqual(['H1', 'H2']);
    expect(spy.mock.calls.some(([p]) => p.includes('Other'))).toBe(false);
  });
  it('does not attribute history using the current global interview hits or overwritten interview files', async () => {
    const fx = await fixture(); const note = await readFile(path.join(fx.root, EX_REPORT(2)), 'utf8');
    await writeFile(path.join(fx.root, EX_REPORT(2)), note.replace('（模拟访谈）', ''));
    await writeFile(path.join(fx.root, EX_DIR, '访谈命中.json'), JSON.stringify([{ simulated: true, claims: ['C1'] }]));
    expect((await view()).interviewProvenance).toBe('unknown');
  });
  it('content identity changes at the same path; no reads create or modify business files or logs', async () => {
    const fx = await fixture(); const before = await hashes(fx.root); const write = vi.spyOn(fx.vault, 'write'); const log = vi.spyOn(fx.vault, 'appendLog');
    const a = await view(); expect(a.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashes(fx.root)).toEqual(before); expect(write).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
    const j = explanationJudgment(); j.claims[0].judgment.gaps.push('新增的版本记录'); await sidecar(fx.root, j);
    const b = await view(); expect(b.identity).not.toBe(a.identity);
    cap.role = ROLES.senior; expect((await view()).targets).toEqual(b.targets);
  });
  it('report changes during the read: never replace the already rendered snapshot with a newer one', async () => {
    const fx = await fixture(); const read = fx.vault.read.bind(fx.vault); let count = 0;
    vi.spyOn(fx.vault, 'read').mockImplementation(async (p) => {
      const n = await read(p);
      if (p === EX_PLAN) { count++; if (count === 1) await writeFile(path.join(fx.root, EX_REPORT(2)), (await readFile(path.join(fx.root, EX_REPORT(2)), 'utf8')).replace('先验证高频场景。', '另一个时间的报告。')); }
      return n;
    });
    expect(await view()).toMatchObject({ state: 'unavailable', unavailableReason: 'updating', targets: [] });
    expect((cap.props.report as { markdown: string }).markdown).not.toContain('另一个时间的报告');
    expect(count).toBeLessThanOrEqual(2);
  });
  it.each([false, true])('sidecar changes during loading: bounded retry, continuous=%s', async (continuous) => {
    const fx = await fixture(); const selected = await fx.vault.read(EX_REPORT(2)); const read = fx.vault.read.bind(fx.vault); let count = 0;
    vi.spyOn(fx.vault, 'read').mockImplementation(async (p) => {
      const n = await read(p);
      if (p === EX_PLAN) { count++; if (continuous || count === 1) { const j = explanationJudgment(); j.claims[0].judgment.gaps = [`版本内变更 ${count}`]; await sidecar(fx.root, j); } }
      return n;
    });
    const c = await loadExplanationContext(fx.vault, selected);
    if (continuous) expect(c).toMatchObject({ state: 'unavailable', unavailableReason: 'updating', targets: [] });
    else { expect(c.state).toBe('ready'); expect(c.targets.find((t) => t.token === 'H1')?.recordedGaps).toEqual(['版本内变更 1']); }
    expect(count).toBe(4);
  });
  it('unverified body-recovered sidecar is legacy, not a trusted version snapshot', async () => {
    const fx = await fixture(); await sidecar(fx.root, { ...explanationJudgment(), source: 'body' });
    expect(await view()).toMatchObject({ state: 'unavailable', unavailableReason: 'legacy', targets: [] });
  });
  it('duplicate plan ids do not generate key mappings', async () => {
    const fx = await fixture(); const plan = await readFile(path.join(fx.root, EX_PLAN), 'utf8');
    await writeFile(path.join(fx.root, EX_PLAN), plan.replace('id: C2,', 'id: C1,'));
    const c = await view(); expect(c.state).toBe('ready'); expect(c.targets.map((t) => t.token)).toEqual(['H1', 'H2']);
  });
  it('multiple key mentions are not assigned to one K or copied into its H', async () => {
    const fx = await fixture(); const j = explanationJudgment(); j.summary.gaps[0] = { question: 'K3、K1 共同缺口', missing: '不能只归一处', how: '联合验证' }; await sidecar(fx.root, j);
    const c = await view(); expect(JSON.stringify(c.targets)).not.toContain('不能只归一处');
  });
});
