/**
 * One-off (D-30): judge, FACT-style, whether each cited source SUPPORTS the statement that cites it — for the plain
 * report (普通模式报告 v2) and the team report (报告 v3) of S3 WS-A 买方采购逻辑, same judge, same prompt.
 *
 *   pnpm tsx scripts/fact-citations.ts --limit 10   # trial: 10 units (5 per side), prints time and token use
 *   pnpm tsx scripts/fact-citations.ts               # all units
 *   pnpm tsx scripts/fact-citations.ts --root <vault> --team <报告 vN path> [--plain <普通模式报告 path>] [--name <run>]
 *                                                    # another pair, e.g. WS-A rerun in the question-tree structure (D-39)
 *
 * A question-tree report (D-39: ## Qx → ### / #### 假设 Hn：) is read the same way: every sentence or table row with a
 * marker is a statement, whatever the heading above it; its challenge table's 对判断的影响 column (the older 结论) is the
 * author's own words, like the 回应.
 *
 * Unit = one (statement, source) pair, as in FACT: a sentence (or table row) and one document it cites; the same
 * pair cited twice counts once. Plain: the source is the fetched web page. Team: judged twice — against the block(s)
 * stored in the source note, and against the live page (fetched now). Judge: deepseek-flash, temperature 0.
 * Reads the vault only; writes nothing but .scratch/fact/. Web fetches ≤ 3 at a time. Never prints keys.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateText, type LanguageModel } from 'ai';
import { getWebToolsClient, type WebToolsClient } from '@/lib/deepseek';
import { getModel } from '@/lib/models/provider';
import { resolveReportCitations } from '@/lib/research/citations';
import { gradeSource } from '@/lib/research/grading';
import { extractJson } from '@/lib/research/llm';
import { createVault } from '@/lib/vault';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on the environment
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ROOT = path.resolve(arg('--root') ?? 'demo-vault/.snapshots/S3-C7-ws-a');
const DIR = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑';
const PLAIN = arg('--plain') ?? `${DIR}/普通模式报告 v2.md`;
const TEAM = arg('--team') ?? `${DIR}/报告 v3.md`;
/** Results of another pair go to their own folder (.scratch/fact/<name>); the page cache stays shared. */
const OUT = path.resolve('.scratch/fact', arg('--name') ?? '');
const PAGES = path.resolve('.scratch/fact/pages');
/** "团队 v3", "普通模式 v2": what the summary tables call the two reports. */
const versionOf = (p: string) => /v\d+(?=\.md$)/.exec(p)?.[0] ?? '';
const TEAM_LABEL = `团队 ${versionOf(TEAM)}`;
const PLAIN_LABEL = `普通模式 ${versionOf(PLAIN)}`;
const PAGE_CHARS = 80_000;
const BATCH = 10;
const FETCH_CONCURRENCY = 3;
const JUDGE_CONCURRENCY = 3;

type Verdict = '支持' | '部分支持' | '不支持' | '来源打不开';
const VERDICTS: Verdict[] = ['支持', '部分支持', '不支持', '来源打不开'];

interface Unit {
  side: 'plain' | 'team';
  id: string;
  statement: string;
  /** The statement as the judge sees it: this source's markers → 【本资料】, every other marker → 【其他资料】. */
  marked: string;
  /** Plain: "[n]"; team: the source note path (or the link for a note that does not resolve). */
  sourceKey: string;
  sourceName: string;
  url: string | null;
  grade: string;
  type: string;
  /** Team: the cited block lines of this source for this statement. */
  blocks: string[];
  /** Plain: footnote numbers; team: footnote ids / direct links that brought this pair in. */
  via: string[];
}
interface Judgement {
  verdict: Verdict;
  reason: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The machine fell over under load once: wait while the 1-minute load is above 15. */
async function loadGate() {
  while (os.loadavg()[0] > 15) {
    console.log(`load ${os.loadavg()[0].toFixed(1)} > 15, waiting 30 s`);
    await sleep(30_000);
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await loadGate();
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const clean = (s: string) =>
  s
    .replace(/\[\^\d+\](?!:)/g, '')
    .replace(/(?<!\[)\[\d{1,3}(?:\s*[,，、]\s*\d{1,3})*\](?![(\]])/g, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, t: string, a?: string) => a ?? t)
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s+|^\s*\d+\.\s+|^#+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

const THIS = '【本资料】';
const OTHER = '【其他资料】';
const PLAIN_MARK = /(?<!\[)\[(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)\](?![(\]])/g;
const markPlain = (s: string, num: string) => clean(s.replace(PLAIN_MARK, (_, g: string) => (g.split(/\s*[,，、]\s*/).includes(num) ? THIS : OTHER)));
const markTeam = (s: string, isThis: (marker: string) => boolean) => clean(s.replace(/\[\^\d+\](?!:)|\[\[[^\]]+#\^[^\]]+\]\]/g, (m) => (isThis(m) ? THIS : OTHER)));

const TRAILING_MARKERS = /^(?:\s*(?:\[\^\d+\](?!:)|\[\d{1,3}(?:\s*[,，、]\s*\d{1,3})*\]|\[\[[^\]]+\]\]))*/;

/** Sentences of a line; a sentence end inside “…” / 「…」 does not split, and markers right after the end stay with it. */
function sentencesOf(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    cur += ch;
    if ('“「『'.includes(ch)) depth += 1;
    else if ('”」』'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && '。！？!?'.includes(ch)) {
      const tail = TRAILING_MARKERS.exec(line.slice(i + 1))?.[0] ?? '';
      cur += tail;
      i += tail.length;
      out.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Statements of a body: table rows whole (with the header, so a cell reads in context), other lines split into sentences; each keeps its markers. */
function statements(body: string): string[] {
  const out: string[] = [];
  let header: string | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || /^\[\^\d+\]:/.test(line)) {
      header = null;
      continue;
    }
    if (line.startsWith('|')) {
      if (/^\|[\s:|-]+\|?$/.test(line)) continue;
      if (header === null) {
        header = line;
        continue;
      }
      const h = header.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      out.push(cells.map((c, i) => (h[i] ? `${h[i]}：${c}` : c)).join('；'));
      continue;
    }
    header = null;
    out.push(...sentencesOf(line));
  }
  return out;
}

function dedupe(units: Unit[]): Unit[] {
  const by = new Map<string, Unit>();
  for (const u of units) {
    const k = `${u.statement}\u0000${u.sourceKey}`;
    const had = by.get(k);
    if (had) {
      for (const b of u.blocks) if (!had.blocks.includes(b)) had.blocks.push(b);
      for (const v of u.via) if (!had.via.includes(v)) had.via.push(v);
    } else by.set(k, { ...u, blocks: [...u.blocks], via: [...u.via] });
  }
  return [...by.values()].map((u, i) => ({ ...u, id: `${u.side}-${i + 1}` }));
}

async function plainUnits(vault: ReturnType<typeof createVault>) {
  const n = await vault.read(PLAIN);
  const main = n.body.split(/^##\s*参考来源\s*$/m)[0];
  const run = n.data.baseline_run as { sources: { n: number; url: string; title: string; site: string; authority?: number; fetched?: boolean }[] };
  const src = new Map(run.sources.map((s) => [String(s.n), s]));
  const units: Unit[] = [];
  let markers = 0;
  for (const s of statements(main)) {
    const nums = [...s.matchAll(/(?<!\[)\[(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)\](?![(\]])/g)].flatMap((m) => m[1].split(/\s*[,，、]\s*/));
    markers += nums.length;
    const statement = clean(s);
    for (const num of nums) {
      const so = src.get(num);
      if (!so) continue;
      units.push({
        side: 'plain',
        id: '',
        statement,
        marked: markPlain(s, num),
        sourceKey: `[${num}]`,
        sourceName: so.title,
        url: so.url,
        grade: gradeSource({ url: so.url, authority: so.authority, siteName: so.site }).grade,
        type: so.fetched === false ? '网络（写报告时只看了搜索摘要）' : '网络（写报告时读过全文）',
        blocks: [],
        via: [num],
      });
    }
  }
  return { units: dedupe(units), markers };
}

async function teamUnits(vault: ReturnType<typeof createVault>) {
  const n = await vault.read(TEAM);
  const citations = await resolveReportCitations(vault, n.body, TEAM);
  const defs = new Map<string, string[]>();
  for (const line of n.body.split('\n')) {
    const m = /^\[\^(\d+)\]:\s*(.*)$/.exec(line.trim());
    if (m) defs.set(m[1], [...m[2].matchAll(/\[\[[^\]]+#\^[^\]]+\]\]/g)].map((x) => x[0]));
  }
  const units: Unit[] = [];
  let markers = 0;
  const unit = (s: string, statement: string, link: string, via: string): Unit => {
    const c = citations[link];
    const type = !c ? '未解析' : c.origin === '专家访谈' ? (c.simulated ? '专家访谈（模拟）' : '专家访谈') : c.origin ?? (c.sourcePath?.includes('会议') ? '会议' : '其他笔记');
    return {
      side: 'team',
      id: '',
      statement,
      // every marker that brings in this same source note counts as this source
      marked: markTeam(s, (m) => {
        const links = m.startsWith('[[') ? [m] : (defs.get(m.slice(2, -1)) ?? []);
        return links.some((l) => (citations[l]?.sourcePath ?? l) === (c?.sourcePath ?? link));
      }),
      sourceKey: c?.sourcePath ?? link,
      sourceName: c?.sourceName ?? link,
      url: c?.url ?? null,
      grade: c?.grade ?? (c?.origin === '专家访谈' ? '专家意见' : '未定级'),
      type,
      blocks: c?.blockText ? [c.blockText] : [],
      via: [via],
    };
  };
  for (const s of statements(n.body)) {
    const statement = clean(s);
    for (const m of s.matchAll(/\[\^(\d+)\](?!:)/g)) {
      markers += 1;
      for (const link of defs.get(m[1]) ?? []) units.push(unit(s, statement, link, `[^${m[1]}]`));
    }
    for (const m of s.matchAll(/\[\[[^\]]+#\^[^\]]+\]\]/g)) units.push(unit(s, statement, m[0], m[0]));
  }
  return { units: dedupe(units), markers, citationLinks: Object.keys(citations).length };
}

interface Page {
  ok: boolean;
  title?: string;
  content?: string;
  error?: string;
}
async function fetchPage(web: WebToolsClient, url: string): Promise<Page> {
  const file = path.join(PAGES, `${createHash('sha1').update(url).digest('hex')}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Page;
  } catch {
    // not cached yet
  }
  let page: Page = { ok: false, error: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await web.fetch({ url }, AbortSignal.timeout(90_000));
      page = { ok: true, title: r.title, content: r.content };
      break;
    } catch (e) {
      page = { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
  }
  await writeFile(file, JSON.stringify({ url, ...page }));
  return page;
}

const SYSTEM = `你是引用核查员。给你一份资料的文本，以及若干句引用了这份资料的话。逐句判断：这份资料是否支持这句话里由它支撑的那部分内容。
每句话里，【本资料】标在由这份资料支撑的那部分后面（通常是紧挨在它前面的那个分句或短语）；【其他资料】前面的内容由别的资料支撑，不归你判，不要因为本资料没提它们就降级。
表格行写成"列名：内容；列名：内容"。【本资料】在"出处"一栏时，它支撑的是这一行的第一格（如"挑战"）；回应、结论、对判断的影响是作者自己的话，不归你判。
- 支持：资料里能找到明确依据，数字、主体、时间、方向都对得上。
- 部分支持：资料只支持其中一部分；或这句话比资料说得更强、更泛，换了主体、时间或口径。
- 不支持：资料里找不到依据，或与资料矛盾。
- 来源打不开：给的文本是报错页、登录或验证页、空白，或与资料标题无关，无法判断。
只看给你的资料文本，不要用你自己的知识。一句话里有好几个论点时，只判由这份资料支撑的那一部分；分不清时判整句。
理由用一句中文，说清依据或缺了什么。
只输出 JSON：{"results":[{"i":1,"verdict":"支持","reason":"…"}]}，verdict 只能是 支持 / 部分支持 / 不支持 / 来源打不开。`;

const usage = { calls: 0, input: 0, output: 0, ms: 0 };

async function judge(model: LanguageModel, title: string, text: string, items: string[]): Promise<Judgement[]> {
  const prompt = `资料标题：${title}\n资料文本：\n<<<\n${text}\n>>>\n\n要判断的话：\n${items.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    try {
      const r = await generateText({ model, system: SYSTEM, prompt: attempt ? `${prompt}\n\n上一次的输出不合格：${last}。只输出要求的 JSON。` : prompt, temperature: 0, abortSignal: AbortSignal.timeout(240_000) });
      usage.calls += 1;
      usage.input += r.usage.inputTokens ?? 0;
      usage.output += r.usage.outputTokens ?? 0;
      usage.ms += Date.now() - t0;
      const j = extractJson(r.text) as { results?: { i: number; verdict: string; reason: string }[] };
      const res = j.results ?? [];
      const out = items.map((_, i) => res.find((x) => Number(x.i) === i + 1));
      if (out.every((x) => x && VERDICTS.includes(x.verdict as Verdict))) return out.map((x) => ({ verdict: x!.verdict as Verdict, reason: String(x!.reason ?? '') }));
      last = `应有 ${items.length} 条且 verdict 合法，实际 ${res.length} 条`;
    } catch (e) {
      usage.ms += Date.now() - t0;
      last = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    }
  }
  return items.map(() => ({ verdict: '不支持' as Verdict, reason: `判官没有给出合格结果（${last}）` }));
}

interface Task {
  key: string;
  title: string;
  text: string;
  units: Unit[];
  mode: 'page' | 'block';
}

async function main() {
  await mkdir(PAGES, { recursive: true });
  await mkdir(OUT, { recursive: true });
  console.log(`team: ${TEAM}\nplain: ${PLAIN}\nroot: ${ROOT}`);
  const vault = createVault(ROOT);
  const { model, provider } = await getModel({ vault, providerId: 'deepseek' });
  const web = await getWebToolsClient(vault);
  console.log(`judge=${provider.model} temperature=0 load=${os.loadavg()[0].toFixed(1)}`);

  const plain = await plainUnits(vault);
  const team = await teamUnits(vault);
  console.log(`plain: ${plain.markers} markers → ${plain.units.length} units; team: ${team.markers} footnote markers, ${team.citationLinks} block links → ${team.units.length} units`);

  if (process.argv.includes('--dry')) {
    for (const u of [...plain.units.slice(0, 3), ...team.units.slice(0, 3)]) console.log(JSON.stringify({ s: u.marked.slice(0, 200), src: u.sourceName, grade: u.grade, type: u.type, blocks: u.blocks.length, via: u.via }));
    const tally = (us: Unit[], k: 'grade' | 'type') => Object.entries(Object.groupBy(us, (u) => u[k])).map(([g, x]) => `${g} ${x?.length}`).join(' · ');
    console.log(`plain grades: ${tally(plain.units, 'grade')} | types: ${tally(plain.units, 'type')}`);
    console.log(`team grades: ${tally(team.units, 'grade')} | types: ${tally(team.units, 'type')}`);
    console.log(`distinct urls: plain ${new Set(plain.units.map((u) => u.url)).size}, team ${new Set(team.units.flatMap((u) => (u.url ? [u.url] : []))).size}`);
    return;
  }
  const limit = Number(arg('--limit') ?? 0);
  const pick = (u: Unit[]) => (limit ? u.filter((_, i) => i % Math.ceil(u.length / Math.ceil(limit / 2)) === 0).slice(0, Math.ceil(limit / 2)) : u);
  const pu = pick(plain.units);
  const tu = pick(team.units);

  const t0 = Date.now();
  const urls = [...new Set([...pu, ...tu].flatMap((u) => (u.url ? [u.url] : [])))];
  const pages = new Map<string, Page>();
  await pool(urls, FETCH_CONCURRENCY, async (url) => pages.set(url, await fetchPage(web, url)));
  const fetchMs = Date.now() - t0;
  console.log(`fetched ${urls.length} pages in ${Math.round(fetchMs / 1000)} s (${[...pages.values()].filter((p) => !p.ok).length} failed)`);

  // tasks: one judge call per source and evidence kind, ≤ BATCH statements
  const tasks: Task[] = [];
  const results = new Map<string, Judgement>();
  const truncated = new Set<string>();
  const addPageTasks = (units: Unit[], tag: string) => {
    const bySource = Map.groupBy(units, (u) => u.url ?? '');
    for (const [url, us] of bySource) {
      const page = url ? pages.get(url) : undefined;
      for (const u of us) {
        if (!url) results.set(`${u.id}:${tag}`, { verdict: '来源打不开', reason: '这份资料没有网址（会议、访谈等笔记），没有网页可抓' });
        else if (!page?.ok) results.set(`${u.id}:${tag}`, { verdict: '来源打不开', reason: `抓取失败：${page?.error ?? '未知'}` });
      }
      if (!url || !page?.ok) continue;
      const content = page.content ?? '';
      if (content.length > PAGE_CHARS) truncated.add(url);
      for (let i = 0; i < us.length; i += BATCH) tasks.push({ key: tag, title: page.title || us[0].sourceName, text: content.slice(0, PAGE_CHARS), units: us.slice(i, i + BATCH), mode: 'page' });
    }
  };
  addPageTasks(pu, 'page');
  addPageTasks(tu, 'page');
  for (const [, us] of Map.groupBy(tu, (u) => `${u.sourceKey}\u0000${u.blocks.join('\n')}`)) {
    for (const u of us) if (!u.blocks.length) results.set(`${u.id}:block`, { verdict: '来源打不开', reason: '引用的块没有解析到' });
    const withBlocks = us.filter((u) => u.blocks.length);
    for (let i = 0; i < withBlocks.length; i += BATCH) tasks.push({ key: 'block', title: withBlocks[0].sourceName, text: withBlocks[0].blocks.join('\n'), units: withBlocks.slice(i, i + BATCH), mode: 'block' });
  }
  console.log(`${tasks.length} judge calls to make`);

  const t1 = Date.now();
  let done = 0;
  await pool(tasks, JUDGE_CONCURRENCY, async (t) => {
    const js = await judge(model, t.title, t.text, t.units.map((u) => u.marked));
    t.units.forEach((u, i) => results.set(`${u.id}:${t.key}`, js[i]));
    done += 1;
    if (done % 10 === 0 || done === tasks.length) console.log(`  judged ${done}/${tasks.length} (${Math.round((Date.now() - t1) / 1000)} s)`);
  });
  const judgeMs = Date.now() - t1;

  const rows = [...pu, ...tu].map((u) => ({
    ...u,
    page: results.get(`${u.id}:page`) ?? null,
    block: u.side === 'team' ? (results.get(`${u.id}:block`) ?? null) : null,
    pageTruncated: u.url ? truncated.has(u.url) : false,
  }));
  const file = path.join(OUT, limit ? `trial-${limit}.json` : 'results.json');
  await writeFile(
    file,
    JSON.stringify(
      {
        meta: { judge: provider.model, temperature: 0, pageChars: PAGE_CHARS, batch: BATCH, plainMarkers: plain.markers, plainUnits: plain.units.length, teamMarkers: team.markers, teamBlockLinks: team.citationLinks, teamUnits: team.units.length, pagesFetched: urls.length, pagesFailed: [...pages.values()].filter((p) => !p.ok).length, truncatedPages: truncated.size, fetchMs, judgeMs, usage },
        systemPrompt: SYSTEM,
        rows,
      },
      null,
      1,
    ),
  );
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
  console.log(`time: fetch ${Math.round(fetchMs / 1000)} s, judge ${Math.round(judgeMs / 1000)} s; judge calls ${usage.calls}, tokens in ${usage.input} out ${usage.output}`);
  for (const [side, mode] of [['plain', 'page'], ['team', 'block'], ['team', 'page']] as const) {
    const vs = rows.filter((r) => r.side === side).map((r) => (mode === 'page' ? r.page : r.block)?.verdict);
    console.log(`${side}/${mode}: ${VERDICTS.map((v) => `${v} ${vs.filter((x) => x === v).length}`).join(' · ')}`);
  }
}

type Row = Unit & { page: Judgement | null; block: Judgement | null; pageTruncated: boolean };

/** `--summary`: tables for the note, from .scratch/fact/results.json. */
async function summary() {
  const { meta, rows } = JSON.parse(await readFile(path.join(OUT, 'results.json'), 'utf8')) as { meta: Record<string, unknown>; rows: Row[] };
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
  const line = (label: string, js: (Judgement | null)[]) => {
    const c = (v: Verdict) => js.filter((j) => j?.verdict === v).length;
    const judged = js.length - c('来源打不开');
    return `| ${label} | ${js.length} | ${c('支持')} | ${c('部分支持')} | ${c('不支持')} | ${c('来源打不开')} | ${pct(c('支持'), judged)} | ${pct(c('支持') + c('部分支持'), judged)} |`;
  };
  const head = '| | 处数 | 支持 | 部分支持 | 不支持 | 来源打不开 | 支持率 | 支持+部分支持 |\n|---|---|---|---|---|---|---|---|';
  const views = [
    [`${PLAIN_LABEL} · 对照抓到的网页`, rows.filter((r) => r.side === 'plain'), (r: Row) => r.page],
    [`${TEAM_LABEL} · 对照资料笔记里存的块`, rows.filter((r) => r.side === 'team'), (r: Row) => r.block],
    [`${TEAM_LABEL} · 对照现抓的网页`, rows.filter((r) => r.side === 'team'), (r: Row) => r.page],
  ] as const;
  console.log(`meta: ${JSON.stringify(meta)}\n`);
  console.log(`## 总表\n\n${head}\n${views.map(([l, rs, f]) => line(l, rs.map(f))).join('\n')}\n`);
  for (const [l, rs, f] of views) {
    for (const k of ['grade', 'type'] as const) {
      const groups = Object.entries(Object.groupBy(rs, (r) => r[k])).sort((a, b) => a[0].localeCompare(b[0]));
      console.log(`### ${l} · 按${k === 'grade' ? '等级' : '来源类型'}\n\n${head}\n${groups.map(([g, x]) => line(g, (x ?? []).map(f))).join('\n')}\n`);
    }
  }
  // 10 不支持: 5 per side, from different sources; the team side uses the stored block (what the report relies on)
  const pickBad = (rs: Row[], f: (r: Row) => Judgement | null) => {
    const seen = new Set<string>();
    return rs.filter((r) => f(r)?.verdict === '不支持' && !seen.has(r.sourceKey) && !seen.has(r.statement) && seen.add(r.sourceKey) && seen.add(r.statement)).slice(0, 5);
  };
  const bad = [...pickBad(rows.filter((r) => r.side === 'plain'), (r) => r.page).map((r) => ({ r, j: r.page!, how: '网页' })), ...pickBad(rows.filter((r) => r.side === 'team'), (r) => r.block).map((r) => ({ r, j: r.block!, how: '存的块' }))];
  console.log('## 不支持的例子\n');
  for (const { r, j, how } of bad) console.log(`- ${r.side === 'plain' ? '普通模式' : '团队'}（${r.grade} · ${r.type} · ${r.via.join(' ')} · ${r.sourceName}，对照${how}）：“${r.marked}”\n  - 判官：${j.reason}${r.side === 'team' && r.page ? `\n  - 对照现抓网页：${r.page.verdict}，${r.page.reason}` : ''}`);
  const failed = rows.filter((r) => [r.page, r.block].some((j) => j?.reason.startsWith('判官没有给出合格结果')));
  console.log(`\n判官失败的处数：${failed.length}`);
}

(process.argv.includes('--summary') ? summary() : main()).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
