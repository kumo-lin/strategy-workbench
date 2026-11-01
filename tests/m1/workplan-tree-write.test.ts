/**
 * Write-time tree checks of a question-tree workplan (D-39, P3), through write_draft: a Workspace's first workplan is a
 * question tree; a later one follows the format of the version it builds on; an older-format Workspace is not judged.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeTool } from '@/lib/harness';
import { ctxFor, makeM1Vault, WS } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const TREE = `### Q1 谁决定买，谁出钱？
**假设 H1**：IT 决定能不能进机队。[[WS-A-H1 IT 可管理性]]

### Q2 买方按什么标准放行？
#### Q2-1 管得住是准入要求吗？
**假设 H2-1**：是准入要求。[[WS-A-H1 IT 可管理性]]
#### Q2-2 都管得住时按什么选？
**假设 H2-2**：看价格。[[WS-A-H1 IT 可管理性]]`;

const body = (n: number, tree = TREE, mece = '不重叠：各管一件事。不遗漏：少一问答不了。凭什么是联想交给 W5。') => `# WS-A workplan v${n}

## 要回答的问题与要支撑的决策
明年押哪一层。

## 前提
W1 的决定。

## Day-1 answer
押管理栈。

## 问题树与假设
${tree}

## MECE 和充分必要的自检
${mece}

## 每个假设怎么验证
H1：条件、证据、反证。

## 金字塔骨架
结论 → 回答 → 证据。

## 风险和待确认
- 无。

## next action
- 查 H1。
`;

async function write(vault: Awaited<ReturnType<typeof makeM1Vault>>['vault'], n: number, text: string) {
  const ctx = await ctxFor(vault);
  return executeTool(
    'write_draft',
    {
      note_type: 'workplan',
      name: `workplan v${n}`,
      frontmatter: {
        id: `ws-a-wp-v${n}`,
        version: n,
        derived_from: n > 1 ? [`[[${WS}/workplan v${n - 1}|workplan v${n - 1}]]`] : ['[[团队]]'],
        relates_to: [`[[${WS}/workspace|WS-A]]`],
        changes: [],
      },
      body: text,
      why: '测试',
    },
    ctx,
  );
}

async function emptyWorkspace() {
  const m = await makeM1Vault();
  cleanups.push(m.cleanup);
  await rm(path.join(m.root, WS, 'workplan v1.md'));
  return m.vault;
}

describe('the first workplan of a Workspace is a question tree', () => {
  it('writes a well-formed tree, with no notices', async () => {
    const vault = await emptyWorkspace();
    const r = await write(vault, 1, body(1));
    expect(r).toMatchObject({ created: true });
    expect((r as { notices?: string[] }).notices ?? []).toEqual([]);
  });

  it('refuses the old section titles, and says what is missing', async () => {
    const vault = await emptyWorkspace();
    await expect(write(vault, 1, '# WS-A workplan v1\n\n## 论点与假设\n- [[WS-A-H1 IT 可管理性]]\n')).rejects.toThrow(/缺少这些小节.*问题树与假设/s);
  });

  it('refuses a sub-question without a hypothesis and an empty MECE check', async () => {
    const vault = await emptyWorkspace();
    await expect(write(vault, 1, body(1, '### Q1 谁决定买？\n还没有假设。', ' '))).rejects.toThrow(/是空的[\s\S]*Q1 下面没有假设/);
  });

  it('writes with advice when the wording is off (a topic, no 凭什么是我们)', async () => {
    const vault = await emptyWorkspace();
    const r = (await write(vault, 1, body(1, '### Q1 市场规模\n**假设 H1**：很大。[[WS-A-H1 IT 可管理性]]', '不重叠。不遗漏。'))) as { created: boolean; notices?: string[] };
    expect(r.created).toBe(true);
    expect((r.notices ?? []).join('\n')).toMatch(/不像问句[\s\S]*凭什么是我们/);
  });
});

describe('a later version follows the format of the one it builds on', () => {
  it('v2 of a tree workplan must be a tree too', async () => {
    const vault = await emptyWorkspace();
    await write(vault, 1, body(1));
    await expect(write(vault, 2, '# WS-A workplan v2\n\n## 论点与假设\n- x\n')).rejects.toThrow(/问题树不合格/);
    await expect(write(vault, 2, body(2))).resolves.toMatchObject({ created: true });
  });

  it('an older-format Workspace is not judged: v1 overwrite and v2 keep the old titles', async () => {
    const m = await makeM1Vault();
    cleanups.push(m.cleanup);
    const old = '# WS-A workplan v1\n\n## 论点与假设\n- 论点 1：[[WS-A-H1 IT 可管理性]]\n\n## next action\n- 调查 H1\n';
    await expect(write(m.vault, 1, old)).resolves.toMatchObject({ created: false });
    await expect(write(m.vault, 2, old.replace('v1', 'v2'))).resolves.toMatchObject({ created: true });
  });
});

describe('submit_for_review on a question-tree workplan', () => {
  const submit = async (vault: Awaited<ReturnType<typeof makeM1Vault>>['vault']) =>
    executeTool('submit_for_review', { gate: 'G1', subject: `${WS}/workplan v1.md`, summary: '请看拆题', focus: ['问题树'] }, await ctxFor(vault));

  it('passes when every hypothesis link is a hypothesis note', async () => {
    const vault = await emptyWorkspace();
    await write(vault, 1, body(1));
    await expect(submit(vault)).resolves.toMatchObject({ prepared: true });
  });

  it('names the sub-question whose hypothesis note does not exist yet', async () => {
    const vault = await emptyWorkspace();
    await write(vault, 1, body(1).replace('**假设 H2-2**：看价格。[[WS-A-H1 IT 可管理性]]', '**假设 H2-2**：看价格。[[WS-A-H9 还没写]]'));
    await expect(submit(vault)).rejects.toThrow(/H2-2（Q2-2）\[\[WS-A-H9 还没写\]\]/);
  });
});
