import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadRoles } from '@/lib/config/roles';
import { buildToolContext, type ToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { roleOfTask } from '@/lib/research/model-role';
import { clearPageCache } from '@/lib/research/page-cache';
import { resolveRunModels } from '@/lib/research/run-models';
import { ResearchRun } from '@/lib/research/run';
import { rewriteReport } from '@/lib/research/rewrite';
import type { MeteredWebClient } from '@/lib/research/web-client';
import { createVault } from '@/lib/vault';
import { fakeWeb, scriptedModel, setup } from './research-fixture';

vi.setConfig({ testTimeout: 900_000 });

const roots: string[] = [];
let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
  vi.stubEnv('MODEL_PROVIDER', '');
  vi.stubEnv('MODEL_MOCK', '');
  vi.stubEnv('DEEPSEEK_API_KEY', 'fake-deepseek-key');
  vi.stubEnv('MOONSHOT_API_KEY', 'fake-moonshot-key');
  vi.stubEnv('MOCK_API_KEY', 'fake-mock-key');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await cleanup?.();
  cleanup = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function answeringModel(answer: unknown) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(answer) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
}

function llmRun(model: MockLanguageModelV3, judgmentModel?: MockLanguageModelV3) {
  return new ResearchRun({
    ctx: {} as ToolContext,
    mode: 'small',
    model,
    ...(judgmentModel ? { judgmentModel } : {}),
    client: {} as MeteredWebClient,
    emit: () => {},
    contextText: '',
  });
}

async function tempDir(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function demoConfig(opts: { roles?: boolean; mock?: boolean } = {}) {
  const root = await tempDir('m2-model-config-');
  await cp(path.resolve('demo-vault'), root, { recursive: true });
  const configPath = path.join(root, '90_配置/模型.md');
  let text = await readFile(configPath, 'utf8');
  if (opts.mock) text = text.replace('web_tools:\n', `  mock: { label: Mock, base_url: "https://mock.example.com/v1", api_key_env: MOCK_API_KEY, model: mock-1 }\nweb_tools:\n`);
  if (opts.roles) text = text.replace('web_tools:\n', 'roles:\n  judgment: kimi\n  execution: deepseek\nweb_tools:\n');
  await writeFile(configPath, text);
  return createVault(root);
}

describe('research model roles', () => {
  it('maps judgment and execution tasks by the explicit table and judge prefix', () => {
    const cases: [string, 'judgment' | 'execution'][] = [
      ['judge:C1', 'judgment'],
      ['judge:C1:verdict', 'judgment'],
      ['summary', 'judgment'],
      ['summary:conclusion', 'judgment'],
      ['recommend', 'judgment'],
      ['recommend:repair', 'judgment'],
      ['queries:C1-Q1:support', 'execution'],
      ['evaluate:C1-Q1', 'execution'],
      ['repair:C1', 'execution'],
      ['repair:summary', 'execution'],
      ['citation-fit', 'execution'],
      ['citation-fit:repair', 'execution'],
      ['number-carried', 'execution'],
      ['shorten', 'execution'],
      ['unknown-task', 'execution'],
    ];
    for (const [task, role] of cases) expect(roleOfTask(task), task).toBe(role);
  });

  it('sends judgments to judgmentModel and instruction-following calls to model', async () => {
    const execution = answeringModel({ source: 'execution' });
    const judgment = answeringModel({ source: 'judgment' });
    const run = llmRun(execution, judgment);
    const schema = z.object({ source: z.string() });
    const prompt = { system: 'test', prompt: 'test' };

    await expect(run.llm('judge:C1', prompt, schema)).resolves.toEqual({ source: 'judgment' });
    await expect(run.llm('queries:C1-Q1:support', prompt, schema)).resolves.toEqual({ source: 'execution' });
    expect(judgment.doGenerateCalls).toHaveLength(1);
    expect(execution.doGenerateCalls).toHaveLength(1);
  });

  it('uses model for both roles when no judgmentModel is injected', async () => {
    const model = answeringModel({ source: 'one' });
    const run = llmRun(model);
    const schema = z.object({ source: z.string() });
    const prompt = { system: 'test', prompt: 'test' };

    await run.llm('judge:C1', prompt, schema);
    await run.llm('queries:C1-Q1:support', prompt, schema);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('resolveRunModels reuses an injected model and records no separate judgment provider', async () => {
    const model = answeringModel({});
    const resolved = await resolveRunModels(await demoConfig(), { model });

    expect(resolved.model).toBe(model);
    expect(resolved.judgmentModel).toBe(model);
    expect(resolved.modelInfo).toEqual({ providerId: 'custom', label: 'custom', model: 'custom' });
    expect(resolved.judgmentInfo).toBeNull();
  });

  it('resolveRunModels resolves different judgment and execution providers', async () => {
    const resolved = await resolveRunModels(await demoConfig({ roles: true }));

    expect(resolved.modelInfo.providerId).toBe('deepseek');
    expect(resolved.judgmentInfo?.providerId).toBe('kimi');
    expect(resolved.judgmentModel).not.toBe(resolved.model);
  });

  it('resolveRunModels reuses one model when the vault has no roles', async () => {
    const resolved = await resolveRunModels(await demoConfig());

    expect(resolved.modelInfo.providerId).toBe('deepseek');
    expect(resolved.judgmentModel).toBe(resolved.model);
    expect(resolved.judgmentInfo).toBeNull();
  });

  it('MODEL_PROVIDER=mock overrides both roles to one mock model', async () => {
    vi.stubEnv('MODEL_PROVIDER', 'mock');
    const resolved = await resolveRunModels(await demoConfig({ roles: true, mock: true }));

    expect(resolved.modelInfo.providerId).toBe('mock');
    expect(resolved.judgmentModel).toBe(resolved.model);
    expect(resolved.judgmentInfo).toBeNull();
  });

  it('an injected-model run still delivers and omits judgmentModel from research_run', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const sm = scriptedModel();
    const result = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });

    expect(result.delivered).toBe(true);
    const report = await fx.vault.read(result.reportPath);
    expect(report.data.research_run).not.toHaveProperty('judgmentModel');
  });
});

const SNAPSHOT = path.resolve('demo-vault/.snapshots/S3-D48');
const frozenCases = [
  {
    name: 'WS-A 报告 v10',
    workspace: '20_项目/个人AI战略/WS-A 买方',
    dir: '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑（问题树）',
    report: '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑（问题树）/报告 v10.md',
  },
  {
    name: 'W5 报告 v7',
    workspace: '20_项目/个人AI战略/W5 联想的位置',
    dir: '20_项目/个人AI战略/W5 联想的位置/调查/联想的位置',
    report: '20_项目/个人AI战略/W5 联想的位置/调查/联想的位置/报告 v7.md',
  },
];

async function rerenderFrozen(testCase: (typeof frozenCases)[number], roles: boolean, model: MockLanguageModelV3) {
  const root = await tempDir('m2-frozen-roles-');
  await cp(SNAPSHOT, root, { recursive: true });
  if (roles) {
    const configPath = path.join(root, '90_配置/模型.md');
    const text = await readFile(configPath, 'utf8');
    await writeFile(configPath, text.replace('web_tools:\n', 'roles:\n  judgment: kimi\n  execution: deepseek\nweb_tools:\n'));
  }
  const vault = createVault(root);
  const ws = await vault.readTyped(`${testCase.workspace}/workspace.md`, 'workspace');
  const role = (await loadRoles(vault)).find((r) => r.name === ws.note.owner);
  if (!role) throw new Error('角色配置里没有 workspace 的负责人');
  const ctx = await buildToolContext({
    vault,
    role,
    workspacePath: testCase.workspace,
    researchDir: testCase.dir,
    track: 'research',
    now: () => new Date('2026-10-27T10:00:00Z'),
  });
  const result = await rewriteReport({ ctx, reportPath: testCase.report, model, rerender: { note: '模型角色路由的冻结对照' } });
  return (await vault.read(result.reportPath)).body;
}

describe('frozen report rerenders', () => {
  it.each(frozenCases)('$name is byte-identical with and without model roles, without a model call', async (testCase) => {
    const throwingModel = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error('rerender must not call a model');
      },
    });

    const withoutRoles = await rerenderFrozen(testCase, false, throwingModel);
    const withRoles = await rerenderFrozen(testCase, true, throwingModel);

    expect(withRoles).toBe(withoutRoles);
    expect(throwingModel.doGenerateCalls).toHaveLength(0);
  });
});
