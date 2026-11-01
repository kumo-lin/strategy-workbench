/** T55-1: independent M1 starting state and upload-only interview layer. */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createVault } from '@/lib/vault';

const root = path.resolve('tests/fixtures/e2e-vault-m1');
const overlay = path.resolve('tests/fixtures/e2e-vault-m1-interviews');
it('starts with an inferred contract, no M1 report or interview, and no preloaded web results', async () => {
  expect(existsSync(root)).toBe(true);
  const vault = createVault(root);
  const contract = await vault.readTyped('20_项目/个人AI战略/决策契约.md', 'contract');
  expect(contract.note.status).toBe('推断');
  expect(contract.note.approved_by).toBeNull();
  const files = await readdir(path.join(root, '20_项目/个人AI战略'), { recursive: true });
  expect(files.filter((p) => /报告 v\d|访谈\//.test(p))).toEqual([]);
  const sources = await readdir(path.join(root, '10_资料库'));
  expect(sources.some((p) => /Gartner|Recon/.test(p))).toBe(false);
  for (const name of ['Pew', 'Qira', 'Ping Identity', 'TechRadar']) expect(sources.some((p) => p.includes(name))).toBe(true);
  const index = JSON.parse(await readFile(path.join(root, '90_配置/资料索引.json'), 'utf8'));
  expect(JSON.stringify(index)).not.toContain('Gartner');
});
it('provides three simulated interview notes as a separate upload layer', async () => {
  expect(existsSync(overlay)).toBe(true);
  const dir = '20_项目/个人AI战略/访谈';
  const files = await readdir(path.join(overlay, dir));
  expect(files).toHaveLength(3);
  const vault = createVault(overlay);
  for (const file of files) expect((await vault.readTyped(`${dir}/${file}`, 'meeting')).note).toMatchObject({ kind: '访谈', simulated: true });
});

it('the upstream M1 TechRadar association resolves, so regenerating the fixture cannot restore the old workspace link', async () => {
  const source = '10_资料库/TechRadar 2025-07 企业并不急着买AI PC.md';
  const upstream = createVault(path.resolve('demo-vault/.snapshots/m1-qira'));
  const note = await upstream.read(source);
  expect(note.note!.relates_to).toEqual(['[[20_项目/个人AI战略/项目|项目]]']);
  expect((await upstream.resolveLink(note.note!.relates_to[0], source)).ok).toBe(true);
  expect((await createVault(root).read(source)).body).toBe(note.body);
});
