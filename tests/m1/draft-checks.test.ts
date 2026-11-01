/**
 * Workplan version rules and comment traceability (CONTRACT-CHANGE m1-1, M1 task 1.8 ②).
 * Every case goes through write_draft (executeTool), i.e. the real AI write path,
 * unless it tests checkDraft's own contract.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeTool, type ToolContext } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { checkDraft } from '@/lib/workplan/draft-checks';
import { addComment, decideReview, requestReview } from '@/lib/workplan/review-flow';
import { ctxFor, LOG, makeM1Vault, ROLES, WS } from './helpers';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM1Vault());
});
afterEach(async () => cleanup());

const wpLink = (n: number) => `[[${WS}/workplan v${n}|workplan v${n}]]`;
const change = (comment: string, change = '补了反证') => ({ comment, intent: '每个论点都要有反证', change });

/** The same v1, but a person wrote/edited it: the AI must not overwrite it. */
const HUMAN_WORKPLAN_V1 = `---
id: ws-a-wp-v1
type: workplan
status: 进行中
created: "2026-10-24"
updated: "2026-10-24"
author: Junior A
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
version: 1
approved_by: null
approved_at: null
changes: []
---
# WS-A workplan v1

## 论点与假设
- [[WS-A-H1 IT 可管理性]]
`;

/** write_draft(workplan vN) as the AI would call it. */
async function writeWorkplan(n: number, changes: object[], over: Record<string, unknown> = {}, v: Vault = vault) {
  const ctx = await ctxFor(v);
  return executeTool(
    'write_draft',
    {
      note_type: 'workplan',
      name: `workplan v${n}`,
      frontmatter: {
        id: `ws-a-wp-v${n}`,
        version: n,
        derived_from: n > 1 ? [wpLink(n - 1)] : ['[[团队]]'],
        relates_to: [`[[${WS}/workspace|WS-A]]`],
        changes,
        ...over,
      },
      body: `# WS-A workplan v${n}\n\n## 论点与假设\n- [[WS-A-H1 IT 可管理性]]\n`,
      why: '测试',
    },
    ctx,
  );
}

/** Submit the latest version, leave comments, decide. Returns the comment links. */
async function g1Round(version: number, comments: string[], decision: 'approve' | 'reject') {
  const { reviewPath } = await requestReview({
    vault,
    actor: ROLES.juniorA,
    workspacePath: WS,
    gate: 'G1',
    subject: `${WS}/workplan v${version}.md`,
    summary: 's',
    focus: ['f'],
  });
  const links: string[] = [];
  for (const text of comments) links.push((await addComment({ vault, actor: ROLES.senior, reviewPath, text })).link);
  await decideReview({ vault, actor: ROLES.senior, reviewPath, decision });
  return links;
}

describe('co-creating v1 (before any review)', () => {
  it('the v1 draft can be rewritten as often as the Junior wants, with no changes', async () => {
    await expect(writeWorkplan(1, [])).resolves.toMatchObject({ created: false });
    await expect(writeWorkplan(1, [])).resolves.toMatchObject({ created: false });
  });

  it('a first version in an empty workspace must be v1', async () => {
    const { vault: empty, cleanup: c } = await makeM1Vault();
    try {
      const ctx = await ctxFor(empty);
      const fm = { version: 2, changes: [] };
      await expect(checkDraft('workplan', fm, '', { ...ctx, vault: empty }, { path: `${WS}/workplan v2.md`, overwriting: false })).rejects.toThrow(
        /下一个版本应该是 workplan v2|derived_from/,
      );
    } finally {
      await c();
    }
  });
});

describe('G1 rejected → v2 → v2 revised before resubmission → resubmit', () => {
  let m1: string;
  let m2: string;
  beforeEach(async () => {
    [m1, m2] = await g1Round(1, ['少了反证', '假设不可证伪'], 'reject');
  });

  it('v1 can no longer be rewritten once it was submitted', async () => {
    await expect(writeWorkplan(1, [])).rejects.toThrow(/已经送审过.*workplan v2/);
  });

  it('v2 must act on at least one of the pending comments; the error lists them', async () => {
    const err = await writeWorkplan(2, []).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('还没处理的 comment');
    expect((err as Error).message).toContain(m1);
    expect((err as Error).message).toContain(m2);
  });

  it('v2 with one traced change is accepted (the Junior may handle comments one at a time)', async () => {
    await expect(writeWorkplan(2, [change(m1)])).resolves.toMatchObject({ created: true });
  });

  it('a chat-driven edit of the v2 draft needs no comment and is not blocked', async () => {
    await writeWorkplan(2, [change(m1)]);
    // same entries kept, new body: the Junior asked for an edit in chat
    await expect(writeWorkplan(2, [change(m1, '补了反证（措辞调整）')])).resolves.toMatchObject({ created: false });
    // and the second comment can be added to the same draft later
    await expect(writeWorkplan(2, [change(m1), change(m2, '未修改：H1 已经可证伪，补充说明了检验方法')])).resolves.toMatchObject({ created: false });
  });

  it('rewriting the draft cannot silently drop a comment record', async () => {
    await writeWorkplan(2, [change(m1), change(m2)]);
    await expect(writeWorkplan(2, [change(m1)])).rejects.toThrow(/不能删掉已有的 changes.*\^m2/);
  });

  it('after resubmitting v2 nothing is written until Senior decides, then v3 follows the same rules', async () => {
    await writeWorkplan(2, [change(m1), change(m2)]);
    const [n1] = await g1Round(2, ['next action 太粗'], 'reject');
    await expect(writeWorkplan(2, [change(m1), change(m2)])).rejects.toThrow(/已经送审过/);
    await expect(writeWorkplan(3, [], { derived_from: [wpLink(2)] })).rejects.toThrow(n1);
    await expect(writeWorkplan(3, [change(n1, '拆细了 next action')])).resolves.toMatchObject({ created: true });
  });

  it('every refusal is in the log with the reason the model saw', async () => {
    await writeWorkplan(2, []).catch(() => undefined);
    const row = (await vault.readLog(LOG)).find((r) => r.action === 'tool:write_draft');
    expect(row?.change).toMatch(/^✗ .*还没处理的 comment/);
  });
});

describe('G1 approved with comments', () => {
  it('the post-approval version must act on the comments; once handled, later versions need none', async () => {
    const [m1] = await g1Round(1, ['可以，但补一条反证'], 'approve');
    await expect(writeWorkplan(2, [])).rejects.toThrow(/还没处理的 comment/);
    await writeWorkplan(2, [change(m1)]);
    // research changed the scope: v3 with no comment behind it is fine
    await expect(writeWorkplan(3, [])).resolves.toMatchObject({ created: true });
  });

  it('approval without comments needs no changes in v2', async () => {
    await g1Round(1, [], 'approve');
    await expect(writeWorkplan(2, [])).resolves.toMatchObject({ created: true });
  });
});

describe('traceability of every entry', () => {
  let m1: string;
  beforeEach(async () => {
    [m1] = await g1Round(1, ['少了反证'], 'reject');
  });

  it('a made-up comment block is refused with the expected link format', async () => {
    const err = (await writeWorkplan(2, [change(m1), change(m1.replace('^m1', '^m9'))]).catch((e: Error) => e)) as Error;
    expect(err.message).toContain('没有这个 ^m 块');
    expect(err.message).toContain('#^m<编号>');
  });

  it('a block that is not in this workspace\'s review notes is refused', async () => {
    await expect(writeWorkplan(2, [change(m1), change('[[资料甲#^c1]]')])).rejects.toThrow(/不在本 Workspace 的 review/);
  });

  it('malformed entries get a message with the right shape', async () => {
    await expect(writeWorkplan(2, [{ comment: m1 }])).rejects.toThrow(/changes 格式不对.*intent/);
  });

  it('a wrong version number or a missing link to the previous version is refused', async () => {
    await expect(writeWorkplan(3, [change(m1)], { derived_from: [wpLink(1)] })).rejects.toThrow(/下一个版本应该是 workplan v2/);
    await expect(writeWorkplan(2, [change(m1)], { derived_from: ['[[团队]]'] })).rejects.toThrow(/derived_from 要包含上一版/);
    await expect(writeWorkplan(2, [change(m1)], { version: 3 })).rejects.toThrow(/version: 3/);
  });
});

describe('scope of the hook', () => {
  it('while a G1 request is pending the Junior may still draft; the sent version stays frozen', async () => {
    await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: `${WS}/workplan v1.md`, summary: 's', focus: [] });
    await expect(writeWorkplan(1, [])).rejects.toThrow(/已经送审过/);
    await expect(writeWorkplan(2, [])).resolves.toMatchObject({ created: true });
  });

  it('a hand-edited draft is never overwritten; an AI draft can be', async () => {
    const { vault: human, cleanup: clean } = await makeM1Vault({ [`${WS}/workplan v1.md`]: HUMAN_WORKPLAN_V1 });
    try {
      await expect(writeWorkplan(1, [], {}, human)).rejects.toThrow(/手改的/);
    } finally {
      await clean();
    }
    await expect(writeWorkplan(1, [])).resolves.toMatchObject({ created: false });
  });

  // research_plan is no longer here: M2 checks a plan's citations at write time (tests/m2/plan-citations.test.ts).
  it.each(['report', 'hypothesis'] as const)('%s is returned from on the first line, without touching the vault', async (type) => {
    const ctx = await ctxFor(vault);
    const untouchable = new Proxy({} as Vault, {
      get() {
        throw new Error('vault must not be read');
      },
    });
    await expect(
      checkDraft(type, { version: 'garbage', changes: 'garbage' }, '', { ...ctx, vault: untouchable } as ToolContext, { path: 'x.md', overwriting: true }),
    ).resolves.toBeUndefined();
  });
});
