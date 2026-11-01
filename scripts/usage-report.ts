/**
 * Summarise a USAGE_LOG file into runs (tokens, cache hits, time, cost).
 *
 *   USAGE_LOG=.scratch/usage.jsonl pnpm dev            # run the app; every model call is logged
 *   pnpm exec tsx scripts/usage-report.ts .scratch/usage.jsonl [--prices prices.json] [--gap 10]
 *
 * prices.json, per million tokens, by provider id of 90_配置/模型.md (use the providers' current price lists):
 *   { "deepseek": { "inputCacheHit": 0, "inputCacheMiss": 0, "output": 0 } }
 */
import { readFileSync } from 'node:fs';
import { groupRuns, parseUsageLog, usageTable, type Prices } from '../lib/models/usage-report';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
// the file is the first argument that is neither a flag nor a flag's value
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) {
  console.error('usage: tsx scripts/usage-report.ts <usage.jsonl> [--prices prices.json] [--gap minutes]');
  process.exit(2);
}
const prices: Prices = flag('prices') ? JSON.parse(readFileSync(flag('prices')!, 'utf8')) : {};
const gap = Number(flag('gap') ?? 10);
const runs = groupRuns(parseUsageLog(readFileSync(file, 'utf8')), prices, gap);
console.log(usageTable(runs));
