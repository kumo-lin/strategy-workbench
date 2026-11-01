/**
 * Guard for everyone who edits demo-vault/ (milestone C included): every note
 * must pass its schema, every derived_from / relates_to link must resolve, and
 * every [[note#^cN]] citation must point at an existing block.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadModelsConfig } from '@/lib/config/models';
import { loadRoles } from '@/lib/config/roles';
import { createVault, parseWikiLink } from '@/lib/vault';

const vault = createVault(path.join(process.cwd(), 'demo-vault'));

describe('demo-vault integrity', async () => {
  const files = (await vault.list('', { recursive: true })).filter((e) => e.kind === 'file');

  it('has the PRD §9.1 top-level folders', async () => {
    expect((await vault.list()).map((e) => e.name)).toEqual(['00_团队知识', '10_资料库', '20_项目', '90_配置']);
  });

  it.each(files.map((f) => f.path))('%s is valid and fully linked', async (p) => {
    const n = await vault.read(p);
    expect(n.issues, n.issues.join('\n')).toEqual([]);
    const note = n.note!;
    expect(note.derived_from.length, 'derived_from is empty').toBeGreaterThan(0);
    expect(note.relates_to.length, 'relates_to is empty').toBeGreaterThan(0);
    for (const l of [...note.derived_from, ...note.relates_to]) {
      const r = await vault.resolveLink(parseWikiLink(l)!, p);
      expect(r.ok, `${l} → ${JSON.stringify(r)}`).toBe(true);
    }
    const bad = (await vault.checkCitations(n.body, { fromPath: p })).filter((c) => !c.ok);
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });

  it('config notes load', async () => {
    const models = await loadModelsConfig(vault);
    expect(models.providers[models.active]).toBeDefined();
    expect((await loadRoles(vault)).map((r) => r.id)).toEqual(['senior', 'junior-a', 'junior-b']);
  });
});
