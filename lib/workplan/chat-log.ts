/**
 * The chat history of a Workspace page, per role, stored in the vault as machine data:
 * `<workspacePath>/对话/<role id>.json`. The vault lists `.md` only, so the file is never read or validated
 * as a note. Same shape of file handling as the evidence record (atomic rename, path stays inside the vault).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Vault } from '@/lib/vault';

export const MAX_CHAT_LOG_BYTES = 2_000_000;

const ROLE_ID_RE = /^[a-z0-9-]+$/;

/** `<workspacePath>/对话/<roleId>.json` (vault-relative, posix). Throws on an id or path that could escape it. */
export function chatLogPath(workspacePath: string, roleId: string): string {
  if (!ROLE_ID_RE.test(roleId)) throw new Error(`invalid role id: ${roleId}`);
  if (workspacePath.startsWith('/') || workspacePath.includes('..')) throw new Error(`invalid workspace path: ${workspacePath}`);
  return path.posix.join(workspacePath, '对话', `${roleId}.json`);
}

function absolute(vault: Vault, rel: string): string {
  const root = path.resolve(vault.root);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error(`path escapes the vault: ${rel}`);
  return full;
}

/** The saved messages, or null when there is no file or it cannot be read as a log. */
export async function readChatLog(vault: Vault, workspacePath: string, roleId: string): Promise<unknown[] | null> {
  try {
    const parsed = JSON.parse(await readFile(absolute(vault, chatLogPath(workspacePath, roleId)), 'utf8')) as { messages?: unknown };
    return Array.isArray(parsed.messages) ? parsed.messages : null;
  } catch {
    return null;
  }
}

/** Too large to store: the caller answers 413 instead of dropping the chat silently. */
export class ChatLogTooLarge extends Error {
  constructor(readonly bytes: number) {
    super(`对话日志太大（${bytes} 字节，上限 ${MAX_CHAT_LOG_BYTES}）`);
    this.name = 'ChatLogTooLarge';
  }
}

/** Writes the log (atomic); `bytes` is the size of the file on disk. */
export async function writeChatLog(vault: Vault, workspacePath: string, roleId: string, messages: unknown[]): Promise<{ bytes: number }> {
  const full = absolute(vault, chatLogPath(workspacePath, roleId));
  const text = `${JSON.stringify({ version: 1, saved_at: new Date().toISOString(), messages }, null, 1)}\n`;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_CHAT_LOG_BYTES) throw new ChatLogTooLarge(bytes);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, full);
  return { bytes };
}

/** Which history the page starts from: the server's if it has any, else the browser's, else []. Never drops a longer history for a shorter one. */
export function pickHistory(server: unknown[] | null, local: unknown[]): unknown[] {
  if (!server) return local;
  return server.length >= local.length ? server : local;
}
