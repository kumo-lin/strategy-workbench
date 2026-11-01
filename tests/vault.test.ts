import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBlocks, VaultError, watchVault, type Vault } from '@/lib/vault';
import { makeFixtureVault } from './helpers/fixture-vault';

let vault: Vault;
let root: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ vault, root, cleanup } = await makeFixtureVault());
});
afterEach(async () => cleanup());

const hypothesis = (over: Record<string, unknown> = {}) => ({
  id: 'ws-a-h1',
  type: 'hypothesis',
  status: '进行中',
  created: '2026-10-24',
  updated: '2026-10-24T10:00:00.000Z',
  author: 'AI',
  derived_from: ['[[20_项目/P/WS-A/workplan v1]]'],
  relates_to: ['[[20_项目/P/WS-A/workspace|WS-A]]'],
  workspace: '[[20_项目/P/WS-A/workspace|WS-A]]',
  statement: 'IT 能管才买',
  verdict_proposed: null,
  verdict: null,
  evidence: ['[[资料甲#^c1]]'],
  counter_evidence: [],
  ...over,
});

describe('list / read / tree', () => {
  it('lists notes and folders, hiding dot-entries', async () => {
    const top = await vault.list();
    expect(top.map((e) => e.name)).toEqual(['10_资料库', '20_项目', '90_配置']);
    const all = await vault.list('', { recursive: true });
    expect(all.some((e) => e.path.includes('.obsidian'))).toBe(false);
    expect(all.filter((e) => e.kind === 'file')).toHaveLength(10);
  });

  it('reads and validates a note', async () => {
    const n = await vault.read('10_资料库/资料甲.md');
    expect(n.title).toBe('资料甲');
    expect(n.note?.type).toBe('source');
    expect(n.issues).toEqual([]);
    expect(n.data.published).toBe('2026-09-01'); // dates stay strings
  });

  it('builds a nested tree', async () => {
    const tree = await vault.tree();
    const proj = tree.find((n) => n.name === '20_项目')!;
    expect(proj.children?.[0].children?.map((c) => c.name)).toEqual(['WS-A', 'WS-B', '项目.md']);
  });

  it('rejects paths escaping the vault', async () => {
    await expect(vault.read('../etc/passwd.md')).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(vault.read('.obsidian/app.json')).rejects.toMatchObject({ code: 'invalid_path' });
  });
});

describe('search', () => {
  it('matches all keywords, case-insensitively', async () => {
    const hits = await vault.search({ query: 'IT 采购' });
    expect(hits.map((h) => h.path)).toEqual(['10_资料库/资料甲.md']);
    expect(hits[0].snippets.length).toBeGreaterThan(0);
  });

  it('filters by frontmatter and type', async () => {
    expect((await vault.search({ where: { grade: ['A', 'B'] } })).map((h) => h.title)).toEqual(['资料甲']);
    expect((await vault.search({ where: { grade: 'A' } }))).toHaveLength(0);
    expect((await vault.search({ types: ['workspace'] })).map((h) => h.path).sort()).toEqual([
      '20_项目/P/WS-A/workspace.md',
      '20_项目/P/WS-B/workspace.md',
    ]);
    expect((await vault.search({ where: { stage: '执行中' } })).map((h) => h.path)).toEqual(['20_项目/P/WS-B/workspace.md']);
  });
});

describe('write: atomic + link fields', () => {
  const target = '20_项目/P/假设/WS-A-H1.md';

  it('writes a valid note and leaves no temp files', async () => {
    const n = await vault.write(target, { frontmatter: hypothesis(), body: '# H1\n' });
    expect(n.note?.type).toBe('hypothesis');
    const files = await readdir(path.join(root, '20_项目/P/假设'));
    expect(files).toEqual(['WS-A-H1.md']);
    const text = await readFile(path.join(root, target), 'utf8');
    expect(text).toContain('derived_from:\n  - "[[20_项目/P/WS-A/workplan v1]]"');
    expect((await vault.read(target)).note).not.toBeNull();
  });

  it('rejects empty derived_from or relates_to', async () => {
    await expect(vault.write(target, { frontmatter: hypothesis({ derived_from: [] }), body: '' })).rejects.toMatchObject({
      code: 'links_missing',
    });
    await expect(vault.write(target, { frontmatter: hypothesis({ relates_to: [] }), body: '' })).rejects.toMatchObject({
      code: 'links_missing',
    });
    expect(await vault.exists(target)).toBe(false);
  });

  it('rejects missing link fields and non-wikilink values as validation errors', async () => {
    const { derived_from: _d, ...noDerived } = hypothesis();
    await expect(vault.write(target, { frontmatter: noDerived, body: '' })).rejects.toMatchObject({ code: 'validation' });
    await expect(vault.write(target, { frontmatter: hypothesis({ relates_to: ['WS-A'] }), body: '' })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('rejects links to notes or blocks that do not exist', async () => {
    await expect(
      vault.write(target, { frontmatter: hypothesis({ derived_from: ['[[不存在的笔记]]'] }), body: '' }),
    ).rejects.toMatchObject({ code: 'links_unresolved' });
    await expect(
      vault.write(target, { frontmatter: hypothesis({ relates_to: ['[[资料甲#^c99]]'] }), body: '' }),
    ).rejects.toMatchObject({ code: 'links_unresolved' });
    // basename that exists twice (workspace.md) must be path-qualified
    await expect(
      vault.write(target, { frontmatter: hypothesis({ relates_to: ['[[workspace]]'] }), body: '' }),
    ).rejects.toThrow(/ambiguous/);
  });

  it('refuses to overwrite unless asked', async () => {
    await vault.write(target, { frontmatter: hypothesis(), body: 'v1' });
    await expect(vault.write(target, { frontmatter: hypothesis(), body: 'v2' })).rejects.toMatchObject({ code: 'exists' });
    await vault.write(target, { frontmatter: hypothesis(), body: 'v2' }, { overwrite: true });
    expect((await vault.read(target)).body.trim()).toBe('v2');
  });

  it('keeps the old file intact when the rename step fails', async () => {
    await vault.write(target, { frontmatter: hypothesis(), body: 'original' });
    const fs = await import('node:fs');
    const spy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk full'));
    await expect(vault.write(target, { frontmatter: hypothesis(), body: 'new' }, { overwrite: true })).rejects.toThrow('disk full');
    spy.mockRestore();
    expect((await vault.read(target)).body.trim()).toBe('original');
    expect(await readdir(path.join(root, '20_项目/P/假设'))).toEqual(['WS-A-H1.md']);
  });

  it('rejects frontmatter that fails the type schema', async () => {
    const err = await vault.write(target, { frontmatter: hypothesis({ verdict: '大概成立' }), body: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(VaultError);
    expect(err.code).toBe('validation');
    expect(err.message).toContain('verdict');
  });
});

describe('block references', () => {
  it('parses list, paragraph and standalone markers, skipping code fences', () => {
    const blocks = parseBlocks(
      ['- 「列表项」 ^c1', '', '第一行', '第二行 ^c2', '', '上面一段', '^c3', '', '```', 'x ^c9', '```', '> 引用 ^q1'].join('\n'),
    );
    expect([...blocks.keys()]).toEqual(['c1', 'c2', 'c3', 'q1']);
    expect(blocks.get('c1')!.text).toBe('「列表项」');
    expect(blocks.get('c2')!.text).toBe('第一行 第二行');
    expect(blocks.get('c3')!.text).toBe('上面一段');
    expect(blocks.get('q1')!.text).toBe('引用');
  });

  it('checks a citation exists', async () => {
    expect(await vault.checkCitation('[[资料甲#^c1]]')).toMatchObject({ ok: true, path: '10_资料库/资料甲.md' });
    expect(await vault.checkCitation('[[资料甲#^c9]]')).toMatchObject({ ok: false, error: 'block_not_found' });
    expect(await vault.checkCitation('[[资料乙#^c1]]')).toMatchObject({ ok: false, error: 'note_not_found' });
    expect(await vault.checkCitation('[[资料甲]]')).toMatchObject({ ok: false, error: 'block_not_found' });
  });

  it('checks every citation in a text, including the quote before a link', async () => {
    const report = [
      '- 论断一（B 级，网络）[[资料甲#^c1]]',
      '- “预算主要来自 IT 部门” [[资料甲#^c2|资料甲]]',
      '- “预算主要来自业务部门” [[资料甲#^c2]]',
      '- 引用了不存在的块 [[资料甲#^c7]]',
      '- 普通链接不算引用 [[项目]]',
    ].join('\n');
    const results = await vault.checkCitations(report);
    expect(results.map((r) => [r.block, r.ok, r.error ?? null])).toEqual([
      ['c1', true, null],
      ['c2', true, null],
      ['c2', false, 'quote_mismatch'],
      ['c7', false, 'block_not_found'],
    ]);
  });
});

describe('log', () => {
  it('appends rows and reads them back, escaping pipes', async () => {
    const log = '20_项目/P/WS-A/日志.md';
    await vault.appendLog(log, { time: 't1', actor: 'AI', action: 'tool:vault_search', change: 'a | b', reason: '因为\n换行' });
    await vault.appendLog(log, { time: 't2', actor: 'Senior', action: 'event:review.approve', change: '通过 G1', reason: '' });
    const rows = await vault.readLog(log);
    expect(rows).toEqual([
      { time: 't1', actor: 'AI', action: 'tool:vault_search', change: 'a | b', reason: '因为 换行' },
      { time: 't2', actor: 'Senior', action: 'event:review.approve', change: '通过 G1', reason: '' },
    ]);
  });

  it('refuses to append to a non-log note', async () => {
    await expect(vault.appendLog('10_资料库/资料甲.md', { time: 't', actor: 'AI', action: 'x', change: '', reason: '' })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});

describe('watch', () => {
  it('reports changed files and ignores hidden/temp files', async () => {
    const seen: string[] = [];
    const stop = watchVault(root, (c) => seen.push(c.path), 30);
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(path.join(root, '10_资料库/.x.tmp'), 'tmp');
    await writeFile(path.join(root, '10_资料库/资料甲.md'), (await readFile(path.join(root, '10_资料库/资料甲.md'), 'utf8')) + '\n');
    await vi.waitFor(() => expect(seen).toContain('10_资料库/资料甲.md'), { timeout: 3000 });
    stop();
    expect(seen.some((p) => p.endsWith('.tmp'))).toBe(false);
  });
});

describe('search ranking (an extra keyword never empties a search)', () => {
  it('ranks notes by how many keywords they contain; all-keyword matches first; non-matches excluded', async () => {
    const hits = await vault.search({ query: 'IT 采购 不存在的词' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe('10_资料库/资料甲.md'); // the note that has the most of them
    expect(hits[0].matched).toBe(2);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].matched).toBeGreaterThanOrEqual(hits[i].matched);
    expect(await vault.search({ query: '完全不存在的词一 完全不存在的词二' })).toEqual([]);
    const all = await vault.search({ query: 'IT 采购' });
    expect(all[0].matched).toBe(2);
  });
});
