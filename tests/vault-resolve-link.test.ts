/**
 * `resolveLink` basename ties: the linking note's own folder wins, then its project folder (D-56).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LinkResolution, Vault } from '@/lib/vault';
import { makeFixtureVault } from './helpers/fixture-vault';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

async function fixture(extra: Record<string, string> = {}): Promise<Vault> {
  const { vault, cleanup } = await makeFixtureVault(extra);
  cleanups.push(cleanup);
  return vault;
}

const note = (id: string, type: string, extra: string) => `---
id: ${id}
type: ${type}
status: 已确认
created: "2026-10-24"
updated: "2026-10-24"
author: Senior
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}
---
`;

const project = (id: string, body: string) => `${note(
  id,
  'project',
  `owner: Senior
sponsor: VP
core_question: 问题？
roadmap: [{ week: W2, topic: 买单 }]
dependencies: []`,
)}${body}`;

const workspace = (id: string) => `${note(
  id,
  'workspace',
  `week: W2
owner: Junior A
reviewer: Senior
stage: 拆题中
flags: []
depends_on: []`,
)}# workspace
`;

const meeting = (id: string) => `${note(
  id,
  'meeting',
  `date: "2026-10-24"
attendees: [Senior]
simulated: false
decisions: []`,
)}# 同名
`;

const source = (id: string) => `${note(
  id,
  'source',
  `url: null
publisher: 示例机构
published: null
retrieved: "2026-10-24"
origin: 预置
grade: B
graded_by: AI
authority: null
link_checked: true`,
)}# 同名
`;

/** Project Q, its workspace WS-X, and (optionally) the prefix-sharing project QQ. */
const secondProject = (opts: { qq?: boolean } = {}): Record<string, string> => ({
  '20_项目/Q/项目.md': project('proj-q', '# 项目\n\n- Q 的核心问题 ^q1\n'),
  '20_项目/Q/WS-X/workspace.md': workspace('ws-x'),
  ...(opts.qq ? { '20_项目/QQ/项目.md': project('proj-qq', '# 项目\n') } : {}),
});

const candidates = (r: LinkResolution): string[] => {
  expect(r.ok).toBe(false);
  return r.ok ? [] : [...r.candidates].sort();
};

describe('resolveLink: basename tie', () => {
  it('1. a note in the same project resolves `[[项目]]` to its own project', async () => {
    const vault = await fixture(secondProject());
    expect(await vault.resolveLink('[[项目]]', '20_项目/P/WS-A/workspace.md')).toEqual({
      ok: true,
      path: '20_项目/P/项目.md',
    });
  });

  it('2. works from any depth inside the project', async () => {
    const vault = await fixture(secondProject());
    expect(await vault.resolveLink('[[项目]]', '20_项目/Q/WS-X/workspace.md')).toEqual({
      ok: true,
      path: '20_项目/Q/项目.md',
    });
    expect(await vault.resolveLink('[[项目]]', '20_项目/Q/决策/x.md')).toEqual({
      ok: true,
      path: '20_项目/Q/项目.md',
    });
  });

  it('3. a shared note outside any project stays ambiguous', async () => {
    const vault = await fixture(secondProject());
    const r = await vault.resolveLink('[[项目]]', '10_资料库/资料甲.md');
    expect(r).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(candidates(r)).toEqual(['20_项目/P/项目.md', '20_项目/Q/项目.md']);
  });

  it('4. no fromPath stays ambiguous', async () => {
    const vault = await fixture(secondProject());
    const r = await vault.resolveLink('[[项目]]');
    expect(r).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(candidates(r)).toEqual(['20_项目/P/项目.md', '20_项目/Q/项目.md']);
  });

  it('5. two candidates inside the same project stay ambiguous', async () => {
    const vault = await fixture(secondProject());
    const r = await vault.resolveLink('[[workspace]]', '20_项目/P/假设/h.md');
    expect(r).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(candidates(r)).toEqual([
      '20_项目/P/WS-A/workspace.md',
      '20_项目/P/WS-B/workspace.md',
      '20_项目/Q/WS-X/workspace.md',
    ]);
  });

  it('6. no candidate in the linking note\'s project stays ambiguous', async () => {
    const vault = await fixture({
      ...secondProject(),
      '20_项目/Q/会议/同名.md': meeting('meeting-q'),
      '10_资料库/同名.md': source('src-tongming'),
    });
    const r = await vault.resolveLink('[[同名]]', '20_项目/P/WS-A/workspace.md');
    expect(r).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(candidates(r)).toEqual(['10_资料库/同名.md', '20_项目/Q/会议/同名.md']);
  });

  it('7. whole-segment comparison: `20_项目/Q` does not match `20_项目/QQ`', async () => {
    const vault = await fixture(secondProject({ qq: true }));
    expect(await vault.resolveLink('[[项目]]', '20_项目/Q/WS-X/workspace.md')).toEqual({
      ok: true,
      path: '20_项目/Q/项目.md',
    });
  });

  it('8. the same-folder rule still comes first', async () => {
    const vault = await fixture(secondProject());
    expect(await vault.resolveLink('[[workspace]]', '20_项目/Q/WS-X/note.md')).toEqual({
      ok: true,
      path: '20_项目/Q/WS-X/workspace.md',
    });
  });

  it('9. with one project only, nothing changes', async () => {
    const vault = await fixture();
    const r = await vault.resolveLink('[[workspace]]', '20_项目/P/假设/h.md');
    expect(r).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(await vault.resolveLink('[[项目]]', '20_项目/P/假设/h.md')).toEqual({
      ok: true,
      path: '20_项目/P/项目.md',
    });
  });

  it('10. write: a bare `[[项目]]` in a new project resolves', async () => {
    const vault = await fixture(secondProject());
    const target = '20_项目/Q/假设/Q-H1.md';
    const n = await vault.write(target, {
      frontmatter: {
        id: 'q-h1',
        type: 'hypothesis',
        status: '进行中',
        created: '2026-10-24',
        updated: '2026-10-24T10:00:00.000Z',
        author: 'AI',
        derived_from: ['[[项目]]'],
        relates_to: ['[[20_项目/Q/WS-X/workspace]]'],
        workspace: '[[20_项目/Q/WS-X/workspace]]',
        statement: 'Q 的假设',
        verdict_proposed: null,
        verdict: null,
        evidence: [],
        counter_evidence: [],
      },
      body: '# Q-H1\n',
    });
    expect(n.note?.type).toBe('hypothesis');
    expect(await vault.exists(target)).toBe(true);
  });

  it('11. citations follow the same rule', async () => {
    const vault = await fixture(secondProject());
    expect(await vault.checkCitation('[[项目#^q1]]', { fromPath: '20_项目/Q/WS-X/workspace.md' })).toMatchObject({
      ok: true,
      path: '20_项目/Q/项目.md',
    });
    expect(await vault.checkCitation('[[项目#^q1]]', { fromPath: '10_资料库/资料甲.md' })).toMatchObject({
      ok: false,
      error: 'ambiguous',
    });
  });
});
