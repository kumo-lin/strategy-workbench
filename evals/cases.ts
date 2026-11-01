/**
 * The five eval cases (D-15). Each run works on its own copy of the S3 snapshot (WS-A after the C7 run) under
 * .scratch/evals/, never on demo-vault. Cases ②③④④′ judge the same three small Deep Research runs (claim C2,
 * "可管理性三层是采购必要条件"). Since D-17 (PRD v0.7 §11.1) must-1 is shown by the report's own starting point,
 * not by comparing conclusions with the plain mode, so no plain-mode run is needed here.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { loadavg } from 'node:os';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import { buildToolContext, runAgent } from '@/lib/harness';
import { llmJson } from '@/lib/research/llm';
import { executeResearch } from '@/lib/research/execute';
import { resolveReportCitations } from '@/lib/research/citations';
import { createVault, extractWikiLinks, type Vault } from '@/lib/vault';
import { commentLink } from '@/lib/workplan/comments';
import { z } from 'zod';
import {
  citationsAllOk,
  counterOrInsufficient,
  directiveOrigin,
  kbKindOf,
  noUnsourcedNumbers,
  NOW_WHAT_LLM_CRITERION,
  nowWhatRule,
  originSection,
  renderKbUses,
  type Check,
  type KbUse,
} from './judges';

export const SNAPSHOT = 'demo-vault/.snapshots/S3-C7-ws-a';
export const WS = '20_项目/个人AI战略/WS-A 买方';
export const RDIR = `${WS}/调查/买方采购逻辑`;
export const CLAIM = 'C2';
const JUNIOR_A = { id: 'junior-a', name: 'Junior A', kind: 'junior' as const };

export interface CaseRun {
  run: number;
  /** null = could not be judged (the run itself crashed). */
  pass: boolean | null;
  checks: Check[];
  /** Original text, shown for failures (and for LLM-judged passes). */
  excerpt: string;
  ms: number;
  note?: string;
}

export class Scratch {
  constructor(readonly root: string) {}
  async copy(label: string): Promise<{ dir: string; vault: Vault }> {
    const dir = path.join(this.root, label);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    await cp(SNAPSHOT, dir, { recursive: true });
    return { dir, vault: createVault(dir) };
  }
}

const clip = (s: string, n = 700) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ── ① ──────────────────────────────────────────────────────────────────────────

export async function caseNowWhat(scratch: Scratch, run: number, judgeModel: LanguageModel): Promise<CaseRun> {
  const t0 = Date.now();
  const { dir, vault } = await scratch.copy(`c1-run${run}`);
  // Rewind to "G1 passed with comment m1, not handled yet": drop the workplan version that handled it.
  await rm(path.join(dir, WS, 'workplan v2.md'), { force: true });
  const ctx = await buildToolContext({ vault, role: JUNIOR_A, workspacePath: WS, track: 'workspace' });
  const link = commentLink(`${WS}/review/G1 2026-10-24`, 'm1');
  // The exact text the "和 AI 一起解读" button sends (components/workspace/workspace-shell.tsx).
  const message = `请帮我解读这条 comment（G1 2026-10-24 · m1）：\n「我没看懂，所以这个调查结果的SoWhat是什么」\n${link}`;
  const res = await runAgent({ ctx, messages: [{ role: 'user', content: message }] });
  await res.consumeStream();
  const steps = await res.steps;
  const ask = steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === 'ask_user');
  if (!ask) {
    const text = await res.text;
    return { run, pass: false, checks: [{ name: 'AI 用 ask_user 列出几种理解', kind: 'rule', pass: false, detail: '没有调用 ask_user' }], excerpt: clip(text), ms: Date.now() - t0 };
  }
  const input = ask.input as { question: string; options?: { id: string; label: string }[] };
  const options = input.options ?? [];
  const excerpt = `问题：${input.question}\n${options.map((o) => `- ${o.id}：${o.label}`).join('\n')}`;
  const rule = nowWhatRule(options);
  const checks: Check[] = [rule];
  if (!rule.pass) {
    const verdict = await llmJson({
      model: judgeModel,
      task: 'eval-judge:now-what',
      system: '你是评测的判定员。只按给定的判定标准判断，只输出 JSON。',
      prompt: `${NOW_WHAT_LLM_CRITERION}\n\n<<<AI 给出的理解\n${excerpt}\n>>>\n\n输出 JSON：{"pass": true/false, "option_id": "命中的选项 id 或 null", "reason": "一句话"}`,
      schema: z.object({ pass: z.boolean(), option_id: z.string().nullable().default(null), reason: z.string().default('') }),
    });
    checks.push({ name: '（LLM 判定）有一条理解的意思是“缺的是 now what”', kind: 'llm', pass: verdict.pass, detail: `${verdict.option_id ?? '无'}：${verdict.reason}` });
  }
  return { run, pass: checks.some((c) => c.pass), checks, excerpt, ms: Date.now() - t0 };
}

// ── ②③④: one small Deep Research run + one plain-mode run ─────────────────────

/** 1 / 5 / 15-minute load average when a run starts (same numbers as `uptime`): tells a slow program from a busy machine. */
export const loadNow = () => loadavg().map((x) => x.toFixed(1)).join(' / ');

/** macOS memory pressure: free % (`memory_pressure -Q`) and the cumulative swapout count (`vm_stat`). null where unavailable. */
export function memNow(): { freePct: number | null; swapouts: number | null } {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { encoding: 'utf8', timeout: 10_000 });
    } catch {
      return '';
    }
  };
  const free = /free percentage:\s*(\d+)%/.exec(run('memory_pressure -Q'))?.[1];
  const swap = /Swapouts:\s*(\d+)/.exec(run('vm_stat'))?.[1];
  return { freePct: free ? Number(free) : null, swapouts: swap ? Number(swap) : null };
}

/** What the machine was doing during a run: load at start, free memory at start, pages swapped out during the run. */
export interface MachineLoad {
  load: string;
  freePct: number | null;
  /** Pages (16 KB each on Apple silicon) swapped out while the run was going; null where vm_stat is unavailable. */
  swapoutsDuring: number | null;
}

async function measured<T extends object>(fn: () => Promise<T>): Promise<T & { machine: MachineLoad }> {
  const load = loadNow();
  const m0 = memNow();
  const out = await fn();
  const m1 = memNow();
  const swapoutsDuring = m0.swapouts !== null && m1.swapouts !== null ? m1.swapouts - m0.swapouts : null;
  return { ...out, machine: { load, freePct: m0.freePct, swapoutsDuring } };
}

export interface TeamRun {
  run: number;
  ms: number;
  machine?: MachineLoad;
  error?: string;
  reportPath?: string;
  delivered?: boolean;
  /** The report's own `failed_checks` (why the self-check did not pass), when not delivered. */
  failedChecks?: string[];
  /** Where the time went (ExecuteResult.timing): model calls by task, and Search / Fetch / ingest. */
  timing?: { byKind: Record<string, { n: number; ms: number }>; llmByTask: Record<string, { n: number; ms: number }> };
  body?: string;
  vault?: Vault;
  citations?: Awaited<ReturnType<typeof resolveReportCitations>>;
}

export function teamRun(scratch: Scratch, run: number): Promise<TeamRun> {
  return measured(() => teamRunInner(scratch, run));
}

async function teamRunInner(scratch: Scratch, run: number): Promise<TeamRun> {
  const t0 = Date.now();
  const { vault } = await scratch.copy(`team-run${run}`);
  try {
    const ctx = await buildToolContext({ vault, role: JUNIOR_A, workspacePath: WS, track: 'research', researchDir: RDIR });
    const r = await executeResearch({ ctx, mode: 'small', claimIds: [CLAIM] });
    const note = await vault.read(r.reportPath);
    const body = note.body;
    const citations = await resolveReportCitations(vault, body, r.reportPath);
    const failedChecks = Array.isArray(note.data.failed_checks) ? (note.data.failed_checks as string[]) : r.failedChecks;
    return { run, ms: Date.now() - t0, reportPath: r.reportPath, delivered: r.delivered, failedChecks, timing: { byKind: r.timing.byKind, llmByTask: r.timing.llmByTask }, body, vault, citations };
  } catch (e) {
    return { run, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

const crashed = (run: number, ms: number, error: string): CaseRun => ({ run, pass: null, checks: [], excerpt: error, ms, note: '运行出错，没有可判定的产出' });

function claimExcerpt(body: string, label: RegExp): string {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return '';
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length && /^\s+[-*]\s/.test(lines[j]); j++) out.push(lines[j]);
  return out.join('\n');
}

export function judgeCounter(t: TeamRun): CaseRun {
  if (!t.body) return crashed(t.run, t.ms, t.error ?? '?');
  const check = counterOrInsufficient(t.body);
  const verdict = t.body.split('\n').find((l) => /提议的判断/.test(l)) ?? '';
  return { run: t.run, pass: check.pass, checks: [check], excerpt: clip(`${verdict}\n${claimExcerpt(t.body, /^[-*]\s+\**反证/)}`), ms: t.ms, note: t.delivered ? '报告已交付' : '报告自检未通过（草稿）' };
}

export function judgeCitations(t: TeamRun): CaseRun {
  if (!t.body || !t.citations) return crashed(t.run, t.ms, t.error ?? '?');
  const details = Object.values(t.citations);
  const a = citationsAllOk(details);
  const b = noUnsourcedNumbers(t.body, details.map((d) => d.blockText ?? '').filter(Boolean));
  const excerpt = [
    ...details.filter((d) => !d.ok).slice(0, 3).map((d) => `引用没通过：${d.link}（${d.error}）报告里的引文：${d.quote ?? '（无）'}；资料原文：${d.blockText ?? '（无）'}`),
    ...b.unsourced.slice(0, 4).map((u) => `出处不明的数字「${u.token}」：${u.sentence}`),
  ].join('\n');
  return { run: t.run, pass: a.pass && b.pass, checks: [a, { name: b.name, kind: b.kind, pass: b.pass, detail: b.detail }], excerpt: clip(excerpt), ms: t.ms, note: t.delivered ? '报告已交付' : '报告自检未通过（草稿）' };
}

/** ④′ (D-17): the starting point quotes the directive ^m1 and the quote passes check_citations. */
export function judgeDirectiveOrigin(t: TeamRun): CaseRun {
  if (!t.body || !t.citations) return crashed(t.run, t.ms, t.error ?? '?');
  const checks = directiveOrigin(t.body, t.citations);
  const sec = originSection(t.body);
  return { run: t.run, pass: checks.every((c) => c.pass), checks, excerpt: clip(sec.lines.join('\n') || '（报告里没有“这次调查的出发点”）', 900), ms: t.ms };
}

/** ④ (D-17): record only — the knowledge-base notes the report draws on (meetings, decisions, expert input, …). */
export async function recordKbUse(t: TeamRun): Promise<CaseRun> {
  if (!t.body || !t.vault) return crashed(t.run, t.ms, t.error ?? '?');
  const originLines = new Set(originSection(t.body).lines);
  const uses: KbUse[] = [];
  const seen = new Set<string>();
  for (const line of t.body.split('\n')) {
    const where = originLines.has(line) ? '出发点' : '正文';
    for (const l of extractWikiLinks(line)) {
      const r = await t.vault.resolveLink(l.raw, t.reportPath);
      if (!r.ok || seen.has(`${r.path}|${where}`)) continue;
      const n = await t.vault.read(r.path).catch(() => null);
      const kind = n ? kbKindOf(r.path, n.data.type as string | undefined, n.data.origin) : null;
      if (!kind) continue;
      seen.add(`${r.path}|${where}`);
      uses.push({ kind, name: r.path.split('/').pop()!.replace(/\.md$/, ''), where });
    }
  }
  return {
    run: t.run,
    pass: null,
    checks: [],
    excerpt: renderKbUses(uses),
    ms: t.ms,
    note: `会议 ${uses.filter((u) => u.kind === '会议').length}、决定 ${uses.filter((u) => u.kind === '决定').length}、专家输入 ${uses.filter((u) => u.kind === '专家输入').length}、预置资料 ${uses.filter((u) => u.kind === '预置资料').length}`,
  };
}
