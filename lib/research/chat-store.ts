/**
 * The grill chat of one investigation survives a page refresh. Per-browser convenience only
 * (the durable record is the vault: the plan and the log); storage can be missing or full.
 */
import type { UIMessage } from 'ai';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const chatStorageKey = (actor: string, researchDir: string) => `sw-research-chat:${actor}:${researchDir}`;

export function loadChat(storage: StorageLike | undefined, key: string): UIMessage[] {
  try {
    const raw = storage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

/** Never saves an empty list (on first commit `messages` is still [] and would wipe the saved chat) or a half-streamed one. */
export function saveChat(storage: StorageLike | undefined, key: string, messages: UIMessage[], status: string): boolean {
  if (messages.length === 0 || status === 'submitted' || status === 'streaming') return false;
  try {
    storage?.setItem(key, JSON.stringify(messages));
    return true;
  } catch {
    return false;
  }
}
