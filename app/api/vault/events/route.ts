/** Server-sent events: one `data: {"path": ...}` per vault file change. */
import { getVault, subscribeVaultChanges } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          // stream already closed
        }
      };
      send(': connected\n\n');
      unsubscribe = subscribeVaultChanges(getVault().root, (c) => send(`data: ${JSON.stringify(c)}\n\n`));
      ping = setInterval(() => send(': ping\n\n'), 25_000);
      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      unsubscribe();
      clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
