/** Reference search: rare words count more, and each extra phrase is searched on its own (round 3 of the eval: the right notes were not in the pack). */
import { afterEach, describe, expect, it } from 'vitest';
import { buildPack, REFERENCE_DIR } from '@/lib/workplan/compose/pack';
import { makeM1Vault } from '../helpers';

const PROJECT = '20_项目/P';
const fm = `---\nid: x\ntype: knowledge\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: Senior\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\n---\n`;
const note = (body: string) => `${fm}# t\n\n${body}\n`;

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((f) => f()));
  cleanups = [];
});

async function packOf(files: Record<string, string>, query: string, queries?: string[], max?: number) {
  const { vault, cleanup } = await makeM1Vault(Object.fromEntries(Object.entries(files).map(([name, body]) => [`${REFERENCE_DIR}/${name}.md`, note(body)])));
  cleanups.push(cleanup);
  const pack = await buildPack({ vault, projectPath: PROJECT, query, queries, maxReferences: max });
  return pack.filter((i) => i.kind === 'reference').map((i) => i.title);
}

describe('buildPack reference search', () => {
  it('a rare word beats a word every note has', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`通用${i}`] = '企业 采购 预算 管理 说明';
    files['罕见'] = '企业 采购 订阅 影子';
    const titles = await packOf(files, '企业采购预算管理订阅影子', undefined, 1);
    expect(titles).toEqual(['罕见']);
  });

  it('an extra phrase finds a note the main query misses, and every query keeps a place in the result', async () => {
    const files: Record<string, string> = {
      'Shadow AI survey': 'shadow ai employees personal accounts',
      主要一: '员工 订阅 付费 意愿',
      主要二: '员工 订阅 付费 调查',
      主要三: '员工 订阅 付费 报告',
    };
    expect(await packOf(files, '员工订阅付费', undefined, 2)).not.toContain('Shadow AI survey');
    expect(await packOf(files, '员工订阅付费', ['shadow ai employees'], 2)).toContain('Shadow AI survey');
  });

  it('no duplicates when two queries find the same note, and the cap holds', async () => {
    const files = { 甲: '员工 订阅 付费', 乙: '员工 订阅 费用', 丙: '员工 订阅 价格' };
    const titles = await packOf(files, '员工订阅', ['员工订阅'], 3);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.length).toBeLessThanOrEqual(3);
  });
});

describe('buildPack with the bilingual library index', () => {
  it('a Chinese phrase finds an English-titled note through the index, and the user\'s whole sentence does not use it', async () => {
    const files = { 'Dell Pro AI': 'completely unrelated english body text', 通用: '员工 订阅 付费' };
    const { vault, cleanup } = await makeM1Vault({
      ...Object.fromEntries(Object.entries(files).map(([name, body]) => [`${REFERENCE_DIR}/${name}.md`, note(body)])),
    });
    cleanups.push(cleanup);
    const { mkdir, writeFile } = await import('node:fs/promises');
    const path = await import('node:path');
    await mkdir(path.join(vault.root, '90_配置'), { recursive: true });
    await writeFile(
      path.join(vault.root, '90_配置/资料索引.json'),
      JSON.stringify({ version: 1, generated_at: 'x', entries: [{ path: `${REFERENCE_DIR}/Dell Pro AI.md`, title: 'Dell Pro AI', summary_zh: '戴尔商用 AI PC 的管理能力', summary_en: 'Dell commercial AI PC management', keywords: ['戴尔', '管理'], generated_at: 'x' }] }),
    );
    const titles = async (query: string, queries: string[]) => (await buildPack({ vault, projectPath: PROJECT, query, queries, maxReferences: 2 })).filter((i) => i.kind === 'reference').map((i) => i.title);
    expect(await titles('员工订阅', ['戴尔 管理能力'])).toEqual(expect.arrayContaining(['Dell Pro AI']));
    expect(await titles('员工订阅', [])).toEqual(['通用']);
  });
});
