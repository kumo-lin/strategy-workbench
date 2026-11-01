/** 2.4 — hardened Search/Fetch client: retry, 429 backoff, timeout, call counting, budget. */
import { describe, expect, it } from 'vitest';
import { WebToolsError, type SearchResponse, type WebToolsClient } from '@/lib/deepseek/web-tools';
import { createResilientWebClient, WebBudgetExceededError } from '@/lib/research/web-client';

const okSearch: SearchResponse = { results: [] };

function scripted(steps: Array<'ok' | number | 'net'>) {
  let calls = 0;
  const inner: WebToolsClient = {
    async search() {
      const s = steps[Math.min(calls++, steps.length - 1)];
      if (s === 'ok') return okSearch;
      if (s === 'net') throw new TypeError('fetch failed');
      throw new WebToolsError(s, `HTTP ${s}`);
    },
    async fetch() {
      const s = steps[Math.min(calls++, steps.length - 1)];
      if (s === 'ok') return { title: 't', content: 'c' };
      if (s === 'net') throw new TypeError('fetch failed');
      throw new WebToolsError(s, `HTTP ${s}`);
    },
  };
  return { inner, calls: () => calls };
}

function sleeper() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

describe('createResilientWebClient', () => {
  it('retries a 429 with growing backoff, then succeeds; counts ONE logical search', async () => {
    const { inner, calls } = scripted([429, 429, 'ok']);
    const s = sleeper();
    const client = createResilientWebClient(inner, { sleep: s.sleep, random: () => 0, baseDelayMs: 100 });
    await client.search({ query: 'x' });
    expect(calls()).toBe(3);
    expect(s.delays).toHaveLength(2);
    expect(s.delays[1]).toBeGreaterThan(s.delays[0]);
    expect(client.usage()).toMatchObject({ searches: 1, fetches: 0, retries: 2 });
  });

  it('retries 5xx and network errors', async () => {
    const { inner, calls } = scripted([503, 'net', 'ok']);
    const client = createResilientWebClient(inner, { sleep: sleeper().sleep, random: () => 0 });
    await client.search({ query: 'x' });
    expect(calls()).toBe(3);
  });

  it('does not retry other 4xx', async () => {
    const { inner, calls } = scripted([400, 'ok']);
    const client = createResilientWebClient(inner, { sleep: sleeper().sleep });
    await expect(client.search({ query: 'x' })).rejects.toMatchObject({ status: 400 });
    expect(calls()).toBe(1);
  });

  it('gives up after maxRetries and rethrows the last error', async () => {
    const { inner, calls } = scripted([429]);
    const client = createResilientWebClient(inner, { sleep: sleeper().sleep, maxRetries: 2 });
    await expect(client.search({ query: 'x' })).rejects.toMatchObject({ status: 429 });
    expect(calls()).toBe(3); // 1 try + 2 retries
  });

  it('times out a hung call (and retries it)', async () => {
    let calls = 0;
    const inner: WebToolsClient = {
      search: (_req, signal) =>
        new Promise((resolve, reject) => {
          calls++;
          if (calls === 2) return resolve(okSearch);
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
        }),
      fetch: async () => ({ title: '', content: '' }),
    };
    const client = createResilientWebClient(inner, { sleep: sleeper().sleep, searchTimeoutMs: 20 });
    await client.search({ query: 'x' });
    expect(calls).toBe(2);
  });

  it('a caller abort is not retried', async () => {
    let calls = 0;
    const inner: WebToolsClient = {
      search: (_req, signal) =>
        new Promise((_resolve, reject) => {
          calls++;
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
        }),
      fetch: async () => ({ title: '', content: '' }),
    };
    const client = createResilientWebClient(inner, { sleep: sleeper().sleep });
    const ac = new AbortController();
    const p = client.search({ query: 'x' }, ac.signal);
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it('refuses past the search budget WITHOUT calling the API; fetch has its own budget', async () => {
    const { inner, calls } = scripted(['ok']);
    const client = createResilientWebClient(inner, { budget: { maxSearches: 2, maxFetches: 1 }, sleep: sleeper().sleep });
    await client.search({ query: 'a' });
    await client.search({ query: 'b' });
    expect(client.remaining()).toEqual({ searches: 0, fetches: 1 });
    const before = calls();
    await expect(client.search({ query: 'c' })).rejects.toBeInstanceOf(WebBudgetExceededError);
    expect(calls()).toBe(before);
    await client.fetch({ url: 'https://example.com/a' });
    await expect(client.fetch({ url: 'https://example.com/b' })).rejects.toMatchObject({ kind: 'fetch', limit: 1 });
    expect(client.usage()).toMatchObject({ searches: 2, fetches: 1 });
  });

  it('a failed logical call still consumes budget (the API was hit)', async () => {
    const { inner } = scripted([400]);
    const client = createResilientWebClient(inner, { budget: { maxSearches: 1, maxFetches: 1 }, sleep: sleeper().sleep });
    await expect(client.search({ query: 'x' })).rejects.toBeDefined();
    expect(client.remaining().searches).toBe(0);
  });
});
