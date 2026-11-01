/** "这是改成问题树之前的版本": shown for a workplan in the older format when the project has a question tree elsewhere (display only). */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildWorkplanViews } from '@/lib/workplan/view';
import { projectHasQuestionTree } from '@/lib/workplan/legacy-note';
import { makeM1Vault, WS } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const fm = (id: string, extra = '') =>
  `---\nid: ${id}\ntype: workplan\nstatus: 进行中\ncreated: "2026-10-25"\nupdated: "2026-10-25"\nauthor: AI\nversion: 1\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\nchanges: []\napproved_by: null\napproved_at: null\n${extra}---\n`;
const TREE_BODY = '# WS-B workplan v1\n\n## 问题树与假设\n### Q1 谁买？\n**假设 H1**：IT。[[WS-B-H1 x]]\n';
const OTHER_TREE = { '20_项目/P/WS-B/workplan v1.md': `${fm('ws-b-wp-v1')}${TREE_BODY}` };

async function views(extra: Record<string, string> = {}) {
  const m = await makeM1Vault(extra);
  cleanups.push(m.cleanup);
  return { vault: m.vault, views: await buildWorkplanViews(m.vault, WS) };
}

describe('workplan view: beforeQuestionTree', () => {
  it('says nothing when the project has no question tree anywhere (the old workplan is just the workplan)', async () => {
    const { views: v } = await views();
    expect(v.map((x) => x.beforeQuestionTree)).toEqual([false]);
  });

  it('flags an older-format workplan when another Workspace of the project has a question-tree workplan', async () => {
    const { views: v, vault } = await views(OTHER_TREE);
    expect(v[0].beforeQuestionTree).toBe(true);
    expect(await projectHasQuestionTree(vault, WS)).toBe(true);
  });

  it('flags it too when the project has a question-tree research plan', async () => {
    const plan = readFileSync('tests/fixtures/d39/计划 v3.md', 'utf8');
    const { views: v } = await views({ '20_项目/P/WS-B/调查/买方采购逻辑/计划 v1.md': plan });
    expect(v[0].beforeQuestionTree).toBe(true);
  });

  it('never flags a question-tree workplan itself', async () => {
    const { views: v } = await views({ [`${WS}/workplan v1.md`]: `${fm('ws-a-wp-v1')}${TREE_BODY.replace('WS-B', 'WS-A')}`, ...OTHER_TREE });
    expect(v[0].beforeQuestionTree).toBe(false);
  });

  it('a version in the older format next to a tree version is flagged, the tree one is not', async () => {
    const { views: v } = await views({
      [`${WS}/workplan v2.md`]: `${fm('ws-a-wp-v2').replace('version: 1', 'version: 2')}${TREE_BODY.replace('WS-B', 'WS-A')}`,
      ...OTHER_TREE,
    });
    expect(v.map((x) => [x.version, x.beforeQuestionTree])).toEqual([[1, true], [2, false]]);
  });
});
