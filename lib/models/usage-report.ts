/**
 * Turns a USAGE_LOG file (lib/models/usage-log.ts) into runs and a markdown table. Calls closer together than `gapMin`
 * minutes belong to the same run. Cost is computed only from prices you pass in (per million tokens), never assumed.
 */
import type { UsageRecord } from './usage-log';

/** Per million tokens, by provider id (as in 90_配置/模型.md). */
export type Prices = Record<string, { inputCacheHit: number; inputCacheMiss: number; output: number }>;

export interface ProviderTotals {
  calls: number;
  errors: number;
  input: number;
  cacheRead: number;
  output: number;
  reasoning: number;
  /** Sum of the calls' own durations (they may overlap). */
  modelMs: number;
  cost: number | null;
}

export interface Run {
  start: string;
  end: string;
  wallMs: number;
  byProvider: Record<string, ProviderTotals>;
}

export function parseUsageLog(text: string): UsageRecord[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageRecord)
    .sort((a, b) => a.at.localeCompare(b.at));
}

function cost(t: Omit<ProviderTotals, 'cost'>, p: Prices[string] | undefined): number | null {
  if (!p) return null;
  return ((t.input - t.cacheRead) * p.inputCacheMiss + t.cacheRead * p.inputCacheHit + t.output * p.output) / 1e6;
}

export function groupRuns(records: UsageRecord[], prices: Prices = {}, gapMin = 10): Run[] {
  const runs: UsageRecord[][] = [];
  let lastEnd = -Infinity;
  for (const r of records) {
    const t0 = Date.parse(r.at);
    if (t0 - lastEnd > gapMin * 60_000) runs.push([]);
    runs[runs.length - 1].push(r);
    lastEnd = Math.max(lastEnd, t0 + r.ms);
  }
  return runs.map((rs) => {
    const byProvider: Record<string, ProviderTotals> = {};
    for (const r of rs) {
      const t = (byProvider[r.providerId] ??= { calls: 0, errors: 0, input: 0, cacheRead: 0, output: 0, reasoning: 0, modelMs: 0, cost: null });
      t.calls += 1;
      if (r.error) t.errors += 1;
      t.input += r.input;
      t.cacheRead += r.cacheRead;
      t.output += r.output;
      t.reasoning += r.reasoning;
      t.modelMs += r.ms;
    }
    for (const [id, t] of Object.entries(byProvider)) t.cost = cost(t, prices[id]);
    const start = Date.parse(rs[0].at);
    const end = Math.max(...rs.map((r) => Date.parse(r.at) + r.ms));
    return { start: rs[0].at, end: new Date(end).toISOString(), wallMs: end - start, byProvider };
  });
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n));
const min = (ms: number) => `${(ms / 60_000).toFixed(1)} 分钟`;

export function usageTable(runs: Run[]): string {
  const rows = ['| 运行 | 开始 | 墙钟 | 模型 | 调用（失败） | 输入 token | 缓存命中 | 输出 token（推理） | 模型耗时合计 | 花费 |', '|---|---|---|---|---|---|---|---|---|---|'];
  runs.forEach((run, i) => {
    for (const [id, t] of Object.entries(run.byProvider)) {
      const hit = t.input ? `${Math.round((t.cacheRead / t.input) * 100)}%` : '—';
      rows.push(
        `| ${i + 1} | ${run.start.slice(0, 16).replace('T', ' ')} | ${min(run.wallMs)} | ${id} | ${t.calls}（${t.errors}） | ${k(t.input)} | ${k(t.cacheRead)}（${hit}） | ${k(t.output)}（${k(t.reasoning)}） | ${min(t.modelMs)} | ${t.cost === null ? '未给价格' : t.cost.toFixed(4)} |`,
      );
    }
  });
  return rows.join('\n');
}
