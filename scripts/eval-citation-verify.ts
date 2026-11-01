/**
 * D-56 ⑦: the three-gate citation check measured on C's 81 hand-checked pairs (tests/fixtures/d48/citation-pairs.json:
 * verdicts 撑得住 36 / 部分 33 / 挂错 12). Each pair is judged as a real run judges a report's footnotes: grouped by
 * report, the entity gate (no model) and DeepSeek and Kimi at once, verified only when all three pass. It prints, per
 * run, the counts by C's label and whether the acceptance holds (挂错 0, 部分 ≤ 10%, 撑得住 ≥ 60%), the time, and the
 * 挂错 / 部分 pairs that passed.
 *
 *   pnpm tsx scripts/eval-citation-verify.ts [--pairs tests/fixtures/d48/citation-pairs.json] [--vault demo-vault/.snapshots/S3-D48]
 *                                           [--config demo-vault] [--runs 1] [--out <file.json>]
 *
 * Reads the vault only; writes nothing but --out. Never prints keys.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getModel } from '@/lib/models/provider';
import type { Fit } from '@/lib/research/citation-fit';
import { fitJudge, modelRun, secondJudgeModel, verifyCitations, type VerifyPair } from '@/lib/research/citation-verify';
import { clauseOf, formatSummary, summarizeEval, type EvalRow } from '@/lib/research/citation-verify-eval';
import { loadSourceInfo } from '@/lib/research/sources';
import { createVault, type Vault } from '@/lib/vault';
import { parseWikiLink } from '@/lib/vault/links';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on the environment
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const PAIRS = path.resolve(arg('--pairs') ?? 'tests/fixtures/d48/citation-pairs.json');
const VAULT = path.resolve(arg('--vault') ?? 'demo-vault/.snapshots/S3-D48');
const CONFIG = path.resolve(arg('--config') ?? 'demo-vault');
const RUNS = Number(arg('--runs') ?? 1) || 1;
const OUT = arg('--out');

/** One of C's hand-checked pairs (the fixture's shape). */
interface PairItem {
  report: string;
  footnote: string;
  sentence: string;
  quote: string;
  ref: string;
  verdict: Fit;
  why: string;
}

interface Built {
  item: PairItem;
  clause: string;
  pair: VerifyPair;
}

interface ItemResult {
  report: string;
  footnote: string;
  label: Fit;
  clause: string;
  verified: boolean;
  entity: boolean;
  deepseek: Fit | null;
  kimi: Fit | null;
}

/** A pair C called 挂错 or 部分 that the three gates verified, with both judges' reasons. */
interface Flagged {
  report: string;
  footnote: string;
  clause: string;
  deepseek: string;
  kimi: string;
}

const fileName = (p: string): string => p.split('/').pop() ?? p;

/**
 * The clause and the source of every pair. The source is what the entity gate reads: the original, and the source
 * note's name and publisher when its block link resolves in the vault; the link target when it does not.
 */
async function build(vault: Vault, items: PairItem[]): Promise<Built[]> {
  const out: Built[] = [];
  for (const [i, item] of items.entries()) {
    const clause = clauseOf(item.sentence, item.footnote);
    const link = parseWikiLink(item.ref);
    const res = link ? await vault.resolveLink(link, item.report).catch(() => null) : null;
    const info = res?.ok ? await loadSourceInfo(vault, res.path).catch(() => null) : null;
    const source = info ? [item.quote, info.name, info.publisher].join('\n') : [item.quote, link?.target ?? item.ref].join('\n');
    out.push({ item, clause, pair: { id: `e${i}`, footnote: item.footnote, ref: item.ref, sentence: clause, quote: item.quote, source } });
  }
  return out;
}

/** The pairs by report, in the order the reports first appear (a real run judges one report's footnotes together). */
function groupsOf(built: Built[]): [string, Built[]][] {
  const groups = new Map<string, Built[]>();
  for (const b of built) {
    const list = groups.get(b.item.report);
    if (list) list.push(b);
    else groups.set(b.item.report, [b]);
  }
  return [...groups];
}

async function main() {
  const items: PairItem[] = JSON.parse(await readFile(PAIRS, 'utf8'));
  const vault = createVault(VAULT);
  const config = createVault(CONFIG);
  const [deepseek, kimi] = await Promise.all([
    getModel({ vault: config, providerId: 'deepseek' }),
    secondJudgeModel(config, 'deepseek'),
  ]);
  const base = { log: async (a: string, c: string) => console.error(`${a} ${c}`), signal: undefined };
  const judges = {
    deepseek: fitJudge(modelRun(deepseek.model, base), 'citation-verify:deepseek'),
    kimi: fitJudge(modelRun(kimi.model, base), 'citation-verify:kimi'),
  };
  const groups = groupsOf(await build(vault, items));
  const outputs: { seconds: number; byReport: [string, number][]; summary: ReturnType<typeof summarizeEval>; items: ItemResult[] }[] = [];

  for (let run = 0; run < RUNS; run++) {
    const rows: EvalRow[] = [];
    const results: ItemResult[] = [];
    const byReport: [string, number][] = [];
    const wrongVerified: Flagged[] = [];
    const partialVerified: Flagged[] = [];
    for (const [report, group] of groups) {
      const r = await verifyCitations(group.map((g) => g.pair), judges);
      byReport.push([report, r.seconds]);
      r.items.forEach((v, n) => {
        const b = group[n];
        rows.push({ label: b.item.verdict, verified: v.verified, entity: v.entity.pass, deepseek: v.deepseek.fit, kimi: v.kimi.fit });
        results.push({ report, footnote: b.item.footnote, label: b.item.verdict, clause: b.clause, verified: v.verified, entity: v.entity.pass, deepseek: v.deepseek.fit, kimi: v.kimi.fit });
        const flagged = { report, footnote: b.item.footnote, clause: b.clause, deepseek: v.deepseek.reason, kimi: v.kimi.reason };
        if (v.verified && b.item.verdict === '挂错') wrongVerified.push(flagged);
        if (v.verified && b.item.verdict === '部分') partialVerified.push(flagged);
      });
    }
    const summary = summarizeEval(rows);
    const seconds = Math.round(byReport.reduce((s, [, sec]) => s + sec, 0) * 10) / 10;
    if (RUNS > 1) console.log(`第 ${run + 1} 次：`);
    console.log(formatSummary(summary, { total: seconds, byReport }));
    for (const [title, list] of [
      ['挂错 判 ✓', wrongVerified],
      ['部分 判 ✓', partialVerified],
    ] as [string, Flagged[]][]) {
      console.log(`${title} ${list.length} 对${list.length ? '：' : '：无'}`);
      for (const f of list) console.log(`- ${fileName(f.report)} ${f.footnote}「${f.clause}」DeepSeek：${f.deepseek || '—'}；Kimi：${f.kimi || '—'}`);
    }
    outputs.push({ seconds, byReport, summary, items: results });
  }

  if (OUT) await writeFile(path.resolve(OUT), `${JSON.stringify({ runs: outputs }, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
