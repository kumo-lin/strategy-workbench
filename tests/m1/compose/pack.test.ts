/** m1_5a: the pack — the notes a decomposition is checked against, with stable K ids. */
import { afterEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/lib/vault';
import { buildPack, keywordsOf, mergePack, POLICY_DIR, REFERENCE_DIR } from '@/lib/workplan/compose/pack';
import type { PackItem } from '@/lib/workplan/compose/types';
import { makeM1Vault } from '../helpers';

const PROJECT = '20_项目/P';

const fm = (fields: string) =>
  `---\nid: x\ntype: knowledge\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: Senior\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\n${fields}\n---\n`;

let cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((f) => f()));
  cleanups = [];
});

async function vaultWith(extra: Record<string, string> = {}): Promise<Vault> {
  const { vault, cleanup } = await makeM1Vault(extra);
  cleanups.push(cleanup);
  return vault;
}

describe('buildPack', () => {
  it('one directive item per anchored block of every meeting note, in note order', async () => {
    const long = '长'.repeat(90);
    const vault = await vaultWith({
      [`${PROJECT}/会议/2026-10-20 周会.md`]: `${fm('status: 已确认')}# 周会\n\n- 第一条指示 ^m1\n- 第二条指示 ^m2\n- ${long} ^m3\n`,
    });
    const pack = await buildPack({ vault, projectPath: PROJECT, query: '' });
    expect(pack).toHaveLength(3);
    expect(pack.map((i) => i.id)).toEqual(['K1', 'K2', 'K3']);
    expect(pack[0]).toMatchObject({
      kind: 'directive',
      title: '2026-10-20 周会',
      path: `${PROJECT}/会议/2026-10-20 周会.md`,
      block: '^m1',
      gist: '第一条指示',
    });
    expect(pack[1]).toMatchObject({ block: '^m2', gist: '第二条指示' });
    expect(pack[2].gist.endsWith('…')).toBe(true);
    expect(pack[2].gist).toHaveLength(81);
  });

  it('only confirmed decisions, with the reason as the gist', async () => {
    const vault = await vaultWith({
      [`${PROJECT}/决策/预算决策.md`]: `${fm('status: 已确认\nreason: 预算够')}# 预算决策\n\n正文。\n`,
      [`${PROJECT}/决策/推断决策.md`]: `${fm('status: 推断\nreason: 还早')}# 推断决策\n\n正文。\n`,
    });
    const pack = await buildPack({ vault, projectPath: PROJECT, query: '' });
    const decisions = pack.filter((i) => i.kind === 'decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: 'decision', title: '预算决策', status: '已确认', gist: '预算够' });
    expect(decisions[0].block).toBeUndefined();
    expect(pack.some((i) => i.title === '推断决策')).toBe(false);
  });

  it('one policy item per anchored block; a missing policy folder is empty', async () => {
    const vault = await vaultWith({
      [`${POLICY_DIR}/方针.md`]: `${fm('status: 已确认')}# 方针\n\n- 先做企业 ^p1\n- 再做个人 ^p2\n`,
    });
    const policies = (await buildPack({ vault, projectPath: PROJECT, query: '' })).filter((i) => i.kind === 'policy');
    expect(policies.map((i) => i.block)).toEqual(['^p1', '^p2']);
    expect(policies.every((i) => i.kind === 'policy' && i.title === '方针')).toBe(true);

    const bare = await vaultWith();
    expect((await buildPack({ vault: bare, projectPath: PROJECT, query: '' })).filter((i) => i.kind === 'policy')).toEqual([]);
  });

  it('the method note appears as one item with a fixed gist, and is skipped when missing', async () => {
    const vault = await vaultWith({
      '00_团队知识/方法库/workplan共创.md': `${fm('status: 已确认')}# workplan共创\n`,
    });
    const methods = (await buildPack({ vault, projectPath: PROJECT, query: '' })).filter((i) => i.kind === 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({
      kind: 'method',
      title: 'workplan共创',
      path: '00_团队知识/方法库/workplan共创.md',
      gist: '怎么共创 workplan 的方法',
    });

    const bare = await vaultWith();
    expect((await buildPack({ vault: bare, projectPath: PROJECT, query: '' })).filter((i) => i.kind === 'method')).toEqual([]);
  });

  it('reference notes are ranked by keyword hits, with the best-matching block', async () => {
    const vault = await vaultWith({
      '10_资料库/资料甲.md': `${fm('status: 推断')}# 资料甲\n\n与本题无关。\n`,
      '10_资料库/管理付费.md': `${fm('status: 推断')}# 管理付费\n\n管理很重要。 ^r1\n\n付费意愿高。 ^r2\n`,
      '10_资料库/管理笔记.md': `${fm('status: 推断')}# 管理笔记\n\n管理方面。 ^r1\n`,
      '10_资料库/无关资料.md': `${fm('status: 推断')}# 无关资料\n\n没有相关内容。\n`,
    });
    const refs = (await buildPack({ vault, projectPath: PROJECT, query: '管理 付费' })).filter((i) => i.kind === 'reference');
    expect(refs.map((i) => i.title)).toEqual(['管理付费', '管理笔记']);
    expect(refs[0]).toMatchObject({ path: '10_资料库/管理付费.md', block: '^r1' });
    expect(refs[1]).toMatchObject({ path: '10_资料库/管理笔记.md', block: '^r1' });

    const one = (await buildPack({ vault, projectPath: PROJECT, query: '管理 付费', maxReferences: 1 })).filter(
      (i) => i.kind === 'reference',
    );
    expect(one.map((i) => i.title)).toEqual(['管理付费']);
  });

  it('a reference note\'s gist is the best-matching claim, not its source line', async () => {
    const vault = await vaultWith({
      [`${REFERENCE_DIR}/溢价资料.md`]: `${fm('status: 推断')}# 溢价资料\n\n> 来源：https://example.com/a（2026-10-24 抓取）\n\n## 论断\n\n- 「企业不愿为 AI PC 付溢价」— 位置：正文 ^c1\n- 「平均价格高 5-15%」— 位置：第 6 段 ^c2\n`,
      [`${REFERENCE_DIR}/无块资料.md`]: `${fm('status: 推断')}# 无块资料\n\n> 来源：https://example.com/b\n\n溢价意愿很低的一段话。\n`,
    });
    const refs = (await buildPack({ vault, projectPath: PROJECT, query: '企业 溢价 价格' })).filter((i) => i.kind === 'reference');
    const byTitle = new Map(refs.map((i) => [i.title, i]));
    expect(byTitle.get('溢价资料')).toMatchObject({ block: '^c1', gist: '「企业不愿为 AI PC 付溢价」— 位置：正文' });
    expect(byTitle.get('无块资料')?.gist).toBe('溢价意愿很低的一段话。');
  });

  it('ids run K1..Kn without gaps in the documented kind order', async () => {
    const vault = await vaultWith({
      [`${PROJECT}/会议/周会.md`]: `${fm('status: 已确认')}# 周会\n\n- 一条指示 ^m1\n`,
      [`${PROJECT}/决策/预算.md`]: `${fm('status: 已确认\nreason: 预算够')}# 预算\n`,
      [`${POLICY_DIR}/方针.md`]: `${fm('status: 已确认')}# 方针\n\n- 先做企业 ^p1\n`,
      '00_团队知识/方法库/workplan共创.md': `${fm('status: 已确认')}# workplan共创\n`,
      [`${REFERENCE_DIR}/里程碑资料.md`]: `${fm('status: 推断')}# 里程碑资料\n\n里程碑很重要。 ^r1\n`,
    });
    const pack = await buildPack({ vault, projectPath: PROJECT, query: '里程碑' });
    expect(pack.map((i) => i.id)).toEqual(['K1', 'K2', 'K3', 'K4', 'K5']);
    expect(pack.map((i) => i.kind)).toEqual(['directive', 'decision', 'policy', 'method', 'reference']);
  });
});

describe('keywordsOf', () => {
  it('takes CJK 2-grams and latin words, dropping stop pairs', () => {
    const k = keywordsOf('企业 IT 会不会为员工付费');
    expect(k).toContain('员工');
    expect(k).toContain('付费');
    expect(k).toContain('it');
    expect(k).not.toContain('不会');
    expect(k).not.toContain('会不');
    expect(keywordsOf('')).toEqual([]);
    expect(keywordsOf('企业 IT 会不会为员工付费')).toEqual(k);
  });
});

describe('mergePack', () => {
  const a: PackItem = { id: 'K1', kind: 'directive', title: 'A', path: 'x/a.md', block: '^m1', gist: 'a' };
  const b: PackItem = { id: 'K2', kind: 'decision', title: 'B', path: 'x/b.md', gist: 'b' };
  const c: PackItem = { id: 'K9', kind: 'reference', title: 'C', path: 'x/c.md', gist: 'c' };

  it('keeps existing ids and gives new items the next free ids', () => {
    const merged = mergePack([a, b], [{ ...a, title: '改过的 A' }, c]);
    expect(merged.map((i) => i.id)).toEqual(['K1', 'K2', 'K3']);
    expect(merged[0]).toEqual(a);
    expect(merged[2]).toMatchObject({ path: 'x/c.md', title: 'C' });
  });

  it('numbers fresh items from K1 when nothing exists, and is a no-op the second time', () => {
    expect(mergePack([], [c])[0].id).toBe('K1');
    const merged = mergePack([a, b], [c]);
    expect(mergePack(merged, [c])).toEqual(merged);
  });
});
