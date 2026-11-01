'use client';

/**
 * The Workspace chat history: the vault is the durable home (`<workspacePath>/对话/<role id>.json`, through
 * `/api/workspace/chat`); localStorage is the per-browser fallback it falls back to when the fetch fails.
 * Never saves before the history is loaded, so the first empty commit cannot wipe a saved chat.
 */
import type { UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';

const storageKey = (actorName: string, workspacePath: string) => `sw-chat:${actorName}:${workspacePath}`;

/** The browser's copy of the chat (the format the page has always used). */
function loadLocal(key: string): UIMessage[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

/**
 * 复核 P2: what the conversation is once the saved history arrives. The read is asynchronous, and a person may already
 * have sent a message (a slow first request, a quick click on 开始共创): replacing the conversation then dropped that
 * message, and the next turn reached the model with no user message. History first, then what was sent, once each.
 */
export function mergeLoadedHistory(history: UIMessage[], current: UIMessage[], opts: { switched?: boolean } = {}): UIMessage[] {
  // after a switch of role or workspace in the same window, what is on screen belongs to the other one: replace it
  if (current.length === 0 || opts.switched) return history;
  const sent = new Set(current.map((m) => m.id));
  return [...history.filter((m) => !sent.has(m.id)), ...current];
}

export function useChatLog(args: {
  workspacePath: string;
  /** For the localStorage key, as before. */
  actorName: string;
  messages: UIMessage[];
  /** The useChat status. */
  status: string;
  setMessages: (m: UIMessage[]) => void;
}): { loaded: boolean } {
  const { workspacePath, actorName, messages, status, setMessages } = args;
  const key = storageKey(actorName, workspacePath);
  // Tied to the key: after a workspace or role switch `loaded` is false again from this render on, so the
  // save effect cannot write the previous history to the new file.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loaded = loadedKey === key;
  // the conversation as it is when the history arrives (the effect below must not close over an old one)
  const latest = useRef(messages);
  // the key of the history loaded last in this window: a different one now means a switch, not a first load
  const loadedBefore = useRef<string | null>(null);
  useEffect(() => {
    latest.current = messages;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const local = loadLocal(key);
    void (async () => {
      let server: UIMessage[] | null = null;
      try {
        const res = await fetch(`/api/workspace/chat?workspacePath=${encodeURIComponent(workspacePath)}`);
        if (res.ok) {
          const json = (await res.json()) as { messages?: unknown };
          // Same rule as pickHistory in lib/workplan/chat-log.ts (that module is server-only): the longer
          // history wins, a tie goes to the server.
          if (Array.isArray(json.messages)) server = json.messages as UIMessage[];
        }
      } catch {
        // Offline or the route failed: the browser's history alone, exactly what the page did before.
      }
      if (cancelled) return;
      setMessages(mergeLoadedHistory(server && server.length >= local.length ? server : local, latest.current, { switched: loadedBefore.current !== null && loadedBefore.current !== key }));
      loadedBefore.current = key;
      setLoadedKey(key);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, workspacePath, setMessages]);

  useEffect(() => {
    // Never save an empty list or a chat that is still being produced/loaded.
    if (!loaded || messages.length === 0 || status === 'submitted' || status === 'streaming') return;
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(messages));
      } catch {
        // storage unavailable: the vault log still has it
      }
      void fetch('/api/workspace/chat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, messages }),
      }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [loaded, messages, status, key, workspacePath]);

  return { loaded };
}
