/**
 * Creating a project by hand (D-56 ⑤c): 20_项目/<名字>/项目.md + 日志.md, Senior only, existing names refused.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import { createProject } from '@/lib/project/create';
import { listProjects } from '@/lib/project/list';
import { loadProjectOverview } from '@/lib/project/overview';
import type { Vault } from '@/lib/vault';
import { POST } from '@/app/api/project/create/route';
import { makeFixtureVault, ROLES } from './helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));

/** A shared note whose `[[项目]]` link only becomes ambiguous once a second project exists (M0_2). */
const SOURCE_B = `---
id: src-b
type: source
status: 已确认
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[团队]]"]
relates_to: ["[[项目]]"]
url: "https://example.com/b"
publisher: 示例机构
published: "2026-09-01"
retrieved: "2026-10-24"
origin: 网络
grade: B
graded_by: AI
authority: 3
link_checked: true
---
# 资料乙

## 论断

- 「旧论断」 ^c1
`;

const NOW = new Date('2026-10-27T09:00:00+09:00');
const QUESTION = '企业员工的个人 AI 明年怎么卖？';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

async function fixture(): Promise<{ vault: Vault; root: string }> {
  const { vault, root, cleanup } = await makeFixtureVault({ '10_资料库/资料乙.md': SOURCE_B });
  cleanups.push(cleanup);
  return { vault, root };
}

const create = (vault: Vault, name: string, opts: { coreQuestion?: string; supportsDecision?: string } = {}) =>
  createProject({ vault, actor: ROLES.senior, name, coreQuestion: opts.coreQuestion ?? QUESTION, supportsDecision: opts.supportsDecision, now: NOW });

describe('createProject', () => {
  it('creates 项目.md and 日志.md in the project format', async () => {
    const { vault } = await fixture();
    const result = await create(vault, '企业AI助手');
    expect(result).toEqual({
      name: '企业AI助手',
      projectPath: '20_项目/企业AI助手',
      notePath: '20_项目/企业AI助手/项目.md',
      logPath: '20_项目/企业AI助手/日志.md',
    });

    const note = await vault.read(result.notePath);
    expect(note.note).toMatchObject({ type: 'project', owner: 'Senior', core_question: QUESTION, roadmap: [] });
    expect(note.issues).toEqual([]);
    expect(note.body.trimStart().split('\n')[0]).toBe(`# ${QUESTION}`);
    expect(note.body).toContain('**支撑的决策**：待定');
    expect(note.body).toContain('| 枝 | 要回答 | 周 | Workspace | 假设（草稿） |');
  });

  it('writes supportsDecision into the 支撑的决策 line', async () => {
    const { vault } = await fixture();
    const { notePath } = await create(vault, '企业AI助手', { supportsDecision: '联想明年在个人 AI 上怎么下注' });
    expect((await vault.read(notePath)).body).toContain('**支撑的决策**：联想明年在个人 AI 上怎么下注');
  });

  it('the project page can read the new project', async () => {
    const { vault } = await fixture();
    await create(vault, '企业AI助手');
    expect(await loadProjectOverview(vault, '企业AI助手')).toMatchObject({
      hasProjectNote: true,
      owner: 'Senior',
      coreQuestion: QUESTION,
      decision: '待定',
      branches: [],
      unplaced: [],
    });
  });

  it('the home page list reads every project folder', async () => {
    const { vault } = await fixture();
    expect((await listProjects(vault)).map((o) => o.project)).toEqual(['P']);

    await create(vault, '企业AI助手');
    const list = await listProjects(vault);
    expect(list.map((o) => o.project)).toHaveLength(2);
    expect(list.map((o) => o.project)).toEqual(expect.arrayContaining(['P', '企业AI助手']));
    expect(list.find((o) => o.project === '企业AI助手')).toMatchObject({ hasProjectNote: true, coreQuestion: QUESTION });

    const fresh = await makeFixtureVault();
    cleanups.push(fresh.cleanup);
    await rm(path.join(fresh.root, '20_项目'), { recursive: true });
    expect(await listProjects(fresh.vault)).toEqual([]);
  });

  it('logs the creation', async () => {
    const { vault } = await fixture();
    const { logPath } = await create(vault, '企业AI助手');
    const rows = await vault.readLog(logPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'Senior', action: 'event:project.create' });
  });

  it('a Junior is refused and nothing is created', async () => {
    const { vault } = await fixture();
    const before = await vault.list('20_项目');
    await expect(createProject({ vault, actor: ROLES.juniorA, name: '企业AI助手', coreQuestion: QUESTION, now: NOW })).rejects.toBeInstanceOf(
      ApprovalDenied,
    );
    expect(await vault.exists('20_项目/企业AI助手/项目.md')).toBe(false);
    expect(await vault.list('20_项目')).toEqual(before);
  });

  it('refuses a name that already exists, ignoring case', async () => {
    const { vault } = await fixture();
    await expect(create(vault, 'P')).rejects.toMatchObject({ name: 'ProjectCreateError', code: 'exists' });
    await expect(create(vault, 'p')).rejects.toMatchObject({ name: 'ProjectCreateError', code: 'exists' });
    await create(vault, '企业AI助手');
    await expect(create(vault, '企业AI助手')).rejects.toMatchObject({ name: 'ProjectCreateError', code: 'exists' });
  });

  it('refuses bad names and trims a good one', async () => {
    const { vault } = await fixture();
    for (const bad of ['', '   ', 'a/b', '..', '.hidden', 'x#y', '[x]', 'x'.repeat(41)]) {
      await expect(create(vault, bad)).rejects.toMatchObject({ name: 'ProjectCreateError', code: 'invalid_name' });
    }
    const { name } = await create(vault, '  好名字  ');
    expect(name).toBe('好名字');
    expect((await vault.list('20_项目')).some((e) => e.kind === 'dir' && e.name === '好名字')).toBe(true);
  });

  it('links still work with two projects', async () => {
    const { vault } = await fixture();
    await create(vault, '企业AI助手');

    expect(await vault.resolveLink('[[项目]]', '20_项目/企业AI助手/日志.md')).toEqual({ ok: true, path: '20_项目/企业AI助手/项目.md' });
    expect(await vault.resolveLink('[[项目]]', '20_项目/P/WS-A/workspace.md')).toEqual({ ok: true, path: '20_项目/P/项目.md' });

    const shared = await vault.read('10_资料库/资料乙.md');
    await vault.write(
      '10_资料库/资料乙.md',
      { frontmatter: shared.data, body: `${shared.body.trimEnd()}\n- 「新论断」 ^c2\n` },
      { overwrite: true },
    );
    const rewritten = await vault.read('10_资料库/资料乙.md');
    expect(rewritten.data.relates_to).toEqual(['[[项目]]']);
    expect(rewritten.body).toContain('- 「新论断」 ^c2');
  });
});

describe('POST /api/project/create', () => {
  beforeEach(async () => {
    const { vault, cleanup } = await makeFixtureVault({ '10_资料库/资料乙.md': SOURCE_B });
    cleanups.push(cleanup);
    mocked.vault = vault;
    mocked.role = ROLES.senior;
  });

  const post = (body: unknown) => POST(new Request('http://x/api/project/create', { method: 'POST', body: JSON.stringify(body) }));

  it('creates the project and returns its paths', async () => {
    const res = await post({ name: '企业AI助手', coreQuestion: QUESTION });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      projectPath: '20_项目/企业AI助手',
      notePath: '20_项目/企业AI助手/项目.md',
      logPath: '20_项目/企业AI助手/日志.md',
    });
  });

  it('403 for a Junior', async () => {
    mocked.role = ROLES.juniorA;
    const res = await post({ name: '企业AI助手', coreQuestion: QUESTION });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });
  });

  it('409 on a repeat', async () => {
    await post({ name: '企业AI助手', coreQuestion: QUESTION });
    const res = await post({ name: '企业AI助手', coreQuestion: QUESTION });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'exists' });
  });

  it('400 for a bad name', async () => {
    const res = await post({ name: 'a/b', coreQuestion: 'q' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_name' });
  });

  it('400 for a body without coreQuestion', async () => {
    const res = await post({ name: '企业AI助手' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });
});
