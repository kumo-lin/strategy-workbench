/** The workplan prompt writes the question-tree format for a new workplan and keeps the older one for an older-format Workspace (D-39, P3). */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWorkplanPrompt } from '@/lib/harness/prompts/workplan';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import { WORKPLAN_SECTIONS } from '@/lib/workplan/workplan-tree';
import { ctxFor, makeM1Vault, WS } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

describe('workplan prompt: format by workplan', () => {
  it('when write_draft is the writer (compose pipeline off): nine sections, the tree written as headings, one hypothesis per lowest-level sub-question', async () => {
    const m = await makeM1Vault();
    cleanups.push(m.cleanup);
    await rm(path.join(m.root, WS, 'workplan v1.md'));
    const c = await gatherWorkplanContext(await ctxFor(m.vault));
    expect(c.compose.active).toBe(true); // no workplan yet: the compose pipeline drafts it (see compose-prompt.test.ts)
    const p = renderWorkplanPrompt({ ...c, compose: { active: false, state: null } });
    for (const title of WORKPLAN_SECTIONS) expect(p).toContain(`\`## ${title}\``);
    expect(p).toContain('### Q1 <问句>');
    expect(p).toContain('#### Q2-1 <问句>');
    expect(p).toContain('每个最底层的子问题有且只有一个假设');
    expect(p).toContain('最多两层');
    expect(p).toContain('凭什么是我们');
    expect(p).toContain('自研 / 合作 / 收购');
    expect(p).not.toContain('## 论点与假设');
    expect(p).not.toContain('先问会改变论点怎么拆的');
    expect(p).toContain('先问会改变问题树怎么拆的');
    expect(p).toContain('共创最多问 3 个问题，追问也算在内'); // D-19 unchanged
  });

  it('an older-format workplan keeps the older sections (nothing migrates)', async () => {
    const m = await makeM1Vault();
    cleanups.push(m.cleanup);
    const p = renderWorkplanPrompt(await gatherWorkplanContext(await ctxFor(m.vault)));
    expect(p).toContain('## 论点与假设');
    expect(p).not.toContain('### Q1 <问句>');
  });
});
