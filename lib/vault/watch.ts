/**
 * Vault file watching (PRD §10.5: the app re-reads when Obsidian or another
 * window changes a file). Uses Node's recursive fs.watch (macOS/Windows native;
 * Linux ≥ Node 20). Changes are debounced per path.
 */
import { watch as fsWatch } from 'node:fs';
import path from 'node:path';
import { isHiddenPath } from './vault';

export interface VaultChange {
  /** Vault-relative path. */
  path: string;
  at: number;
}

export function watchVault(root: string, onChange: (c: VaultChange) => void, debounceMs = 120): () => void {
  const timers = new Map<string, NodeJS.Timeout>();
  const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString().split(path.sep).join('/');
    if (isHiddenPath(rel)) return;
    clearTimeout(timers.get(rel));
    timers.set(
      rel,
      setTimeout(() => {
        timers.delete(rel);
        onChange({ path: rel, at: Date.now() });
      }, debounceMs),
    );
  });
  return () => {
    watcher.close();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}

type Listener = (c: VaultChange) => void;
interface SharedWatcher {
  root: string;
  listeners: Set<Listener>;
  close: (() => void) | null;
}

const KEY = '__strategyWorkbenchVaultWatcher';

/** One process-wide watcher shared by all subscribers (survives Next dev HMR). */
export function subscribeVaultChanges(root: string, listener: Listener): () => void {
  const g = globalThis as unknown as Record<string, SharedWatcher | undefined>;
  let shared = g[KEY];
  if (!shared || shared.root !== root) {
    shared?.close?.();
    shared = { root, listeners: new Set(), close: null };
    g[KEY] = shared;
  }
  const s = shared;
  s.listeners.add(listener);
  if (!s.close) s.close = watchVault(root, (c) => s.listeners.forEach((l) => l(c)));
  return () => {
    s.listeners.delete(listener);
    if (s.listeners.size === 0 && s.close) {
      s.close();
      s.close = null;
    }
  };
}
