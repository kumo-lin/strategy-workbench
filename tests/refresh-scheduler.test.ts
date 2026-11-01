/** When the page re-renders after vault writes: debounced, one refresh per burst, paused while hidden, never stacked. */
import { describe, expect, it } from 'vitest';
import { createRefreshScheduler } from '@/lib/refresh-scheduler';

/** Fake clock: timers fire in order as `advance` moves time. */
function setup(opts: { debounceMs?: number; maxWaitMs?: number; inFlightTimeoutMs?: number } = {}) {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let hidden = false;
  let refreshes = 0;
  const s = createRefreshScheduler({
    ...opts,
    refresh: () => void refreshes++,
    isHidden: () => hidden,
    now: () => t,
    setTimer: (fn, ms) => {
      timers.set(++seq, { at: t + ms, fn });
      return seq;
    },
    clearTimer: (id) => void timers.delete(id as number),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
  };
  return { s, advance, count: () => refreshes, hide: (h: boolean) => (hidden = h) };
}

describe('refresh scheduler', () => {
  it('many events in a burst make one refresh, 1.5 s after the last one', () => {
    const { s, advance, count } = setup();
    for (let i = 0; i < 10; i++) {
      s.notify();
      advance(300);
    }
    expect(count()).toBe(0); // 300 ms after the last event: still inside the debounce window
    advance(1100);
    expect(count()).toBe(0); // 1.4 s after it
    advance(200);
    expect(count()).toBe(1); // 1.6 s after it
    advance(60_000);
    expect(count()).toBe(1);
  });

  it('a steady stream does not starve the page: it still refreshes every maxWait (6 s)', () => {
    const { s, advance, count } = setup();
    for (let i = 0; i < 40; i++) {
      s.notify();
      advance(500); // never quiet for 1.5 s
      if (count() === 1) s.done();
    }
    expect(count()).toBeGreaterThanOrEqual(2);
    expect(count()).toBeLessThanOrEqual(4); // 20 s of events, not 40 refreshes
  });

  it('a hidden page does not refresh; it refreshes once when it becomes visible, for any number of events', () => {
    const { s, advance, count, hide } = setup();
    hide(true);
    for (let i = 0; i < 20; i++) {
      s.notify();
      advance(1000);
    }
    expect(count()).toBe(0);
    s.visibilityChanged(); // still hidden: nothing
    advance(5000);
    expect(count()).toBe(0);
    hide(false);
    s.visibilityChanged();
    advance(1600);
    expect(count()).toBe(1);
    advance(60_000);
    expect(count()).toBe(1);
  });

  it('becoming visible with nothing changed does not refresh', () => {
    const { s, advance, count, hide } = setup();
    hide(true);
    hide(false);
    s.visibilityChanged();
    advance(10_000);
    expect(count()).toBe(0);
  });

  it('a refresh still rendering is not stacked on: events during it wait, and one more follows when it finishes', () => {
    const { s, advance, count } = setup();
    s.notify();
    advance(1600);
    expect(count()).toBe(1); // in flight, not done
    for (let i = 0; i < 6; i++) {
      s.notify();
      advance(2000);
    }
    expect(count()).toBe(1); // 12 s and 6 events later: still just the one
    s.done();
    advance(1600);
    expect(count()).toBe(2);
    s.done();
    advance(60_000);
    expect(count()).toBe(2); // nothing changed since
  });

  it('no event during the refresh means no catch-up refresh', () => {
    const { s, advance, count } = setup();
    s.notify();
    advance(1600);
    s.done();
    advance(60_000);
    expect(count()).toBe(1);
  });

  it('a refresh that never reports back is released after the timeout, so the page does not freeze', () => {
    const { s, advance, count } = setup({ inFlightTimeoutMs: 15_000 });
    s.notify();
    advance(1600);
    s.notify();
    advance(14_000);
    expect(count()).toBe(1);
    advance(3000); // timeout fires, the pending event is flushed
    expect(count()).toBe(2);
  });

  it('dispose stops everything', () => {
    const { s, advance, count } = setup();
    s.notify();
    s.dispose();
    advance(60_000);
    expect(count()).toBe(0);
    s.notify();
    advance(60_000);
    expect(count()).toBe(0);
  });
});
