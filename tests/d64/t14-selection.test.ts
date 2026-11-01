/** D-64 T14: 资料选择.json decides what the AI reads in a Workspace (excluded, starred, web). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE, makeFixtureVault, ROLES } from '../helpers/fixture-vault';
import { buildToolContext, buildToolsForPhase, executeTool } from '@/lib/harness';
import { ApprovalDenied } from '@/lib/harness/events';
import { loadResearchContext } from '@/lib/research/context';
import { DEFAULT_SELECTION, readSelection, writeSelection } from '@/lib/research/selection';
import type { Vault } from '@/lib/vault';

const WS = '20_项目/P/WS-A';
const A = '10_资料库/资料甲.md';
const B = '10_资料库/资料乙.md';
const C = '10_资料库/资料丙.md';
const src = (id: string, name: string) =>
  FIXTURE[A].replace('id: src-a', `id: ${id}`).replace('# 资料甲', `# ${name}`).replace('https://example.com/a', `https://example.com/${id}`);

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault({ [B]: src('src-b', '资料乙'), [C]: src('src-c', '资料丙') }));
});
afterEach(async () => cleanup());

// the task context counts as read: the T20 gate is tested in t20-task-context
const ctxFor = async (role = ROLES.juniorA) => ({ ...(await buildToolContext({ vault, role, workspacePath: WS, track: 'workspace' })), taskContextRead: true });

describe('T14 selection', () => {
  it('1. no file: the default (everything in, nothing starred, web on)', async () => {
    expect(await readSelection(vault, WS)).toEqual(DEFAULT_SELECTION);
    expect(DEFAULT_SELECTION).toEqual({ version: 1, excluded: [], starred: [], web: true });
  });

  it('2. only the Workspace owner writes it; it reads back', async () => {
    await expect(writeSelection(vault, ROLES.juniorB, WS, { excluded: [A], starred: [], web: true })).rejects.toBeInstanceOf(ApprovalDenied);
    await writeSelection(vault, ROLES.juniorA, WS, { excluded: [A], starred: [C], web: false });
    expect(await readSelection(vault, WS)).toEqual({ version: 1, excluded: [A], starred: [C], web: false });
  });

  it('3. an excluded source is not in the research catalog, the internal search or vault_search', async () => {
    await writeSelection(vault, ROLES.juniorA, WS, { excluded: [A], starred: [], web: true });
    const ctx = await ctxFor();
    const catalog = (await loadResearchContext(ctx)).sources.map((s) => s.path);
    expect(catalog).toEqual(expect.arrayContaining([B, C]));
    expect(catalog).not.toContain(A);
    expect((await ctx.vault.search({ query: 'IT 采购', types: ['source'] })).map((h) => h.path)).not.toContain(A);
    const out = (await executeTool('vault_search', { query: 'IT 采购', types: ['source'] }, ctx)) as { hits: { path: string }[] };
    expect(out.hits.map((h) => h.path)).toEqual(expect.arrayContaining([B, C]));
    expect(out.hits.map((h) => h.path)).not.toContain(A);
  });

  it('4. a starred source comes first in search results and in the catalog', async () => {
    // without a star the order is 丙, 乙, 甲 (search) and 丙, 甲, 乙 (catalog): 乙 is never first on its own
    await writeSelection(vault, ROLES.juniorA, WS, { excluded: [], starred: [B], web: true });
    const ctx = await ctxFor();
    expect((await ctx.vault.search({ query: 'IT 采购', types: ['source'] }))[0].path).toBe(B);
    expect((await loadResearchContext(ctx)).sources[0].path).toBe(B);
  });

  it('5. web: false — research_execute gets no web_search and no web_fetch', async () => {
    const on = { ...(await ctxFor()), phase: 'research_execute' as const };
    expect(Object.keys(buildToolsForPhase(on))).toEqual(expect.arrayContaining(['web_search', 'web_fetch']));
    await writeSelection(vault, ROLES.juniorA, WS, { excluded: [], starred: [], web: false });
    const off = { ...(await ctxFor()), phase: 'research_execute' as const };
    const names = Object.keys(buildToolsForPhase(off));
    expect(names).toContain('vault_search');
    expect(names).not.toContain('web_search');
    expect(names).not.toContain('web_fetch');
  });
});
