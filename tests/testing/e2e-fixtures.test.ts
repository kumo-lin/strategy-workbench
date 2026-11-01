/** The e2e vault snapshots must stay valid vaults (same checks as tests/demo-vault.test.ts), including the post-G1 overlay. */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadModelsConfig } from '@/lib/config/models';
import { loadRoles } from '@/lib/config/roles';
import { isTreePlan, treeChecks } from '@/lib/research/question-tree';
import { createVault, parseWikiLink } from '@/lib/vault';

const FIXTURES = path.join(process.cwd(), 'tests/fixtures');
const SNAPSHOTS = { 'e2e-vault': ['e2e-vault'], 'e2e-vault-g1': ['e2e-vault', 'e2e-vault-g1'], 'e2e-vault-g1-plan': ['e2e-vault', 'e2e-vault-g1', 'e2e-vault-g1-plan'], 'e2e-vault-segment3': ['e2e-vault', 'e2e-vault-g1', 'e2e-vault-g1-plan', 'e2e-vault-segment3'], 'e2e-vault-demo': ['e2e-vault', 'e2e-vault-segment3', 'e2e-vault-demo'], 'e2e-vault-m1': ['e2e-vault-m1'], 'e2e-vault-m1-interviews': ['e2e-vault-m1', 'e2e-vault-m1-interviews'] };
const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

for (const [name, layers] of Object.entries(SNAPSHOTS)) {
  describe(`${name} snapshot`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-e2e-fixture-'));
    roots.push(root);
    for (const layer of layers) await cp(path.join(FIXTURES, layer), root, { recursive: true });
    const vault = createVault(root);
    const files = (await vault.list('', { recursive: true })).filter((e) => e.kind === 'file');

    it.each(files.map((f) => f.path))('%s is valid and fully linked', async (p) => {
      const n = await vault.read(p);
      expect(n.issues, n.issues.join('\n')).toEqual([]);
      for (const l of [...n.note!.derived_from, ...n.note!.relates_to]) {
        const r = await vault.resolveLink(parseWikiLink(l)!, p);
        expect(r.ok, `${l} → ${JSON.stringify(r)}`).toBe(true);
      }
      expect((await vault.checkCitations(n.body, { fromPath: p })).filter((c) => !c.ok)).toEqual([]);
    });

    // D-39: the plans the specs start from are question trees that pass the checks the approve route runs
    it('has its research plans as question trees that pass treeChecks', async () => {
      for (const p of files.map((f) => f.path).filter((f) => /\/计划 v\d+\.md$/.test(f))) {
        const plan = (await vault.read(p)).note;
        if (plan?.type !== 'research_plan') continue;
        expect(isTreePlan(plan), `${p} has no question on its claims`).toBe(true);
        expect(treeChecks(plan), p).toEqual([]);
      }
    });

    it('has the config the app needs and two workspaces owned by different Juniors', async () => {
      expect((await loadModelsConfig(vault)).providers).toBeDefined();
      expect((await loadRoles(vault)).map((r) => r.id)).toEqual(['senior', 'junior-a', 'junior-b']);
      const m1 = name.startsWith('e2e-vault-m1');
      const a = await vault.readTyped(`20_项目/个人AI战略/${m1 ? 'M1 用户持续使用' : 'WS-A 买方'}/workspace.md`, 'workspace');
      const b = await vault.readTyped(`20_项目/个人AI战略/${m1 ? 'L2 凭什么赢' : 'WS-B 用户'}/workspace.md`, 'workspace');
      expect([a.note.owner, b.note.owner]).toEqual(m1 ? ['分析师甲', '分析师乙'] : ['Junior A', 'Junior B']);
      expect(a.note.stage).toBe(m1 || name === 'e2e-vault' || name === 'e2e-vault-demo' ? '拆题中' : '执行中');
    });
  });
}
