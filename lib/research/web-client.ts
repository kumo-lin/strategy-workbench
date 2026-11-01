/**
 * M2-01 — resilient wrapper around the frozen DeepSeek Search / Fetch client
 * (`lib/deepseek/web-tools.ts`).
 *
 * Turns any `WebToolsClient` into a client that adds:
 *   - budget enforcement (checked BEFORE the API is called),
 *   - logical call + retry accounting,
 *   - retries with jittered exponential backoff for 429 / 5xx / network errors / our own timeouts,
 *   - per-attempt timeouts merged with the caller's `AbortSignal`.
 *
 * Deliberately standalone (no Deep Research imports) so M4's plain web mode can reuse it.
 */
import { WebToolsError, type WebToolsClient } from '@/lib/deepseek/web-tools';

export interface WebBudget {
  maxSearches: number;
  maxFetches: number;
}

/** Thrown BEFORE calling the API when the budget for `kind` is used up. */
export class WebBudgetExceededError extends Error {
  readonly kind: 'search' | 'fetch';
  readonly limit: number;

  constructor(kind: 'search' | 'fetch', limit: number) {
    super(`web ${kind} budget exhausted (${limit})`);
    this.name = 'WebBudgetExceededError';
    this.kind = kind;
    this.limit = limit;
  }
}

export interface ResilientWebOptions {
  /** Default: no limit. */
  budget?: WebBudget;
  /** Retries AFTER the first try. Default: 3. */
  maxRetries?: number;
  /** Default: 500. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff wait. Default: 8000. */
  maxDelayMs?: number;
  /** Default: 20_000. */
  searchTimeoutMs?: number;
  /** Default: 30_000. */
  fetchTimeoutMs?: number;
  /** Injectable for tests; default setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0,1); default Math.random. */
  random?: () => number;
}

export interface MeteredWebClient extends WebToolsClient {
  /** Logical calls made so far (a call with retries counts once) + total retries. */
  usage(): { searches: number; fetches: number; retries: number };
  /** Budget left; Infinity when no budget was given. */
  remaining(): { searches: number; fetches: number };
}

type CallKind = 'search' | 'fetch';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 20_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function abortReason(reason: unknown): unknown {
  if (reason !== undefined && reason !== null) return reason;
  return new DOMException('This operation was aborted', 'AbortError');
}

/** 429 / 5xx / network TypeError / our own per-attempt timeout are retryable; other 4xx are not. */
function isRetryable(err: unknown, timedOut: boolean): boolean {
  if (timedOut) return true;
  if (err instanceof WebToolsError) return err.status === 429 || err.status >= 500;
  // Undici surfaces connection problems as `TypeError: fetch failed`.
  return err instanceof TypeError;
}

/**
 * One attempt: races the inner call against our timeout and the caller's abort.
 * `markTimedOut` is invoked (synchronously, before aborting) so the caller can tell
 * "we timed out" apart from "the caller cancelled".
 */
function attemptWithTimeout<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  markTimedOut: () => void,
): Promise<T> {
  if (callerSignal?.aborted) return Promise.reject(abortReason(callerSignal.reason));

  const controller = new AbortController();
  const timeoutReason = new DOMException(`web request timed out after ${timeoutMs}ms`, 'TimeoutError');

  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachCaller: (() => void) | undefined;

  const timeoutGuard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      markTimedOut();
      controller.abort(timeoutReason);
      reject(timeoutReason);
    }, timeoutMs);
  });

  const callerGuard = new Promise<never>((_, reject) => {
    if (callerSignal) {
      const onAbort = () => reject(abortReason(callerSignal.reason));
      callerSignal.addEventListener('abort', onAbort, { once: true });
      detachCaller = () => callerSignal.removeEventListener('abort', onAbort);
    }
  });

  const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;

  const attempt = new Promise<T>((resolve, reject) => {
    try {
      resolve(call(signal));
    } catch (err) {
      reject(err);
    }
  });

  return Promise.race([attempt, timeoutGuard, callerGuard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    detachCaller?.();
  });
}

export function createResilientWebClient(inner: WebToolsClient, opts: ResilientWebOptions = {}): MeteredWebClient {
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const searchTimeoutMs = opts.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const budget = opts.budget;

  let searches = 0;
  let fetches = 0;
  let retries = 0;

  const counter = (kind: CallKind): number => (kind === 'search' ? searches : fetches);

  const limitFor = (kind: CallKind): number => {
    if (!budget) return Number.POSITIVE_INFINITY;
    return kind === 'search' ? budget.maxSearches : budget.maxFetches;
  };

  /** Budget check + immediate accounting (a failed logical call still consumes budget). */
  const reserve = (kind: CallKind): void => {
    const limit = limitFor(kind);
    if (counter(kind) >= limit) throw new WebBudgetExceededError(kind, limit);
    if (kind === 'search') searches += 1;
    else fetches += 1;
  };

  /**
   * `baseDelayMs * 2^(retryNumber-1) * (1 + random()*0.25)`, doubled again when the
   * last error was a 429. `retryNumber` is scoped to THIS logical call (first retry = 1).
   */
  const backoffMs = (retryNumber: number, err: unknown): number => {
    const jitter = 1 + random() * 0.25;
    let delay = baseDelayMs * 2 ** (retryNumber - 1) * jitter;
    if (err instanceof WebToolsError && err.status === 429) delay *= 2;
    return Math.min(Math.max(0, delay), maxDelayMs);
  };

  /** Waits, but returns early (without throwing) if the caller cancels — the loop then bails out. */
  const sleepUnlessAborted = async (ms: number, callerSignal: AbortSignal | undefined): Promise<void> => {
    if (!callerSignal) {
      await sleep(ms);
      return;
    }
    if (callerSignal.aborted) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        callerSignal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => finish();
      callerSignal.addEventListener('abort', onAbort, { once: true });
      void sleep(ms).then(finish, finish);
    });
  };

  const run = async <T>(
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      if (callerSignal?.aborted) throw abortReason(callerSignal.reason);

      let timedOut = false;
      try {
        return await attemptWithTimeout(call, timeoutMs, callerSignal, () => {
          timedOut = true;
        });
      } catch (err) {
        // Caller cancellation wins: never retry, never sleep.
        if (callerSignal?.aborted) throw err;
        if (attempt >= maxRetries || !isRetryable(err, timedOut)) throw err;

        // Backoff is based on the retry index within this logical call, not client lifetime.
        const retryNumber = attempt + 1;
        retries += 1;
        await sleepUnlessAborted(backoffMs(retryNumber, err), callerSignal);
      }
    }
  };

  return {
    async search(req, signal) {
      reserve('search');
      return run(searchTimeoutMs, signal, (attemptSignal) => inner.search(req, attemptSignal));
    },
    async fetch(req, signal) {
      reserve('fetch');
      return run(fetchTimeoutMs, signal, (attemptSignal) => inner.fetch(req, attemptSignal));
    },
    usage() {
      return { searches, fetches, retries };
    },
    remaining() {
      if (!budget) {
        return { searches: Number.POSITIVE_INFINITY, fetches: Number.POSITIVE_INFINITY };
      }
      return {
        searches: Math.max(0, budget.maxSearches - searches),
        fetches: Math.max(0, budget.maxFetches - fetches),
      };
    },
  };
}
