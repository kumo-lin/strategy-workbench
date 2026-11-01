/** Hits every page and API route once (see start-server.ts). Failures are fine: the point is the compile. */
import { WS_A, WS_A_PATH } from './roles';

const POSTS = [
  '/api/workspace/answer',
  '/api/workspace/review/request',
  '/api/workspace/review/comment',
  '/api/workspace/review/decision',
  '/api/research/new',
  '/api/research/plan',
  '/api/research/approve',
  '/api/research/execute',
  // D-64: the routes the To-Be pages added
  '/api/research/interviews',
  '/api/workspace/selection',
  '/api/workspace/plan-final',
  '/api/decision/draft',
  '/api/decision/confirm',
  '/api/asset/publish',
  '/api/project/create',
  '/api/project/confirm',
];

async function until(fn: () => Promise<unknown>, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      await fn();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('warm-up: the app never came up');
}

/** One request that survives a dropped connection (Next closes idle sockets while it compiles); the body is read so the compile has finished. */
async function hit(url: string, init?: RequestInit): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fetch(url, init).then((r) => r.text());
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return '';
}

/** The ask_user call a /api/agent turn ends with: a UI-message SSE body (`data: <json chunk>` lines, then `data: [DONE]`). */
function askUserCallOf(body: string): { toolCallId: string; input: unknown } | undefined {
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice('data: '.length);
    if (raw === '[DONE]') continue;
    try {
      const chunk = JSON.parse(raw) as { type?: string; toolName?: string; toolCallId?: string; input?: unknown };
      if (chunk.type === 'tool-input-available' && chunk.toolName === 'ask_user' && chunk.toolCallId) {
        return { toolCallId: chunk.toolCallId, input: chunk.input };
      }
    } catch {
      // a keep-alive or any other line that is not a JSON chunk
    }
  }
  return undefined;
}

export async function warmUp(base: string): Promise<void> {
  const headers = { cookie: 'sw-role=junior-a', 'content-type': 'application/json' };
  await until(() => fetch(`${base}/`, { headers }));
  const pages = ['/', '/inbox', '/new', '/config', '/library', '/workspace', WS_A, `${WS_A}/files`, `${WS_A}/review`, `${WS_A}/research`, `${WS_A}/research/warm-up`];
  for (const p of pages) await hit(`${base}${p}`, { headers });
  // the event stream never ends: compile the route, then drop the connection
  const sse = new AbortController();
  await fetch(`${base}/api/vault/events`, { signal: sse.signal }).catch(() => undefined);
  sse.abort();
  for (const p of POSTS) await hit(`${base}${p}`, { method: 'POST', headers, body: '{}' });
  // one real agent turn compiles the harness, the prompts and the mock model (a plain text reply: nothing is written)
  const turn = { messages: [{ id: 'w', role: 'user', parts: [{ type: 'text', text: 'warm-up' }] }], workspacePath: WS_A_PATH, track: 'workspace' };
  await hit(`${base}/api/agent`, { method: 'POST', headers, body: JSON.stringify(turn) });

  // Request 1 of the first co-creation: the turn that ends with the first ask_user card — compiles the co-create script.
  const firstUser = { id: 'w', role: 'user', parts: [{ type: 'text', text: '我们开始共创这个 Workspace 的研究计划吧。' }] };
  const asked = await hit(`${base}/api/agent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages: [firstUser], workspacePath: WS_A_PATH, track: 'workspace' }),
  });
  const ask = askUserCallOf(asked);
  // Request 2, the answer to that card: the server runs frame_topic (the frame, the marks, the internal-material pack)
  // and stops at the confirmation card. Nothing is confirmed or composed, so no workplan is written.
  if (ask) {
    const messages = [
      firstUser,
      {
        id: 'a',
        role: 'assistant',
        parts: [{ type: 'tool-ask_user', toolCallId: ask.toolCallId, state: 'output-available', input: ask.input, output: { selected: ['a'] } }],
      },
    ];
    await hit(`${base}/api/agent`, { method: 'POST', headers, body: JSON.stringify({ messages, workspacePath: WS_A_PATH, track: 'workspace' }) });
  }
}
