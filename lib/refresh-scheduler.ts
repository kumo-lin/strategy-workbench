/**
 * When to re-render server components after vault changes (components/shell/vault-live-refresh.tsx).
 * Every write of a run sends an event to every open window, and each refresh is a server render:
 * with four windows on one investigation the renders queued up (0.5 s became 44–51 s). So:
 *   - events within `debounceMs` of each other make ONE refresh; a steady stream still refreshes
 *     every `maxWaitMs`, so a long run does not starve the page
 *   - a hidden page does not refresh; it refreshes once when it becomes visible again
 *   - a refresh that has not finished is never stacked on: one more follows when it finishes
 * Pure (timers and visibility are injected) so it is tested without a DOM.
 */
export interface RefreshSchedulerOptions {
  /** Start a refresh. The scheduler waits for `done()` before it starts another. */
  refresh: () => void;
  isHidden: () => boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  /** A refresh that never reports back (a lost render) is treated as finished after this long. */
  inFlightTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  now?: () => number;
}

export interface RefreshScheduler {
  /** A vault file changed. */
  notify(): void;
  /** The page became visible (or hidden: ignored). */
  visibilityChanged(): void;
  /** The refresh started by `refresh()` finished rendering. */
  done(): void;
  dispose(): void;
}

export function createRefreshScheduler(opts: RefreshSchedulerOptions): RefreshScheduler {
  const debounceMs = opts.debounceMs ?? 1500;
  const maxWaitMs = opts.maxWaitMs ?? 6000;
  const inFlightTimeoutMs = opts.inFlightTimeoutMs ?? 15_000;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const now = opts.now ?? Date.now;

  let dirty = false;
  let firstDirtyAt = 0;
  let timer: unknown;
  let inFlight = false;
  let inFlightTimer: unknown;
  let disposed = false;

  const arm = () => {
    if (timer !== undefined) clearTimer(timer);
    const wait = Math.max(0, Math.min(debounceMs, firstDirtyAt + maxWaitMs - now()));
    timer = setTimer(fire, wait);
  };

  function fire() {
    timer = undefined;
    if (disposed || !dirty) return;
    // hidden: stay dirty, visibilityChanged() starts it; busy: done() starts it
    if (opts.isHidden() || inFlight) return;
    dirty = false;
    inFlight = true;
    inFlightTimer = setTimer(() => done(), inFlightTimeoutMs);
    opts.refresh();
  }

  function done() {
    if (!inFlight) return;
    inFlight = false;
    if (inFlightTimer !== undefined) clearTimer(inFlightTimer);
    inFlightTimer = undefined;
    if (dirty && !disposed) {
      firstDirtyAt = now();
      arm();
    }
  }

  return {
    notify() {
      if (disposed) return;
      if (!dirty) firstDirtyAt = now();
      dirty = true;
      // while hidden or busy nothing is armed: the event that unblocks it arms the one refresh
      if (opts.isHidden() || inFlight) return;
      arm();
    },
    visibilityChanged() {
      if (disposed || opts.isHidden() || !dirty || inFlight) return;
      firstDirtyAt = now();
      arm();
    },
    done,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimer(timer);
      if (inFlightTimer !== undefined) clearTimer(inFlightTimer);
    },
  };
}
