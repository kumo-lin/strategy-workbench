import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { relinkUnresolved, vaultIntegrity } from '../../scripts/demo-snapshot-relink';
import { makeFixtureVault } from '../helpers/fixture-vault';

/** A valid knowledge note: the fixture has `20_项目/P/项目.md`, so `[[项目]]` resolves. */
const note = (id: string, derived: string, relates: string, body = '# 笔记\n') =>
  `---
id: ${id}
type: knowledge
status: 推断
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ${derived}
relates_to: ${relates}
kind: method
approved_by: null
origin_project: null
---

${body}`;

describe('relinkUnresolved', () => {
  it('repoints an unresolved link and changes nothing else', async () => {
    const { vault, cleanup } = await makeFixtureVault({
      '20_项目/P/笔记.md': note('test-relink', '["[[不存在的计划]]"]', '["[[项目]]"]'),
    });
    try {
      const before = await vault.read('20_项目/P/笔记.md');
      const result = await relinkUnresolved(vault, '[[项目]]');
      const after = await vault.read('20_项目/P/笔记.md');

      expect(after.data.derived_from).toEqual(['[[项目]]']);
      expect(after.data.relates_to).toEqual(['[[项目]]']);
      expect(after.body).toBe(before.body);
      const { derived_from: _bd, relates_to: _br, ...restBefore } = before.data;
      const { derived_from: _ad, relates_to: _ar, ...restAfter } = after.data;
      expect(restAfter).toEqual(restBefore);
      expect(result).toEqual([{ path: '20_项目/P/笔记.md', replaced: ['[[不存在的计划]]'] }]);
    } finally {
      await cleanup();
    }
  });

  it('does not rewrite bytes when every link resolves', async () => {
    const { vault, root, cleanup } = await makeFixtureVault();
    try {
      const file = path.join(root, '90_配置/团队.md');
      const before = await fs.readFile(file);
      const result = await relinkUnresolved(vault, '[[项目]]');

      expect(result).toEqual([]);
      expect(await fs.readFile(file)).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  it('drops duplicates, keeping the first occurrence', async () => {
    const { vault, cleanup } = await makeFixtureVault({
      '20_项目/P/笔记.md': note('test-dedupe', '["[[项目]]"]', '["[[项目]]", "[[缺的A]]", "[[缺的B]]"]'),
    });
    try {
      const result = await relinkUnresolved(vault, '[[项目]]');
      const after = await vault.read('20_项目/P/笔记.md');

      expect(after.data.relates_to).toEqual(['[[项目]]']);
      expect(result.find((r) => r.path === '20_项目/P/笔记.md')?.replaced).toEqual(['[[缺的A]]', '[[缺的B]]']);
    } finally {
      await cleanup();
    }
  });
});

describe('vaultIntegrity', () => {
  it('reports a clean fixture as clean', async () => {
    const { vault, cleanup } = await makeFixtureVault();
    try {
      expect(await vaultIntegrity(vault)).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('reports an unresolved link and a bad citation', async () => {
    const { vault, cleanup } = await makeFixtureVault({
      '20_项目/P/坏笔记.md': note('test-broken', '["[[项目]]"]', '["[[缺的]]"]', '见 [[资料甲#^c99]]\n'),
    });
    try {
      const entry = (await vaultIntegrity(vault)).find((r) => r.path === '20_项目/P/坏笔记.md');
      expect(entry?.problems).toContain('link [[缺的]]');
      expect(entry?.problems).toContain('citations 1');
    } finally {
      await cleanup();
    }
  });
});
