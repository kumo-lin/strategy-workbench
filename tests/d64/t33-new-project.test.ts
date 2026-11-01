/**
 * D-64 T33 (ui-0b): a new project is framed with the AI in its own phase (project_framing): the first reply asks the
 * three things, the AI drafts the decision contract (推断) and the issue tree; only the Senior confirms (T34).
 */
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { buildProjectContext, executeTool } from '@/lib/harness';
import { PHASE_TOOLS } from '@/lib/harness/phases';
import { createProject } from '@/lib/project/create';
import { createMockModel } from '@/lib/testing/mock-model';
import { nextStep, readTurn } from '@/lib/testing/mock-agent';
import { M1_CONTRACT, M1_ISSUE_TREE } from '@/lib/testing/scripts/m1';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', async (orig) => ({ ...(await orig<typeof import('@/lib/session/role')>()), getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, replace() {} }), usePathname: () => '/new' }));
vi.mock('@/lib/models/provider', async (orig) => ({ ...(await orig<typeof import('@/lib/models/provider')>()), getModel: async () => ({ model: createMockModel(), providerId: 'mock', label: 'mock', model_id: 'mock' }) }));

const TOPIC = '个人 AI 市场将如何演进，对联想意味着什么？';
let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

async function newProject() {
  const fx = await makeFixtureVault();
  cleanup = fx.cleanup;
  mocked.vault = fx.vault;
  mocked.role = ROLES.senior;
  await createProject({ vault: fx.vault, actor: ROLES.senior, name: '新课题', coreQuestion: TOPIC });
  return { ...fx, ctx: await buildProjectContext({ vault: fx.vault, role: ROLES.senior, projectPath: '20_项目/新课题' }) };
}

describe('T33 the phase', () => {
  it('project_framing offers only read_task_context, ask_user, frame_topic, draft_contract, draft_issue_tree', () => {
    expect([...PHASE_TOOLS.project_framing].sort()).toEqual(['ask_user', 'draft_contract', 'draft_issue_tree', 'frame_topic', 'read_task_context']);
  });

  it('the first reply (after reading the task context) asks the three things: the decision, time and place, what not to study', async () => {
    await newProject();
    const { POST } = await import('@/app/api/agent/route');
    const res = await POST(new Request('http://x/api/agent', { method: 'POST', body: JSON.stringify({ workspacePath: '20_项目/新课题', track: 'project', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: TOPIC }] }] }) }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const tools = [...text.matchAll(/"toolName":"([a-z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(tools)]).toEqual(['read_task_context', 'ask_user']);
    const ask = /"toolName":"ask_user","input":(\{.*?\})\}/.exec(text)?.[1] ?? '';
    for (const w of ['决定', '时间和地域', '不研究']) expect(ask).toContain(w);
  });
});

describe('T33 the drafts', () => {
  it('draft_contract writes 决策契约.md as 推断 with every field; once the Senior confirmed it, it is refused', async () => {
    const { ctx, vault } = await newProject();
    await executeTool('draft_contract', { ...M1_CONTRACT, original_question: TOPIC, why: 'x' }, ctx);
    const c = await vault.read('20_项目/新课题/决策契约.md');
    expect(c.data).toMatchObject({ type: 'contract', status: '推断', author: 'AI', question: M1_CONTRACT.question, original_question: TOPIC, out_of_scope: M1_CONTRACT.out_of_scope, approved_by: null });
    await vault.write('20_项目/新课题/决策契约.md', { frontmatter: { ...c.data, status: '已确认', approved_by: 'Senior', approved_at: '2026-10-28' }, body: c.body }, { overwrite: true });
    await expect(executeTool('draft_contract', { ...M1_CONTRACT, why: 'x' }, ctx)).rejects.toThrow('已经由 Senior 确认');
  });

  it('draft_issue_tree writes issue_tree; an unknown owner or a waits_for outside the tree is dropped and said', async () => {
    const { ctx, vault } = await newProject();
    const lines = M1_ISSUE_TREE.lines.map((l, i) => (i === 0 ? { ...l, owner: 'nobody' } : l));
    lines[1] = { ...lines[1], items: [...lines[1].items, { id: 'L5', title: 'x', waits_for: ['Z9'] }] };
    const out = (await executeTool('draft_issue_tree', { question: M1_ISSUE_TREE.question, lines, why: 'x' }, ctx)) as { problems: string[] };
    expect(out.problems.join('；')).toMatch(/nobody.*不是团队里的角色.*Z9 不在议题树里/);
    const tree = (await vault.read('20_项目/新课题/项目.md')).data.issue_tree as { lines: { owner: string | null; items: { id: string; workspace: string | null; waits_for: string[] }[] }[] };
    expect(tree.lines[0].owner).toBeNull();
    expect(tree.lines[1].items.find((i) => i.id === 'L2')).toMatchObject({ workspace: null, waits_for: ['M1'] });
  });

  it('the mock dialog ends in draft_contract then draft_issue_tree, after the user confirmed', async () => {
    const turn = (calls: string[]) => readTurn([{ role: 'system', content: '' }, { role: 'user', content: TOPIC }, ...calls.map((c) => ({ role: 'assistant', content: [{ type: 'tool-call', toolName: c }] }))], [...PHASE_TOOLS.project_framing]);
    const done = ['ask_user', 'frame_topic', 'frame_topic', 'ask_user', 'frame_topic'];
    expect(await nextStep(turn(done))).toMatchObject({ call: { toolName: 'draft_contract', input: { question: M1_CONTRACT.question, original_question: TOPIC } } });
    expect(await nextStep(turn([...done, 'draft_contract']))).toMatchObject({ call: { toolName: 'draft_issue_tree' } });
  });
});

describe('T33 the page', () => {
  it('/new: every text and testid of ui-0b before anything is drafted', async () => {
    const fx = await makeFixtureVault();
    cleanup = fx.cleanup;
    mocked.vault = fx.vault;
    mocked.role = ROLES.senior;
    const { default: Page } = await import('@/app/new/page');
    const out = renderToString((await Page({ searchParams: Promise.resolve({}) })) as never).replace(/<!-- -->/g, '');
    for (const t of ['未命名项目', '草稿', '决策契约', '【待输入 Main Question，定义要支持的决策】', '议题树与工作线', '【待输入 Main Question 进行 Workstream 拆解】', '和 AI 定义问题']) expect(out, t).toContain(t);
    for (const id of ['contract-empty', 'tree-empty', 'framing-chat', 'chat-composer']) expect(out, id).toContain(`data-testid="${id}"`);
  });
});
