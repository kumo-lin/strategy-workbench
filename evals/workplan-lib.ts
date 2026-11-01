/**
 * Pure helpers for the workplan chat eval (D-56 3d): the scripted answer to a card question, the transcript a
 * reader sees, a run's checks and the results markdown. No model, no filesystem — the runner that uses them is a
 * separate spec (m1_3e), and these are unit-tested (tests/evals/workplan-lib.test.ts).
 */
import { lengthOf } from '@/lib/research/length-check';
import type { Check } from './judges';
import { allChatChecks, balancedTitles, doubtMarker, endsWhole, noCodes, looksUpBeforeAsking, referencesTitle, summarizeRun } from './workplan-judges';
import type { EvalQuestion } from './workplan-questions';
import { stabilityLine, stabilityOf, structureChecks, structureMarkdown, type SemanticStability, type StructureSnapshot } from './workplan-structure';

export interface CardOption {
  id: string;
  label: string;
}

export interface AskCard {
  question: string;
  options: CardOption[];
  multiSelect?: boolean;
}

export interface RoundRecord {
  /** 1-based. */
  round: number;
  /** The assistant's visible text of each step of this round, empty ones removed, trimmed. */
  texts: string[];
  /** Tool calls of this round in order. */
  tools: { tool: string; why?: string }[];
  /** The unanswered ask_user card at the end of the round, if any. */
  ask: AskCard | null;
  /** What the eval answered to it. */
  answer: { selected: string[]; text?: string } | null;
}

export interface WorkplanSnapshot {
  version: number;
  body: string;
  /** Structure problems of the workplan body ([] = fine). */
  problems: string[];
  askCount: number;
}

export interface RunRecord {
  questionId: number;
  run: number;
  ms: number;
  rounds: RoundRecord[];
  /** null = the assistant never wrote a workplan. */
  workplan: WorkplanSnapshot | null;
  /** The run crashed: message. */
  error?: string;
  /** What the new co-creation pipeline wrote; undefined for old records and the dry run. */
  structure?: StructureSnapshot | null;
  /** LLM scores, record only; null = not judged. */
  judge?: { obsequious: number; aiFlavor: number; pointedDoubt: boolean; oneLine: string } | null;
}

const rule = (name: string, pass: boolean, detail: string): Check => ({ name, kind: 'rule', pass, detail });

// ── what to answer when the assistant asks ───────────────────────────────────────────────────────

export function pickAnswer(card: AskCard, answer: EvalQuestion['answer'], cardIndex = 0): { selected: string[]; text?: string } {
  if (answer.pickLabel) {
    const opt = card.options.find((o) => answer.pickLabel!.test(o.label));
    if (opt) return { selected: [opt.id] };
  }
  const confirm = card.options.find((o) => o.label.includes('就按这个拆'));
  if (confirm) return { selected: [confirm.id] };
  if (answer.text && cardIndex === 0) return { selected: [], text: answer.text };
  if (card.options.length) return { selected: [card.options[0].id] };
  return { selected: [], text: '按你的推荐来。' };
}

// ── every piece of chat the user would see, in order ─────────────────────────────────────────────

export type ChatPieceKind = 'text' | 'question' | 'option';

export const PIECE_LIMITS: Record<ChatPieceKind, number> = { text: 80, question: 120, option: 60 };

const PIECE_LABELS: Record<ChatPieceKind, string> = { text: '正文', question: '卡片问题', option: '选项' };

export function visibleChatPieces(record: RunRecord): { kind: ChatPieceKind; text: string }[] {
  const out: { kind: ChatPieceKind; text: string }[] = [];
  for (const r of record.rounds) {
    out.push(...r.texts.map((text) => ({ kind: 'text' as const, text })));
    if (r.ask) {
      out.push({ kind: 'question', text: r.ask.question });
      for (const o of r.ask.options) out.push({ kind: 'option', text: o.label });
    }
  }
  return out;
}

export function visibleChat(record: RunRecord): string[] {
  return visibleChatPieces(record).map((p) => p.text);
}

// ── a run's checks ───────────────────────────────────────────────────────────────────────────────

/** Length is scored on the whole run: a run may overshoot on up to 10% of its pieces (at least one), but none may be far over. */
function pieceLengthCheck(pieces: { kind: ChatPieceKind; text: string }[]): Check {
  const measured = pieces.map((p, i) => ({ i, len: lengthOf(p.text), limit: PIECE_LIMITS[p.kind] }));
  const over = measured.filter((m) => m.len > m.limit);
  const allowed = Math.max(1, Math.floor(0.1 * pieces.length));
  const wayOver = over.some((m) => m.len > 1.5 * m.limit);

  let longest: { i: number; len: number; limit: number } | null = null;
  for (const m of over) if (!longest || m.len > longest.len) longest = m;

  let detail = `${over.length}/${pieces.length} 句超限`;
  if (longest) detail += `；最长 ${longest.len} 字（第 ${longest.i + 1} 句，${PIECE_LABELS[pieces[longest.i].kind]}）`;
  if (wayOver) detail += '；有一句超过限制的 1.5 倍';

  return rule('对话字数：超限的不超过 10%', over.length <= allowed && !wayOver, detail);
}

export function runChecks(record: RunRecord, q: EvalQuestion): Check[] {
  if (record.error) return [rule('运行没有出错', false, record.error)];

  const visible = visibleChat(record);
  const pieces = visibleChatPieces(record);
  const perPiece = pieces.map((p) => allChatChecks(p.text));
  const chatChecks = allChatChecks('').map((c, i) => {
    const bad = perPiece.findIndex((cs) => !cs[i].pass);
    return bad < 0 ? rule(c.name, true, '全部通过') : rule(c.name, false, `${perPiece[bad][i].detail} （第 ${bad + 1} 句，${PIECE_LABELS[pieces[bad].kind]}）`);
  });

  // whole sentences: judged per piece like the style checks, plain text must also end like a sentence
  const wholeness = [balancedTitles, noCodes].map((check) => {
    const probe = check('');
    const bad = pieces.findIndex((p) => !check(p.text).pass);
    return bad < 0 ? rule(probe.name, true, '全部通过') : rule(probe.name, false, `${check(pieces[bad].text).detail} （第 ${bad + 1} 句，${PIECE_LABELS[pieces[bad].kind]}）`);
  });
  const badEnd = pieces.findIndex((p) => p.kind === 'text' && !endsWhole(p.text).pass);
  wholeness.push(badEnd < 0 ? rule(endsWhole('').name, true, '全部通过') : rule(endsWhole('').name, false, `…${endsWhole(pieces[badEnd].text).detail} （第 ${badEnd + 1} 句，正文）`));

  const first = record.rounds[0];
  const asks = record.rounds.filter((r) => r.ask).length;
  const checks: Check[] = [
    ...chatChecks.slice(0, 3),
    pieceLengthCheck(pieces),
    ...chatChecks.slice(3),
    ...wholeness,
    looksUpBeforeAsking(first?.tools ?? []),
    rule(`问题数不超过 ${q.maxAsks}`, asks <= q.maxAsks, `${asks} 个`),
  ];

  if (q.extra.includes('askedBeforeDraft')) {
    const drafted = first?.tools.some((t) => t.tool === 'write_draft' || t.tool === 'compose_workplan') ?? false;
    const pass = Boolean(first?.ask) && !drafted;
    const detail = !first ? '没有第一轮' : !first.ask ? '第一轮没有追问' : drafted ? '第一轮在追问之前就起草了' : '第一轮先追问，没有起草';
    checks.push(rule('追问在起草之前', pass, detail));
  }
  if (q.extra.includes('referencesDirective')) checks.push(referencesTitle(visible.join('\n'), ['高层周会', '业务方针', 'W1决定']));
  if (q.extra.includes('doubtMarker')) checks.push(doubtMarker(visible.join('\n')));

  if (![2, 4].includes(q.id)) {
    const wp = record.workplan;
    const pass = wp !== null && wp.problems.length === 0;
    const detail = pass ? '没问题' : !wp ? '没有写出 workplan' : wp.problems[0];
    checks.push(rule('workplan 过结构检查', pass, detail));
  }

  if (record.structure !== undefined) checks.push(...structureChecks(record.structure, q));

  return checks;
}

// ── one run as a readable markdown block ─────────────────────────────────────────────────────────

function answerLine(r: RoundRecord): string | null {
  if (!r.answer) return null;
  const labels = r.answer.selected.map((id) => r.ask?.options.find((o) => o.id === id)?.label ?? id);
  if (labels.length) return `用户答：${labels.join('、')}`;
  return r.answer.text ? `用户答：${r.answer.text}` : null;
}

export function renderRunMarkdown(record: RunRecord, q: EvalQuestion, checks: Check[]): string {
  const sum = summarizeRun(checks);
  const asks = record.rounds.filter((r) => r.ask).length;

  const chat = [`用户：${q.text}`];
  for (const r of record.rounds) {
    for (const t of r.texts) chat.push(`AI：${t}`);
    if (r.tools.some((t) => t.tool.startsWith('vault_'))) chat.push('（AI 先查了资料）');
    if (r.ask) {
      chat.push(`AI 提问：${r.ask.question}`);
      for (const o of r.ask.options) chat.push(`  - ${o.label}`);
    }
    const ans = answerLine(r);
    if (ans) chat.push(ans);
  }

  const segments: string[][] = [
    [
      `### 题 ${q.id} · ${q.title} · 第 ${record.run} 次`,
      `期望：${q.expectation}`,
      sum.pass ? '结果：通过' : `结果：没通过（${sum.failed.join('、')}）`,
      `用时 ${(record.ms / 1000).toFixed(1)} 秒 · ${record.rounds.length} 轮 · ${asks} 个问题`,
    ],
    ['对话：', ...chat],
  ];
  if (record.structure !== undefined) segments.push(['结构：', structureMarkdown(record.structure)]);
  if (record.workplan) segments.push(['workplan 前 25 行：', '```', ...record.workplan.body.split('\n').slice(0, 25), '```']);
  segments.push(checks.map((c) => (c.pass ? `- ✓ ${c.name}` : `- ✗ ${c.name}：${c.detail}`)));
  if (record.judge) {
    const j = record.judge;
    segments.push([`AI 评分（只记录，不判通过）：顺从度 ${j.obsequious}/5（5 = 敢质疑）· AI 味 ${j.aiFlavor}/5（5 = 自然）· 点出疑点：${j.pointedDoubt ? '是' : '否'} · ${j.oneLine}`]);
  }
  segments.push(['外部评审：', 'C 判：']);

  return segments.filter((s) => s.length).map((s) => s.join('\n')).join('\n\n');
}

// ── the whole results file ──────────────────────────────────────────────────────────────────────

export function renderResultsMarkdown(
  meta: { stamp: string; model: string; vault: string; workspace: string },
  runs: { record: RunRecord; q: EvalQuestion; checks: Check[] }[],
  semantic?: Record<number, SemanticStability>,
): string {
  const ids = [...new Set(runs.map((r) => r.q.id))].sort((a, b) => a - b);
  const table = ['| 题 | 通过/总次数 | 常见没通过的检查 |', '|---|---|---|'];
  for (const id of ids) {
    const qs = runs.filter((r) => r.q.id === id);
    const passed = qs.filter((r) => summarizeRun(r.checks).pass).length;
    const counts = new Map<string, number>();
    for (const r of qs) for (const name of summarizeRun(r.checks).failed) counts.set(name, (counts.get(name) ?? 0) + 1);
    const common = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => `${name} ×${n}`)
      .join('、');
    table.push(`| ${id} ${qs[0].q.title} | ${passed}/${qs.length} | ${common || '—'} |`);
  }

  const stability: string[] = [];
  for (const id of ids) {
    const withStructure = runs.filter((r) => r.q.id === id && r.record.structure);
    if (withStructure.length < 2) continue;
    const structures = withStructure.map((r) => r.record.structure ?? null);
    const behaviours = withStructure.map((r) => ({
      askedFirst: r.record.rounds[0]?.ask != null,
      doubt: doubtMarker(visibleChat(r.record).join('\n')).pass,
    }));
    const byMeaning = semantic?.[id];
    const extra = byMeaning
      ? `；按意思配对：一级 ${Math.round(byMeaning.first * 100)}%（线 70%），最底层 ${Math.round(byMeaning.leaf * 100)}%（线 70%）`
      : '';
    stability.push(`稳定性 · 题 ${id}：${stabilityLine(stabilityOf(structures, behaviours))}${extra}`);
  }

  const ordered = [...runs].sort((a, b) => a.q.id - b.q.id || a.record.run - b.record.run);
  const segments = [
    [`## 工作计划对话评测 · ${meta.stamp}`, `模型：${meta.model} · 数据：${meta.vault} · Workspace：${meta.workspace}`],
    table,
    stability,
    ...ordered.map((r) => [renderRunMarkdown(r.record, r.q, r.checks)]),
  ].filter((s) => s.length);
  return segments.map((s) => s.join('\n')).join('\n\n');
}
