import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext, executeTool } from '@/lib/harness';
import { DEFAULT_SELECTION, selectionView, writeSelection } from '@/lib/research/selection';
import type { Vault } from '@/lib/vault';
import { FIXTURE, makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const A = '10_资料库/资料甲.md';
const B = '10_资料库/资料乙.md';
const WS = '20_项目/P/WS-A';
const quote = 'IT 可管理性是企业采购 AI PC 的首要考量。';
let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault({ [B]: FIXTURE[A].replaceAll('资料甲', '资料乙').replace('id: src-a', 'id: src-b') }));
});
afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });
const view = (excluded = [A]) => selectionView(vault, { ...DEFAULT_SELECTION, excluded });
const direct = (v: Vault, api: string, p: string) => {
  if (api === 'readTyped') return v.readTyped(p, 'source');
  if (api === 'getBlocks') return v.getBlocks(p);
  if (api === 'readLog') return v.readLog(p);
  return v.read(p);
};

describe('review C3 note-level AI selection', () => {
  for (const api of ['read', 'readTyped', 'getBlocks', 'readLog'] as const) {
    it.each([A, `/${A}`, '10_资料库/./资料甲.md', '10_资料库/nested/../资料甲.md', '10_资料库//资料甲.md'])(`${api} denies path aliases before invoking the content API: %s`, async (p) => {
      const read = vi.spyOn(vault, api);
      await expect(direct(view(), api, p)).rejects.toThrow(/取消|选择|不可读|不可用/);
      expect(read).not.toHaveBeenCalled();
    });
  }

  it('normalizes the selected path too, without broadening a fragment to the whole note', async () => {
    await expect(view(['10_资料库/./资料甲.md']).read(A)).rejects.toThrow();
    expect((await view([`${A}#^c1`]).read(A)).body).toContain(quote);
  });

  it('a resolved excluded link is unavailable, including full paths and aliases', async () => {
    for (const link of ['[[资料甲]]', '[[资料甲#^c1|别名]]', '[[10_资料库/./资料甲]]']) {
      expect(await view().resolveLink(link)).toEqual({ ok: false, error: 'not_found', candidates: [] });
    }
  });

  it('ambiguous candidates never disclose an excluded path or silently retarget the link', async () => {
    await vault.write('10_资料库/同名.md', { frontmatter: (await vault.read(A)).data, body: '甲' });
    await vault.write('20_项目/P/同名.md', { frontmatter: (await vault.read(A)).data, body: '乙' });
    const v = view(['10_资料库/同名.md']);
    const res = await v.resolveLink('[[同名]]');
    expect(res).toEqual({ ok: false, error: 'ambiguous', candidates: ['20_项目/P/同名.md'] });
  });

  it('复核 P1: a citation to an excluded note is checked truthfully, without handing its text back', async () => {
    // Checking that an existing citation is genuine is integrity, not the AI reading the note: a follow-up's self-check
    // must not call a valid citation "missing" because the owner later unticked the source (it did before P1).
    const raw = await vault.checkCitation('[[资料甲#^c1]]', { quote });
    expect(raw.ok).toBe(true);
    const viaView = await view().checkCitation('[[资料甲#^c1]]', { quote });
    expect(viaView).toEqual({ ...raw, blockText: undefined });
    expect(viaView.blockText).toBeUndefined();
    const checks = await view().checkCitations(`“${quote}”[[资料甲#^c1]]`);
    expect(checks.map((c) => [c.ok, c.blockText])).toEqual([[true, undefined]]);
    // review: no quote oracle — a guess is not compared against an unticked note's text
    expect(await view().checkCitation('[[资料甲#^c1]]', { quote: '不匹配的引文' })).toMatchObject({ ok: true, blockText: undefined });
    expect((await view().checkCitation('[[资料甲#^c1]]', { quote: '不匹配的引文' })).error).toBeUndefined();
    expect((await vault.checkCitation('[[资料甲#^c1]]', { quote: '不匹配的引文' })).error).toBe('quote_mismatch');
  });

  it('复核 P1: the frame of the task (contract, project, workspace, plans, logs) is read whatever the selection says', async () => {
    // the fixture has no contract: write one with the contract schema, so the test cannot pass without reading it
    const contract = '20_项目/P/决策契约.md';
    await vault.write(contract, { frontmatter: { id: 'c-p', type: 'contract', status: '推断', created: '2026-10-29', updated: '2026-10-29', author: 'AI', derived_from: ['[[20_项目/P/项目|项目]]'], relates_to: ['[[20_项目/P/项目|项目]]'], question: '问？', decision: '定', decision_owner: 'Senior', horizon: '2027', geography: '全球', product_scope: 'PC', out_of_scope: [], success: '成', known: [], bar: '门槛' }, body: '# 契约\n' });
    const frame = [contract, '20_项目/P/项目.md', `${WS}/workspace.md`, `${WS}/workplan v1.md`, `${WS}/日志.md`];
    const v = view([A, ...frame]);
    for (const p of frame) await expect(v.read(p), p).resolves.toMatchObject({ path: p });
    await expect(v.read(A)).rejects.toThrow(/取消|选择|不可读|不可用/);
  });

  it('allowed direct reads and citation results retain the original Vault semantics', async () => {
    const v = view();
    expect(await v.read(B)).toEqual(await vault.read(B));
    expect(await v.readTyped(B, 'source')).toEqual(await vault.readTyped(B, 'source'));
    expect(await v.getBlocks(B)).toEqual(await vault.getBlocks(B));
    expect(await v.readLog(`${WS}/日志.md`)).toEqual(await vault.readLog(`${WS}/日志.md`));
    for (const link of ['[[资料乙#^c1]]', '[[资料乙#^missing]]', '[[资料乙]]', '[[不存在#^c1]]', 'not a link']) {
      for (const q of [undefined, quote, '不匹配的引文']) expect(await v.checkCitation(link, { quote: q })).toEqual(await vault.checkCitation(link, { quote: q }));
    }
    const text = `“${quote}”[[资料乙#^c1]]\n「预算主要来自 IT 部门。」（原文）[[资料乙#^c2]]\n"不匹配"[[资料乙#^c1]]\n[[资料乙]] [[不存在#^c1]]`;
    expect(await v.checkCitations(text, { fromPath: B })).toEqual(await vault.checkCitations(text, { fromPath: B }));
    expect(v.exists).toBe(vault.exists);
    expect(v.write).toBe(vault.write);
    expect(await v.exists(A)).toBe(true);
  });

  it('the real vault_read request enforces the workspace selection, regardless of file group', async () => {
    // One path may be both a project output and a published asset: the selection has no group-specific bypass.
    const published = `${WS}/调查/R1/报告 v1.md`;
    await vault.write(published, { frontmatter: (await vault.read(A)).data, body: 'PRIVATE OUTPUT' });
    const original = await vault.read(published);
    await writeSelection(vault, ROLES.juniorA, WS, { excluded: [A, published], starred: [], web: true });
    const ctx = { ...(await buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS, track: 'workspace' })), taskContextRead: true };
    const read = vi.spyOn(vault, 'read');
    for (const p of [A, published]) await expect(executeTool('vault_read', { path: p }, ctx)).rejects.toThrow(/取消|选择|不可读|不可用/);
    expect(read).not.toHaveBeenCalled();
    expect(await vault.read(published)).toEqual(original);
  });
});
