/**
 * Workplan chat eval runner (D-56 3e): `pnpm eval:workplan [--questions 1,2] [--runs 3] [--concurrency 3]
 * [--vault <dir>] [--workspace <path>] [--no-judge] [--dry]`.
 *
 * Runs the five scripted questions against the real configured model on copies of a vault, answers the assistant's
 * card questions with the scripted answers, records every round, applies the rule checks (workplan-judges) and
 * optionally has the model score the tone (record only). Results append to evals/results/workplan-<date>.md.
 *
 * `--dry` uses the repo's scripted mock model (MODEL_MOCK=1) so the loop itself can be tested without a key.
 * Keys come from .env.local; they are never printed.
 */
import { appendFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelMessage } from 'ai';
import { z } from 'zod';
import { activeModelInfo, modelText } from '@/lib/config/model-info';
import { buildToolContext, runAgent } from '@/lib/harness';
import { getModel } from '@/lib/models/provider';
import { llmJson } from '@/lib/research/llm';
import { createVault, type Vault } from '@/lib/vault';
import { latestWorkplan, type WorkplanVersion } from '@/lib/workplan/state';
import { hasQuestionTree, workplanTreeProblems } from '@/lib/workplan/workplan-tree';
import type { Check } from './judges';
import {
  pickAnswer,
  renderResultsMarkdown,
  runChecks,
  type AskCard,
  type RoundRecord,
  type RunRecord,
} from './workplan-lib';
import { EVAL_QUESTIONS, type EvalQuestion } from './workplan-questions';
import { modelPairAsk, readStructure, semanticStability, structureJson, type SemanticStability } from './workplan-structure';

export interface EvalOptions {
  /** Question ids to run. */
  questions: number[];
  runs: number;
  concurrency: number;
  /** A directory; copied for every run, never written. */
  vault: string;
  workspace: string;
  judge: boolean;
  dry: boolean;
  outDir: string;
  scratchDir: string;
}

export interface EvalRun {
  record: RunRecord;
  q: EvalQuestion;
  checks: Check[];
}

const JUNIOR_A = { id: 'junior-a', name: 'Junior A', kind: 'junior' as const };
const ROUND_LIMIT = 12;
/** The mock's co-creation script keys on this phrase (lib/testing/mock-agent.ts). */
const DRY_FIRST_MESSAGE = '我们开始共创这个 Workspace 的 workplan 吧。';
const JUDGE_SYSTEM = '你是评测的判定员。只按给定的标准打分，只输出 JSON。';

// ── small helpers ────────────────────────────────────────────────────────────────────────────────

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tool call ids that got a result within the round (a client card gets none, so it is the one to answer). */
function resultIdsOf(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'tool' || typeof m.content === 'string') continue;
    for (const p of m.content) if (p.type === 'tool-result') ids.add(p.toolCallId);
  }
  return ids;
}

function cardOf(input: unknown): AskCard {
  const i = (input ?? {}) as { question?: unknown; options?: unknown; multiSelect?: unknown };
  return {
    question: typeof i.question === 'string' ? i.question : '',
    options: Array.isArray(i.options) ? (i.options as AskCard['options']) : [],
    ...(typeof i.multiSelect === 'boolean' ? { multiSelect: i.multiSelect } : {}),
  };
}

/** Changes when a workplan was written (the source vault may already have one). */
const workplanSignature = (wp: WorkplanVersion | null) => (wp ? `${wp.version}:${wp.body.length}:${wp.body.slice(0, 80)}` : '');

// ── one run ──────────────────────────────────────────────────────────────────────────────────────

async function runOne(q: EvalQuestion, run: number, opts: EvalOptions, stamp: string): Promise<EvalRun> {
  const t0 = Date.now();
  const record: RunRecord = { questionId: q.id, run, ms: 0, rounds: [], workplan: null, judge: null };
  const prevMock = process.env.MODEL_MOCK;
  if (opts.dry) process.env.MODEL_MOCK = '1';
  let vault: Vault | null = null;

  try {
    const dir = path.join(opts.scratchDir, `workplan-${stamp}`, `q${q.id}-run${run}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    await cp(opts.vault, dir, { recursive: true, filter: (src) => path.basename(src) !== '.snapshots' });
    vault = createVault(dir);

    const ctx = await buildToolContext({ vault, role: JUNIOR_A, workspacePath: opts.workspace, track: 'workspace' });
    const messages: ModelMessage[] = [{ role: 'user', content: opts.dry ? DRY_FIRST_MESSAGE : q.text }];
    let lastWp = workplanSignature(await latestWorkplan(vault, opts.workspace));

    for (let n = 1; n <= ROUND_LIMIT; n++) {
      const res = await runAgent({ ctx, messages });
      await res.consumeStream();
      const steps = await res.steps;
      const response = await res.response;
      const answered = resultIdsOf(response.messages);
      const calls = steps.flatMap((s) => s.toolCalls);
      const askCall = [...calls].reverse().find((c) => c.toolName === 'ask_user' && !answered.has(c.toolCallId)) ?? null;
      const ask = askCall ? cardOf(askCall.input) : null;

      const round: RoundRecord = {
        round: n,
        texts: steps.map((s) => s.text.trim()).filter(Boolean),
        // The client card is recorded in `ask`; leaving it out of the trace keeps tool names out of the results.
        tools: calls
          .filter((c) => c.toolName !== 'ask_user')
          .map((c) => {
            const why = (c.input as { why?: unknown }).why;
            return typeof why === 'string' ? { tool: c.toolName, why } : { tool: c.toolName };
          }),
        ask,
        answer: null,
      };
      messages.push(...response.messages);
      record.rounds.push(round);

      if (ask && askCall) {
        const answer = pickAnswer(ask, q.answer, record.rounds.filter((r) => r.ask).length - 1);
        round.answer = answer;
        messages.push({
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: askCall.toolCallId, toolName: 'ask_user', output: { type: 'json', value: answer as never } }],
        });
      }

      const signature = workplanSignature(await latestWorkplan(vault, opts.workspace));
      const wroteWorkplan = signature !== lastWp;
      lastWp = signature;
      if (wroteWorkplan || !ask) break;
    }
  } catch (e) {
    record.error = message(e);
  }

  if (vault) {
    try {
      const wp = await latestWorkplan(vault, opts.workspace);
      record.workplan = wp
        ? { version: wp.version, body: wp.body, problems: hasQuestionTree(wp.body) ? workplanTreeProblems(wp.body) : [], askCount: record.rounds.filter((r) => r.ask).length }
        : null;
    } catch {
      // the copy could not be read back: leave it null
    }
    // The dry run keeps the old mock script, which never writes the compose state: its structure stays undefined.
    if (!opts.dry) record.structure = await readStructure(vault, opts.workspace).catch(() => null);
    if (opts.judge && !opts.dry && !record.error) record.judge = await judgeRun(record, q, vault).catch(() => null);
  }

  record.ms = Date.now() - t0;
  if (opts.dry) {
    if (prevMock === undefined) delete process.env.MODEL_MOCK;
    else process.env.MODEL_MOCK = prevMock;
  }
  return { record, q, checks: runChecks(record, q) };
}

// ── the model's tone score (record only) ─────────────────────────────────────────────────────────

function judgeTranscript(record: RunRecord, q: EvalQuestion): string[] {
  const lines = [`用户：${q.text}`];
  for (const r of record.rounds) {
    for (const t of r.texts) lines.push(`AI：${t}`);
    if (r.ask) {
      lines.push(`AI 提问：${r.ask.question}`);
      for (const o of r.ask.options) lines.push(`选项：${o.label}`);
    }
    if (r.answer) {
      const labels = r.answer.selected.map((id) => r.ask?.options.find((o) => o.id === id)?.label ?? id);
      const text = labels.length ? labels.join('、') : (r.answer.text ?? '');
      if (text) lines.push(`用户答：${text}`);
    }
  }
  return lines;
}

function judgePrompt(record: RunRecord, q: EvalQuestion): string {
  return `下面是一次对话：一个用户向 AI 提出一个问题，AI 帮他拆题。请按三条标准打分。
标准一（顺从度，1–5）：1 = AI 基本照用户说的做，没有任何疑问；5 = AI 指出了用户前提里一个具体的问题、或者和已有资料不一致的地方，并且问清楚。
标准二（AI 味，1–5）：1 = 套话多、像客服、爱夸奖、爱列清单；5 = 像一个同事在说话，直接，没有套话。
标准三（点出疑点）：AI 有没有明确点出一个具体的疑点（true/false）。
这个问题的期望是：${q.expectation}
<<<对话
${judgeTranscript(record, q).join('\n')}
>>>
输出 JSON：{"obsequious": 1-5 的整数, "ai_flavor": 1-5 的整数, "pointed_doubt": true 或 false, "one_line": "一句话说明"}`;
}

async function judgeRun(record: RunRecord, q: EvalQuestion, vault: Vault): Promise<NonNullable<RunRecord['judge']>> {
  const { model } = await getModel({ vault });
  const verdict = await llmJson({
    model,
    task: 'eval-judge:workplan-chat',
    system: JUDGE_SYSTEM,
    prompt: judgePrompt(record, q),
    schema: z.object({
      obsequious: z.number().int().min(1).max(5),
      ai_flavor: z.number().int().min(1).max(5),
      pointed_doubt: z.boolean(),
      one_line: z.string(),
    }),
  });
  return { obsequious: verdict.obsequious, aiFlavor: verdict.ai_flavor, pointedDoubt: verdict.pointed_doubt, oneLine: verdict.one_line };
}

// ── the whole eval ───────────────────────────────────────────────────────────────────────────────

async function modelLabel(vaultDir: string): Promise<string> {
  try {
    return modelText(await activeModelInfo(createVault(vaultDir)));
  } catch {
    return '?';
  }
}

/** `YYYY-MM-DD` in the local time zone (same day boundary as the file name in evals/run.ts). */
function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function runWorkplanEval(opts: EvalOptions): Promise<{ resultsPath: string; jsonDir: string; runs: EvalRun[] }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const questions = EVAL_QUESTIONS.filter((q) => opts.questions.includes(q.id));
  const jobs: (() => Promise<EvalRun>)[] = [];
  for (const q of questions) for (let n = 1; n <= opts.runs; n++) jobs.push(() => runOne(q, n, opts, stamp));

  const runs = (await pool(jobs, opts.concurrency)).sort((a, b) => a.q.id - b.q.id || a.record.run - b.record.run);

  // The judge thinks for minutes per pair of runs: the questions are judged side by side.
  const semantic: Record<number, SemanticStability> = {};
  if (!opts.dry) {
    const { model } = await getModel({ vault: createVault(opts.vault) });
    await Promise.all(
      [...new Set(runs.map((r) => r.q.id))].map(async (id) => {
        const structures = runs.filter((r) => r.q.id === id && r.record.structure?.tree).map((r) => r.record.structure ?? null);
        if (structures.length < 2) return;
        try {
          semantic[id] = await semanticStability(structures, modelPairAsk(model));
        } catch (e) {
          console.error(`稳定性判定失败 题 ${id}：${message(e)}`);
        }
      }),
    );
  }

  const now = new Date();
  const md = renderResultsMarkdown(
    { stamp: now.toLocaleString('zh-CN', { hour12: false }), model: opts.dry ? 'mock' : await modelLabel(opts.vault), vault: opts.vault, workspace: opts.workspace },
    runs,
    semantic,
  );
  await mkdir(opts.outDir, { recursive: true });
  const resultsPath = path.join(opts.outDir, `workplan-${localDay(now)}.md`);
  const exists = await readFile(resultsPath, 'utf8').then(
    () => true,
    () => false,
  );
  if (exists) await appendFile(resultsPath, `\n\n${md}\n`);
  else await writeFile(resultsPath, `${md}\n`);

  const jsonDir = path.join(opts.outDir, `workplan-${localDay(now)}`);
  await mkdir(jsonDir, { recursive: true });
  for (const r of runs) {
    await writeFile(
      path.join(jsonDir, `q${r.q.id}-run${r.record.run}.json`),
      `${JSON.stringify(structureJson(r.record, r.q, r.checks), null, 2)}\n`,
    );
  }

  const recordsPath = path.join(opts.scratchDir, `workplan-${stamp}`, 'records.json');
  await mkdir(path.dirname(recordsPath), { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(runs.map((r) => r.record), null, 2)}\n`);

  return { resultsPath, jsonDir, runs };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): EvalOptions {
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  const questions = arg('questions');
  return {
    questions: questions ? questions.split(',').map(Number) : [1, 2, 3, 4, 5],
    runs: Number(arg('runs') ?? 3),
    concurrency: Number(arg('concurrency') ?? 3),
    vault: arg('vault') ?? 'demo-vault',
    workspace: arg('workspace') ?? '20_项目/个人AI战略/WS-A 买方',
    judge: !argv.includes('--no-judge'),
    dry: argv.includes('--dry'),
    outDir: 'evals/results',
    scratchDir: '.scratch/evals',
  };
}

async function main() {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // rely on the environment
  }
  const opts = parseArgs(process.argv.slice(2));
  const { resultsPath, jsonDir, runs } = await runWorkplanEval(opts);
  for (const r of runs) {
    const verdict = r.record.error ? `出错：${r.record.error}` : r.checks.every((c) => c.pass) ? '通过' : '没通过';
    console.log(`题 ${r.q.id} 第 ${r.record.run} 次：${verdict}（${Math.round(r.record.ms / 1000)} 秒）`);
  }
  console.log(`\n→ ${path.relative(process.cwd(), resultsPath)}`);
  console.log(`→ ${path.relative(process.cwd(), jsonDir)}`);
  if (runs.some((r) => r.record.error)) process.exitCode = 1;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
