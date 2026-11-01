/**
 * The e2e mocks (`MODEL_MOCK=1`, `WEB_TOOLS=mock`): the production path is unchanged without the
 * env vars, and with them the answers are scripted and repeatable.
 */
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { getWebToolsClient } from '@/lib/deepseek';
import { getModel, ModelConfigError } from '@/lib/models/provider';
import { nextStep, readTurn, type PromptMessage } from '@/lib/testing/mock-agent';
import { makeFixtureVault } from '../helpers/fixture-vault';

const WS = '20_项目/P/WS-A 买方';
const system = (extra = '') => `当前角色：Junior A（junior）。当前阶段：拆题中。Workspace：${WS}。\n规则：…${extra}`;
const env = (vars: Record<string, string> = {}) => ({ NODE_ENV: 'test', ...vars }) as NodeJS.ProcessEnv;
const user = (text: string): PromptMessage => ({ role: 'user', content: [{ type: 'text', text }] });
const call = (toolName: string): PromptMessage => ({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: toolName, toolName, input: {} }] });
const result = (toolName: string): PromptMessage => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: toolName, toolName, output: {} }] });

describe('MODEL_MOCK=1', () => {
  it('without the env var nothing changes: the configured provider still needs its key', async () => {
    const { vault, cleanup } = await makeFixtureVault();
    try {
      await expect(getModel({ vault, env: env() })).rejects.toBeInstanceOf(ModelConfigError);
    } finally {
      await cleanup();
    }
  });

  it('with the env var no key is needed, the provider still comes from the config, and the orchestrated steps get scripted JSON', async () => {
    const { vault, cleanup } = await makeFixtureVault();
    try {
      const resolved = await getModel({ vault, env: env({ MODEL_MOCK: '1' }) });
      expect(resolved.providerId).toBe('alpha'); // `active` in the config: what the pages show follows it
      expect(resolved.provider.model).toBe('alpha-1');
      expect((await getModel({ vault, providerId: 'beta', env: env({ MODEL_MOCK: '1' }) })).provider.model).toBe('beta-1');
      const out = await generateText({ model: resolved.model, prompt: '目标：补缺\n请给出两组查询：\n- kb_queries\n- web_queries' });
      expect(JSON.parse(out.text)).toMatchObject({ kb_queries: expect.any(Array), web_queries: expect.any(Array) });
      await expect(generateText({ model: resolved.model, prompt: '没有人认识的提示' })).rejects.toThrow(/unrecognised/);
    } finally {
      await cleanup();
    }
  });
});

describe('scripted chat agent', () => {
  const tools = ['ask_user', 'write_draft', 'submit_for_review'];
  const step = async (prompt: PromptMessage[], toolNames = tools) => nextStep(readTurn(prompt, toolNames));

  it('follows the tool calls made since the last user message, so a reload lands on the same step', async () => {
    const start = [{ role: 'system', content: system() }, user('我们开始共创这个 Workspace 的 workplan 吧。')];
    expect(await step(start)).toMatchObject({ call: { toolName: 'ask_user' } });
    const answered1 = [...start, call('ask_user'), result('ask_user')];
    expect(await step(answered1)).toMatchObject({ call: { toolName: 'ask_user' } });
    const answered2 = [...answered1, call('ask_user'), result('ask_user')];
    expect(await step(answered2)).toMatchObject({ call: { toolName: 'write_draft', input: { note_type: 'workplan', name: 'workplan v1' } } });
    // links use the full Workspace folder name, not just "WS-A"
    const draft = await step(answered2);
    expect(JSON.stringify(draft)).toContain(`${WS}/workspace|WS-A 买方`);
  });

  it('a made-up message gets a plain reply, and comment interpretation needs the comment link in the message', async () => {
    expect(await step([{ role: 'system', content: system() }, user('随便聊聊')])).toEqual({ text: '（mock）收到。' });
    await expect(step([{ role: 'system', content: system() }, user('请帮我解读这条 comment：\n「x」')]).then(() => null)).rejects.toThrow(/comment link/);
    const link = `[[${WS}/review/G1 2026-10-24#^m1]]`;
    const msgs = [{ role: 'system', content: system() }, user(`请帮我解读这条 comment（G1 · m1）：\n「少了反证」\n${link}`), call('ask_user'), result('ask_user'), call('ask_user'), result('ask_user')];
    const v2 = await step(msgs);
    expect(JSON.stringify(v2)).toContain(link);
    expect(JSON.stringify(v2)).toContain('〔m1〕');
  });
});

describe('WEB_TOOLS=mock', () => {
  it('returns the same pages for the same query, whatever the call order', async () => {
    const { vault, cleanup } = await makeFixtureVault();
    try {
      const web = await getWebToolsClient(vault, env({ WEB_TOOLS: 'mock' }));
      const a = await web.search({ query: '企业 AI PC 采购 IT 部门' });
      const other = await web.search({ query: '员工 并不在乎 AI PC' });
      const b = await web.search({ query: '企业 AI PC 采购 IT 部门' });
      expect(a).toEqual(b);
      expect(a.results).toHaveLength(3);
      expect(a.results.map((r) => r.url)).not.toEqual(other.results.map((r) => r.url));
      const page = await web.fetch({ url: a.results[0].url });
      expect(page.content).toContain('IT 部门主导');
      expect(page.content).toContain('并不在乎');
      // the link check on a mock page succeeds without a network
      expect((await fetch(a.results[0].url, { method: 'HEAD' })).status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it('without the env var the real client is still the one asked for its key', async () => {
    const { vault, cleanup } = await makeFixtureVault();
    try {
      await expect(getWebToolsClient(vault, env())).rejects.toThrow(/is not set/);
    } finally {
      await cleanup();
    }
  });
});
