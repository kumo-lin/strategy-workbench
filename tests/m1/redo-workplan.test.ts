/** "重新做一版 workplan": the old version stays, the next write goes to a new version (M1 task 4b). */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderWorkplanPrompt } from '@/lib/harness/prompts/workplan';
import type { LogEntry, Vault } from '@/lib/vault';
import { countCocreateAsks } from '@/lib/workplan/ask-budget';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import { isRedoPending, requestRedo, REDO_ACTION } from '@/lib/workplan/redo';
import { requestReview } from '@/lib/workplan/review-flow';
import { ctxFor, LOG, makeM1Vault, ROLES, WS } from './helpers';

const NOW = new Date('2026-10-25T09:00:00Z');
const now = () => NOW;

const row = (action: string, change: string, reason = '·'): LogEntry => ({
  time: '2026-10-25T01:00:00.000Z',
  actor: 'AI',
  action,
  change,
  reason,
});
const ask = () => row('tool:ask_user', '提问：要支撑什么决策？', 'why · 阶段=workplan');
const redo = () => row(REDO_ACTION, `重新做一版：保留 workplan v1，下一版写 v2`, 'Junior 要求重新做');
const wroteWorkplan = (v = 1) => row('tool:write_draft', `新建草稿 ${WS}/workplan v${v}.md（workplan）`);

const NOT_WORKPLAN = `---
id: not-wp
type: log
status: 进行中
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
---
`;

const WORKPLAN_V2 = {
  id: 'ws-a-wp-v2',
  type: 'workplan',
  status: '进行中',
  created: '2026-10-25',
  updated: '2026-10-25',
  author: 'AI',
  derived_from: [`[[${WS}/workplan v1|workplan v1]]`],
  relates_to: [`[[${WS}/workspace|WS-A]]`],
  version: 2,
  approved_by: null,
  approved_at: null,
  changes: [],
};

describe('isRedoPending', () => {
  it('is true only when the last redo entry is newer than the last successful workplan write', () => {
    expect(isRedoPending([])).toBe(false);
    expect(isRedoPending([redo()])).toBe(true);
    expect(isRedoPending([redo(), wroteWorkplan(1)])).toBe(false);
    expect(isRedoPending([wroteWorkplan(1), redo()])).toBe(true);
    expect(isRedoPending([redo(), redo()])).toBe(true);
  });
});

describe('requestRedo', () => {
  let vault: Vault;
  let root: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, root, cleanup } = await makeM1Vault());
  });
  afterEach(async () => cleanup());

  it('the owner redos: next version v2, one log entry, and a second click is idempotent', async () => {
    expect(await requestRedo({ vault, actor: ROLES.juniorA, workspacePath: WS, now })).toEqual({ nextVersion: 2 });
    const redos = (await vault.readLog(LOG)).filter((r) => r.action === REDO_ACTION);
    expect(redos).toHaveLength(1);
    expect(redos[0]).toMatchObject({ actor: 'Junior A', reason: 'Junior 要求重新做' });
    expect(redos[0].change).toContain('保留 workplan v1，下一版写 v2');

    expect(await requestRedo({ vault, actor: ROLES.juniorA, workspacePath: WS, now })).toEqual({ nextVersion: 2 });
    expect((await vault.readLog(LOG)).filter((r) => r.action === REDO_ACTION)).toHaveLength(1);
  });

  it('only the Workspace owner may redo', async () => {
    await expect(requestRedo({ vault, actor: ROLES.senior, workspacePath: WS, now })).rejects.toThrow(
      '只有 Workspace 的负责人',
    );
    expect(await vault.readLog(LOG)).toEqual([]);
  });

  it('needs an existing workplan', async () => {
    const other = await makeM1Vault({ [`${WS}/workplan v1.md`]: NOT_WORKPLAN });
    try {
      await expect(requestRedo({ vault: other.vault, actor: ROLES.juniorA, workspacePath: WS, now })).rejects.toThrow(
        '还没有 workplan',
      );
    } finally {
      await other.cleanup();
    }
  });

  it('is allowed while a G1 review is waiting for the Senior (G1 is a request for an opinion, D-56 5a)', async () => {
    await requestReview({
      vault,
      actor: ROLES.juniorA,
      workspacePath: WS,
      gate: 'G1',
      subject: `${WS}/workplan v1.md`,
      summary: 's',
      focus: [],
      now: NOW,
    });
    await expect(requestRedo({ vault, actor: ROLES.juniorA, workspacePath: WS, now })).resolves.toEqual({ nextVersion: 2 });
  });

  it('leaves workplan v1 byte-for-byte untouched', async () => {
    const file = path.join(root, `${WS}/workplan v1.md`);
    const before = await readFile(file);
    await requestRedo({ vault, actor: ROLES.juniorA, workspacePath: WS, now });
    expect(await readFile(file)).toEqual(before);
  });
});

describe('countCocreateAsks after a redo', () => {
  it('restarts the question budget', () => {
    expect(countCocreateAsks([ask(), ask(), redo(), ask()])).toBe(1);
  });
});

describe('gatherWorkplanContext after a redo', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, cleanup } = await makeM1Vault());
  });
  afterEach(async () => cleanup());

  it('points the next write at a new version and clears once that version is written', async () => {
    let c = await gatherWorkplanContext(await ctxFor(vault));
    expect(c.redoPending).toBe(false);
    expect(c.writeTarget).toMatchObject({ version: 1, overwrite: true });

    await requestRedo({ vault, actor: ROLES.juniorA, workspacePath: WS, now });
    c = await gatherWorkplanContext(await ctxFor(vault));
    expect(c.redoPending).toBe(true);
    expect(c.writeTarget).toMatchObject({
      version: 2,
      overwrite: false,
      lockedReason: '你要求重新做一版，旧版本保留',
    });
    expect(c.writeTarget.previousLink).toContain('workplan v1');

    await vault.write(`${WS}/workplan v2.md`, { frontmatter: WORKPLAN_V2, body: '# workplan v2\n' });
    await vault.appendLog(LOG, {
      time: NOW.toISOString(),
      actor: 'AI',
      action: 'tool:write_draft',
      change: `新建草稿 ${WS}/workplan v2.md（workplan）`,
      reason: '写 v2',
    });
    c = await gatherWorkplanContext(await ctxFor(vault));
    expect(c.redoPending).toBe(false);
  });
});

describe('renderWorkplanPrompt with a redo pending', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ vault, cleanup } = await makeM1Vault());
  });
  afterEach(async () => cleanup());

  it('asks what was wrong with the old version and says not to copy it', async () => {
    let c = await gatherWorkplanContext(await ctxFor(vault));
    expect(renderWorkplanPrompt(c)).not.toContain('Junior 要求重新做一版');

    await requestRedo({ vault, actor: ROLES.juniorA, workspacePath: WS, now });
    c = await gatherWorkplanContext(await ctxFor(vault));
    const prompt = renderWorkplanPrompt(c);
    expect(prompt).toContain('Junior 要求重新做一版');
    // the compose pipeline drafts the new version (lib/harness/prompts/workplan-compose.ts)
    expect(prompt).toContain('不动它，也不照抄');
  });
});
