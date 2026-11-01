'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { createRefreshScheduler, type RefreshScheduler } from '@/lib/refresh-scheduler';

/**
 * Re-render server components when a vault file changes (Obsidian or another window).
 * Debounced, paused while the page is hidden, never stacked on a refresh still rendering:
 * see lib/refresh-scheduler.ts for why.
 */
export function VaultLiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const scheduler = useRef<RefreshScheduler | null>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    const s = createRefreshScheduler({
      refresh: () => startTransition(() => router.refresh()),
      isHidden: () => document.hidden,
    });
    scheduler.current = s;
    const es = new EventSource('/api/vault/events');
    es.onmessage = () => s.notify();
    const onVisible = () => s.visibilityChanged();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      es.close();
      s.dispose();
      scheduler.current = null;
    };
  }, [router]);

  // the transition stays pending until the server render has arrived
  useEffect(() => {
    if (wasPending.current && !pending) scheduler.current?.done();
    wasPending.current = pending;
  }, [pending]);
  return null;
}
