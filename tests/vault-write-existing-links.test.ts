/**
 * `vault.write` on overwrite: the derived_from / relates_to check covers only links
 * that are new in this version — a shared note may keep its (now ambiguous) `[[项目]]` (D-56).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from './helpers/fixture-vault';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

const Q_PROJECT = `---
id: proj-q
type: project
status: 已确认
created: "2026-10-24"
updated: "2026-10-24"
author: Senior
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
owner: Senior
sponsor: VP
core_question: 问题？
roadmap: [{ week: W2, topic: 买单 }]
dependencies: []
---
# 项目
`;

/** A shared source note (outside any project folder) that links the ambiguous `[[项目]]`. */
const YI = `---
id: src-b
type: source
status: 推断
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[团队]]"]
relates_to: ["[[项目]]"]
url: "https://example.com/b"
publisher: 示例机构
published: "2026-09-01"
retrieved: "2026-10-24"
origin: 网络
grade: B
graded_by: AI
authority: 3
link_checked: true
---
# 资料乙

## 论断

- 「旧论断」 ^c1
`;

/** A raw source note whose relates_to is a string, not a link array. */
const BAD = YI.replace('id: src-b', 'id: src-bad').replace('relates_to: ["[[项目]]"]', 'relates_to: "[[项目]]"');

const EXTRA: Record<string, string> = {
  '20_项目/Q/项目.md': Q_PROJECT,
  '10_资料库/资料乙.md': YI,
  '10_资料库/坏的.md': BAD,
};

async function fixture(): Promise<{ vault: Vault; root: string }> {
  const { vault, root, cleanup } = await makeFixtureVault(EXTRA);
  cleanups.push(cleanup);
  return { vault, root };
}

async function rejection(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error('expected the write to reject');
}

const SHARED = '10_资料库/资料乙.md';

describe('write: overwrite checks only links new in this version', () => {
  it('1. appending a claim keeps the old ambiguous link', async () => {
    const { vault } = await fixture();
    const n = await vault.read(SHARED);
    const written = await vault.write(
      SHARED,
      { frontmatter: n.data, body: `${n.body}\n- 「新论断」 ^c2\n` },
      { overwrite: true },
    );
    expect(written.data.relates_to).toEqual(['[[项目]]']);
    expect([...(await vault.getBlocks(SHARED)).keys()].sort()).toEqual(['c1', 'c2']);
  });

  it('2. sanity: `[[项目]]` from a shared note is still ambiguous', async () => {
    const { vault } = await fixture();
    expect(await vault.resolveLink('[[项目]]', SHARED)).toMatchObject({ ok: false, error: 'ambiguous' });
  });

  it('3. a new ambiguous link in the same write is refused, and the file is untouched', async () => {
    const { vault, root } = await fixture();
    const n = await vault.read(SHARED);
    const before = await readFile(path.join(root, SHARED), 'utf8');
    const err = await rejection(
      vault.write(
        SHARED,
        { frontmatter: { ...n.data, relates_to: ['[[项目]]', '[[workspace]]'] }, body: n.body },
        { overwrite: true },
      ),
    );
    expect(err).toMatchObject({ code: 'links_unresolved' });
    expect(err.message).toContain('[[workspace]]');
    expect(err.message).not.toContain('[[项目]] (');
    expect(await readFile(path.join(root, SHARED), 'utf8')).toBe(before);
  });

  it('4. a new broken link is refused, and the file is untouched', async () => {
    const { vault, root } = await fixture();
    const n = await vault.read(SHARED);
    const before = await readFile(path.join(root, SHARED), 'utf8');
    const oldDerived = n.data.derived_from as string[];
    const err = await rejection(
      vault.write(
        SHARED,
        { frontmatter: { ...n.data, derived_from: [...oldDerived, '[[不存在的笔记]]'] }, body: n.body },
        { overwrite: true },
      ),
    );
    expect(err).toMatchObject({ code: 'links_unresolved' });
    expect(await readFile(path.join(root, SHARED), 'utf8')).toBe(before);
  });

  it('5. a new block link to a missing block is refused', async () => {
    const { vault } = await fixture();
    const n = await vault.read(SHARED);
    const before_relates = n.data.relates_to as string[];
    const err = await rejection(
      vault.write(
        SHARED,
        { frontmatter: { ...n.data, relates_to: [...before_relates, '[[资料甲#^c99]]'] }, body: n.body },
        { overwrite: true },
      ),
    );
    expect(err).toMatchObject({ code: 'links_unresolved' });
  });

  it('6. an alias change is not a new link', async () => {
    const { vault } = await fixture();
    const n = await vault.read(SHARED);
    const written = await vault.write(
      SHARED,
      { frontmatter: { ...n.data, relates_to: ['[[项目|项目]]'] }, body: n.body },
      { overwrite: true },
    );
    expect(written.data.relates_to).toEqual(['[[项目|项目]]']);
  });

  it('7. moving a link between fields is not new', async () => {
    const { vault } = await fixture();
    const n = await vault.read(SHARED);
    await vault.write(
      SHARED,
      { frontmatter: { ...n.data, derived_from: ['[[项目]]'], relates_to: n.data.derived_from as string[] }, body: n.body },
      { overwrite: true },
    );
    expect(await vault.exists(SHARED)).toBe(true);
  });

  it('8. new files are fully checked', async () => {
    const { vault } = await fixture();
    const n = await vault.read(SHARED);
    const err = await rejection(
      vault.write('10_资料库/资料丙.md', { frontmatter: { ...n.data, id: 'src-c' }, body: '# 资料丙\n' }),
    );
    expect(err).toMatchObject({ code: 'links_unresolved' });
    expect(await vault.exists('10_资料库/资料丙.md')).toBe(false);
  });

  it('9. overwrite flag missing is refused and the file is untouched', async () => {
    const { vault, root } = await fixture();
    const n = await vault.read(SHARED);
    const before = await readFile(path.join(root, SHARED), 'utf8');
    const err = await rejection(vault.write(SHARED, { frontmatter: n.data, body: `${n.body}\n- 「新论断」 ^c2\n` }));
    expect(['exists', 'links_unresolved']).toContain(err.code);
    expect(await readFile(path.join(root, SHARED), 'utf8')).toBe(before);
  });

  it('10. an existing file without link arrays treats nothing as pre-existing', async () => {
    const { vault } = await fixture();
    const n = await vault.read(SHARED);
    const err = await rejection(
      vault.write(
        '10_资料库/坏的.md',
        { frontmatter: { ...n.data, id: 'src-bad', relates_to: ['[[项目]]'] }, body: n.body },
        { overwrite: true },
      ),
    );
    expect(err).toMatchObject({ code: 'links_unresolved' });
  });

  it('11. inside a project, a new `[[项目]]` resolves to the project itself', async () => {
    const { vault } = await fixture();
    const q = await vault.read('20_项目/Q/项目.md');
    const written = await vault.write(
      '20_项目/Q/项目.md',
      { frontmatter: { ...q.data, relates_to: ['[[团队]]', '[[项目]]'] }, body: q.body },
      { overwrite: true },
    );
    expect(written.data.relates_to).toEqual(['[[团队]]', '[[项目]]']);
  });
});
