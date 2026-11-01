/** C2 文件 tab: the Workspace's own workplans and reports, the project's confirmed reports, and the library. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVault, type Vault } from '@/lib/vault';
import { loadFiles } from '@/lib/workplan/files-view';

const P1 = '20_项目/P1';
const P2 = '20_项目/P2';
const WS_A = `${P1}/WS-A`;
const WS_B = `${P1}/WS-B`;
const WS_X = `${P2}/WS-X`;

const BASE = `/workspace/${encodeURIComponent('P1')}/${encodeURIComponent('WS-A')}`;

const DIR_A = `${WS_A}/调查/调查A`;
const DIR_B = `${WS_A}/调查/调查B`;
const REPORT_A_V1 = `${DIR_A}/报告 v1.md`;
const REPORT_A_V2 = `${DIR_A}/报告 v2.md`;
const REPORT_B_V1 = `${DIR_B}/报告 v1.md`;
const REPORT_WS_B = `${WS_B}/调查/买方法/报告 v1.md`;
const REPORT_X = `${WS_X}/调查/买方需求/报告 v1.md`;

const fm = (lines: string) => `---\n${lines.trim()}\n---\n`;

const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') => `
id: ${id}
type: ${type}
status: ${status}
created: "2026-10-24"
updated: "2026-10-24"
author: ${author}
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}`;

const workspaceNote = (id: string) =>
  `${fm(
    common(
      id,
      'workspace',
      `week: W2
owner: Junior A
reviewer: Senior
stage: 拆题中
flags: []
depends_on: []`,
      'AI',
      '进行中',
    ),
  )}\n# ${id}\n`;

const workplanNote = (id: string, version: number, created: string) => {
  const body = common(
    id,
    'workplan',
    `version: ${version}
approved_by: null
approved_at: null
changes: []`,
    'Junior A',
    '进行中',
  ).replace('created: "2026-10-24"', `created: "${created}"`);
  return `${fm(body)}\n# workplan v${version}\n`;
};

const reportNote = (id: string, version: number, delivery: string) =>
  `${fm(
    common(
      id,
      'report',
      `version: ${version}
research_plan: null
mode: team
exploratory: false
delivery: ${delivery}`,
      'AI',
      '进行中',
    ),
  )}\n# 报告 v${version}\n`;

const reviewNote = (opts: { id: string; subject: string; updated: string; reviewer: string }) =>
  `${fm(`
id: ${opts.id}
type: review
status: 已确认
created: "2026-10-24"
updated: "${opts.updated}"
author: Senior
derived_from: ["[[${opts.subject.replace(/\.md$/, '')}|${path.posix.basename(opts.subject, '.md')}]]"]
relates_to: ["[[团队]]"]
requester: Junior A
reviewer: ${opts.reviewer}
result: 通过
gate: 结论
`)}\n# review\n`;

const libraryNote = (id: string, publisher: string, extra = '') =>
  `${fm(
    common(
      id,
      'source',
      `url: null
publisher: ${publisher}
published: null
retrieved: "2026-10-24"
origin: 预置
grade: B
graded_by: AI
authority: null
link_checked: true
${extra}`,
      'AI',
      '推断',
    ),
  )}\n# ${id}\n`;

function baseFiles(): Record<string, string> {
  return {
    [`${P1}/项目.md`]: `${fm(common('p1', 'project', `owner: Senior
sponsor: VP
core_question: 问题？
roadmap: []
dependencies: []`))}\n# P1\n`,
    [`${WS_A}/workspace.md`]: workspaceNote('p1-ws-a'),
    [`${WS_B}/workspace.md`]: workspaceNote('p1-ws-b'),
    [`${WS_X}/workspace.md`]: workspaceNote('p2-ws-x'),

    [`${WS_A}/workplan v1.md`]: workplanNote('wp-v1', 1, '2026-10-20'),
    [`${WS_A}/workplan v2.md`]: workplanNote('wp-v2', 2, '2026-10-22'),
    [`${WS_A}/workplan v3.md`]: workplanNote('wp-v3', 3, '2026-10-24'),

    [REPORT_A_V1]: reportNote('report-a-v1', 1, '已交付'),
    [REPORT_A_V2]: reportNote('report-a-v2', 2, '草稿'),
    [REPORT_B_V1]: reportNote('report-b-v1', 1, '已交付'),

    [REPORT_WS_B]: reportNote('report-ws-b', 1, '已交付'),
    [`${WS_B}/review/结论 2026-10-27.md`]: reviewNote({
      id: 'confirmed-ws-b',
      subject: REPORT_WS_B,
      updated: '2026-10-27T09:00:00Z',
      reviewer: 'Senior B',
    }),
    [`${WS_A}/review/结论 2026-10-26.md`]: reviewNote({
      id: 'confirmed-ws-a',
      subject: REPORT_A_V2,
      updated: '2026-10-26T09:00:00Z',
      reviewer: 'Senior A',
    }),

    [REPORT_X]: reportNote('report-p2', 1, '已交付'),
    [`${WS_X}/review/结论 2026-10-28.md`]: reviewNote({
      id: 'confirmed-p2',
      subject: REPORT_X,
      updated: '2026-10-28T09:00:00Z',
      reviewer: 'Senior X',
    }),

    '10_资料库/B资料.md': libraryNote('lib-b', '机构乙'),
    '10_资料库/A资料.md': libraryNote('lib-a', '机构甲'),
    '10_资料库/C模拟标志.md': libraryNote('lib-c', '机构丙', 'simulated: true\n'),
    '10_资料库/D模拟发布.md': libraryNote('lib-d', '模拟'),
    '10_资料库/坏.md': '---\nfoo: [unclosed\n---\n# 坏\n',
  };
}

let vault: Vault;
let root: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sw-files-'));
  for (const [rel, text] of Object.entries(baseFiles())) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
  vault = createVault(root);
  cleanup = () => rm(root, { recursive: true, force: true });
});
afterEach(async () => cleanup());

describe('loadFiles', () => {
  it("1: own has this Workspace's workplan versions newest first, then its reports newest first", async () => {
    const { own } = await loadFiles(vault, WS_A, BASE);
    expect(own).toEqual([
      { name: 'workplan v3', path: `${WS_A}/workplan v3.md`, subtitle: 'Junior A · 2026-10-24', href: BASE, simulated: false },
      { name: 'workplan v2', path: `${WS_A}/workplan v2.md`, subtitle: 'Junior A · 2026-10-22', href: BASE, simulated: false },
      { name: 'workplan v1', path: `${WS_A}/workplan v1.md`, subtitle: 'Junior A · 2026-10-20', href: BASE, simulated: false },
      {
        name: '报告 v2',
        path: REPORT_A_V2,
        subtitle: '调查A · 草稿',
        href: `${BASE}/research/${encodeURIComponent('调查A')}?v=${encodeURIComponent(REPORT_A_V2)}`,
        simulated: false,
      },
      {
        name: '报告 v1',
        path: REPORT_A_V1,
        subtitle: '调查A · 已交付',
        href: `${BASE}/research/${encodeURIComponent('调查A')}?v=${encodeURIComponent(REPORT_A_V1)}`,
        simulated: false,
      },
      {
        name: '报告 v1',
        path: REPORT_B_V1,
        subtitle: '调查B · 已交付',
        href: `${BASE}/research/${encodeURIComponent('调查B')}?v=${encodeURIComponent(REPORT_B_V1)}`,
        simulated: false,
      },
    ]);
  });

  it('2: confirmed is the project\'s reports only, newest first, with own marked', async () => {
    const { confirmed } = await loadFiles(vault, WS_A, BASE);
    expect(confirmed).toEqual([
      {
        name: '报告 v1',
        path: REPORT_WS_B,
        subtitle: '买方法 · 来自 WS-B · Senior B 确认 · 2026-10-27',
        href: `/workspace/${encodeURIComponent('P1')}/${encodeURIComponent('WS-B')}/research/${encodeURIComponent('买方法')}?v=${encodeURIComponent(REPORT_WS_B)}`,
        simulated: false,
        own: false,
      },
      {
        name: '报告 v2',
        path: REPORT_A_V2,
        subtitle: '调查A · 来自 WS-A（本 Workspace） · Senior A 确认 · 2026-10-26',
        href: `/workspace/${encodeURIComponent('P1')}/${encodeURIComponent('WS-A')}/research/${encodeURIComponent('调查A')}?v=${encodeURIComponent(REPORT_A_V2)}`,
        simulated: false,
        own: true,
      },
    ]);
    expect(confirmed.some((r) => r.path === REPORT_X)).toBe(false);
  });

  it('3: library lists 10_资料库 notes by name, marks simulated ones, and skips a broken note', async () => {
    const { library } = await loadFiles(vault, WS_A, BASE);
    expect(library).toEqual([
      { name: 'A资料', path: '10_资料库/A资料.md', subtitle: '机构甲', href: `${BASE}/files?doc=${encodeURIComponent('10_资料库/A资料.md')}`, simulated: false },
      { name: 'B资料', path: '10_资料库/B资料.md', subtitle: '机构乙', href: `${BASE}/files?doc=${encodeURIComponent('10_资料库/B资料.md')}`, simulated: false },
      { name: 'C模拟标志', path: '10_资料库/C模拟标志.md', subtitle: '机构丙', href: `${BASE}/files?doc=${encodeURIComponent('10_资料库/C模拟标志.md')}`, simulated: true },
      { name: 'D模拟发布', path: '10_资料库/D模拟发布.md', subtitle: '模拟', href: `${BASE}/files?doc=${encodeURIComponent('10_资料库/D模拟发布.md')}`, simulated: true },
    ]);
  });

  it('4: missing folders give empty lists, never a throw', async () => {
    const files = await loadFiles(vault, '20_项目/没有/WS', BASE);
    expect(files.own).toEqual([]);
    expect(files.confirmed).toEqual([]);
    expect(files.library.map((f) => f.name)).toEqual(['A资料', 'B资料', 'C模拟标志', 'D模拟发布']);
  });
});
