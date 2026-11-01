/**
 * The chat log lives in the vault: `<workspacePath>/对话/<role id>.json`. Machine data, like the evidence
 * record — the vault lists `.md` only, so the file is never read or validated as a note (D-56 m1_4a).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/lib/vault';
import { MAX_CHAT_LOG_BYTES, chatLogPath, pickHistory, readChatLog, writeChatLog } from '@/lib/workplan/chat-log';
import { makeM1Vault, WS } from './helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function tempVault(): Promise<{ vault: Vault; root: string }> {
  const { vault, root, cleanup } = await makeM1Vault();
  cleanups.push(cleanup);
  return { vault, root };
}

const MESSAGES = [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text: '我想先聊 workplan。' }] },
  { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '好，先问一个问题。' }] },
];

describe('chatLogPath', () => {
  it('puts the log under 对话 in the workspace', () => {
    expect(chatLogPath('20_项目/P/WS-A', 'junior-a')).toBe('20_项目/P/WS-A/对话/junior-a.json');
    expect(chatLogPath(WS, 'senior')).toBe(`${WS}/对话/senior.json`);
  });

  it('rejects role ids that could escape the folder', () => {
    for (const id of ['', '..', 'junior/a', '../senior', 'junior a', 'Junior-A']) {
      expect(() => chatLogPath(WS, id)).toThrow();
    }
  });

  it('rejects workspace paths that could escape the vault', () => {
    expect(() => chatLogPath('20_项目/P/../WS-A', 'junior-a')).toThrow();
    expect(() => chatLogPath('/20_项目/P/WS-A', 'junior-a')).toThrow();
  });
});

describe('writeChatLog and readChatLog', () => {
  it('writes a versioned json file under 对话 and reads the same messages back', async () => {
    const { vault, root } = await tempVault();
    const { bytes } = await writeChatLog(vault, WS, 'junior-a', MESSAGES);

    const rel = chatLogPath(WS, 'junior-a');
    const raw = await readFile(path.join(root, rel), 'utf8');
    const parsed = JSON.parse(raw) as { version: number; saved_at: string; messages: unknown[] };
    expect(parsed.version).toBe(1);
    expect(parsed.messages).toEqual(MESSAGES);
    expect(Number.isNaN(Date.parse(parsed.saved_at))).toBe(false);
    expect(bytes).toBe(Buffer.byteLength(raw, 'utf8'));
    expect(await readChatLog(vault, WS, 'junior-a')).toEqual(MESSAGES);
  });

  it('overwrites the previous log and leaves no .tmp file behind', async () => {
    const { vault, root } = await tempVault();
    await writeChatLog(vault, WS, 'junior-a', MESSAGES);

    const next = [{ id: 'm3', role: 'user', parts: [{ type: 'text', text: '换一条。' }] }];
    await writeChatLog(vault, WS, 'junior-a', next);

    expect(await readChatLog(vault, WS, 'junior-a')).toEqual(next);
    expect(await readdir(path.join(root, WS, '对话'))).toEqual(['junior-a.json']);
  });

  it('keeps one file per role', async () => {
    const { vault } = await tempVault();
    await writeChatLog(vault, WS, 'junior-a', MESSAGES);
    await writeChatLog(vault, WS, 'senior', []);

    expect(await readChatLog(vault, WS, 'junior-a')).toEqual(MESSAGES);
    expect(await readChatLog(vault, WS, 'senior')).toEqual([]);
  });

  it('returns null when there is no file, when it is not JSON, or when messages is not an array', async () => {
    const { vault, root } = await tempVault();
    expect(await readChatLog(vault, WS, 'junior-a')).toBeNull();

    const file = path.join(root, chatLogPath(WS, 'junior-a'));
    await mkdir(path.dirname(file), { recursive: true });

    await writeFile(file, 'not json {', 'utf8');
    expect(await readChatLog(vault, WS, 'junior-a')).toBeNull();

    await writeFile(file, JSON.stringify({ version: 1, saved_at: '2026-10-27T00:00:00.000Z', messages: { 0: 'x' } }), 'utf8');
    expect(await readChatLog(vault, WS, 'junior-a')).toBeNull();
  });

  it('refuses a log larger than the cap and keeps the previous file untouched', async () => {
    const { vault } = await tempVault();
    await writeChatLog(vault, WS, 'junior-a', MESSAGES);

    const big = [{ id: 'big', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(MAX_CHAT_LOG_BYTES) }] }];
    await expect(writeChatLog(vault, WS, 'junior-a', big)).rejects.toThrow('对话日志太大');
    expect(await readChatLog(vault, WS, 'junior-a')).toEqual(MESSAGES);
  });
});

describe('the vault does not treat the log as a note', () => {
  it('lists 对话 as a folder but never the .json as a note', async () => {
    const { vault } = await tempVault();
    await writeChatLog(vault, WS, 'junior-a', MESSAGES);

    const entries = await vault.list(WS);
    expect(entries.find((e) => e.name === '对话')?.kind).toBe('dir');
    expect(entries.some((e) => e.name.endsWith('.json'))).toBe(false);

    const paths: string[] = [];
    const walk = (nodes: Awaited<ReturnType<typeof vault.tree>>) => {
      for (const n of nodes) {
        paths.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(await vault.tree(WS));
    expect(paths.some((p) => p.endsWith('.json'))).toBe(false);
  });
});

describe('pickHistory', () => {
  const n = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `m${i}` }));

  it('takes the server log when it is longer', () => {
    expect(pickHistory(n(3), n(2))).toEqual(n(3));
  });

  it('keeps the browser copy when it is longer', () => {
    expect(pickHistory(n(2), n(5))).toEqual(n(5));
  });

  it('falls back to the browser copy when the server has none', () => {
    expect(pickHistory(null, n(2))).toEqual(n(2));
  });

  it('returns [] when both are empty', () => {
    expect(pickHistory([], [])).toEqual([]);
  });

  it('prefers the server on a tie', () => {
    const server = n(2);
    const local = [{ id: 'other' }];
    expect(pickHistory(server, local)).toBe(server);
  });
});
