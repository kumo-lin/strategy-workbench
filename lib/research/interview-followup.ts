/**
 * D-64 T25: interviews come in after a report; the AI finds the judgments each one touches, only those are judged
 * again, and v2 says what changed. The rules are code (D63 §3.3): an interview lifts 证据不足 to 访谈支持 and never
 * further; 成立, 不成立 and 需要修改 stay as they are. No web search: the public evidence is v1's.
 *
 * Why not executeFollowUp: that one adds a sub-question to ONE hypothesis and searches for it; here several judgments
 * change at once from evidence a person brought, with no search.
 *
 * v2 is v1's text with the So what written again, a "## 因为追加了访谈，结论变了什么" section before the appendix,
 * and v1's judgment file with the new verdicts. A v1 in the older format (no So what section) cannot be followed up.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { Role } from '@/lib/config/roles';
import { executeTool } from '@/lib/harness';
import { isPlanApproved, resolvePhase } from '@/lib/harness/phases';
import { summaryPrompt, WRITING_SYSTEM } from '@/lib/harness/prompts/research-execute';
import type { ToolContext } from '@/lib/harness/types';
import { ApprovalDenied } from '@/lib/harness/events';
import type { Verdict } from '@/lib/notes/schema';
import { taskLine } from '@/lib/testing/mock-contract';
import type { Vault } from '@/lib/vault';
import { keyQuestionLabel, keyQuestionVerdict } from './evidence';
import { absoluteInVault, loadEvidenceRecord, writeEvidenceSidecar, type EvidenceRecordEntry } from './evidence-record';
import { latestVersion } from './folders';
import { loadReportPlan } from './report-plan';
import { readJudgmentFile, saveJudgmentFile, storedKeys, type JudgmentFile } from './judgment-file';
import { llmJson } from './llm';
import { cell } from './report';
import { resolveRunModels } from './run-models';
import { summarySchema, type ReportReason } from './schemas';
import { writeProposedVerdicts } from './verdict-writer';
import { FollowUpDenied } from './followup';

export const INTERVIEW_HITS_FILE = '访谈命中.json';
export const INTERVIEW_EXTENSIONS = ['.md', '.txt'] as const;
export const CHANGE_HEADING = '## 因为追加了访谈，结论变了什么';
const UNTOUCHED = '不变（访谈没有涉及）';

export interface InterviewHit {
  interview: string;
  claims: string[];
  reason: string;
  /** 复核 B3: per judgment, what the interview said about it (one sentence); falls back to `reason`. */
  says?: Record<string, string>;
}

const today = (d: Date) => d.toISOString().slice(0, 10);
const link = (p: string) => `[[${p.replace(/\.md$/, '')}|${path.posix.basename(p, '.md')}]]`;

/** Saves an uploaded interview as `20_项目/<项目>/访谈/<名字>.md` (a meeting of kind 访谈). Only the Workspace owner. */
export async function saveInterview(vault: Vault, actor: Role, workspacePath: string, input: { name: string; content: string; simulated: boolean }, now = new Date()): Promise<{ path: string }> {
  const ws = await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace');
  if (actor.name !== ws.note.owner) throw new ApprovalDenied(`只有 Workspace 的负责人（${ws.note.owner}）可以放入访谈记录`);
  const name = input.name.replace(/\.(md|txt)$/i, '').replace(/[\\/]/g, '-').trim();
  const projectPath = path.posix.dirname(workspacePath);
  const target = `${projectPath}/访谈/${name}.md`;
  const text = input.content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const body = /^# /.test(text) ? `${text}\n` : `# ${name}\n\n${text}\n`;
  await vault.write(
    target,
    {
      frontmatter: {
        id: `iv-${now.getTime().toString(36)}`,
        type: 'meeting',
        status: '已确认',
        created: today(now),
        updated: today(now),
        author: actor.name,
        derived_from: [link(`${projectPath}/项目.md`)],
        relates_to: [link(`${workspacePath}/workspace.md`)],
        date: today(now),
        attendees: [actor.name],
        simulated: input.simulated,
        kind: '访谈',
        decisions: [],
      },
      body,
    },
    { overwrite: true },
  );
  return { path: target };
}

/** A hit as the model gave it, kept only when its ids are judgments of the plan and it says why. */
export function validHits(raw: { claims: string[]; reason: string; by_claim?: Record<string, string> }, claimIds: string[]): Omit<InterviewHit, 'interview'> | null {
  const claims = [...new Set(raw.claims.map((c) => c.trim()))].filter((c) => claimIds.includes(c));
  if (!claims.length || !raw.reason.trim()) return null;
  const says = Object.fromEntries(claims.flatMap((c) => (raw.by_claim?.[c]?.trim() ? [[c, raw.by_claim[c].trim()]] : [])));
  return { claims, reason: raw.reason.trim(), ...(Object.keys(says).length ? { says } : {}) };
}

const affectsSchema = z.object({ claims: z.array(z.string()).catch([]), reason: z.string().catch(''), by_claim: z.record(z.string(), z.string()).catch({}).default({}) });

/**
 * 复核 B3 (v6 2.10): v2's reasons are v1's, each with what the interviews said about the judgments it rests on
 * (a key must belong to exactly one stored judgment, corroborated by that claim's evidence record). Code adds them, tagged
 * 访谈支持: never 事实.
 */
export function reasonsWithInterviews(file: JudgmentFile, record: EvidenceRecordEntry[], hits: InterviewHit[], simulated: Set<string>): { reasons: ReportReason[]; added: string[][] } {
  const reasons = file.summary?.reasons ?? [];
  const bare = (link: string) => link.replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
  const consumers = new Map<string, Set<string>>();
  for (const c of file.claims) for (const key of storedKeys({ conditions: c.conditions, judgment: c.judgment })) {
    const ids = consumers.get(key) ?? new Set<string>();
    ids.add(c.claimId);
    consumers.set(key, ids);
  }
  const ownerOfKey = new Map<string, string>();
  for (const [key, ids] of consumers) {
    if (ids.size !== 1 || !file.keyed[key]) continue;
    const [id] = ids;
    if (record.some((e) => e.claim === id && bare(e.ref) === bare(file.keyed[key]))) ownerOfKey.set(key, id);
  }
  const identity = (source: string, text: string) => JSON.stringify([source, text]);
  const added: string[][] = [];
  const out = reasons.map((r) => {
    const refs = r.basis.flatMap((b) => b.refs);
    const lines: ReportReason['basis'] = [];
    const seen = new Set(r.basis.filter((b) => b.kind === '访谈支持').map((b) => identity(b.source, b.text)));
    for (const h of hits)
      for (const id of h.claims) {
        if (!refs.some((k) => ownerOfKey.get(k) === id)) continue;
        const text = h.says?.[id] ?? h.reason;
        const source = `${h.interview}${simulated.has(h.interview) ? '，模拟访谈' : ''}`;
        const key = identity(source, text);
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({ text, kind: '访谈支持', refs: [], source });
      }
    added.push(lines.map((l) => `   - 访谈支持：${l.text}（${l.source}）`));
    return { ...r, basis: [...r.basis, ...lines] };
  });
  return { reasons: out, added };
}

/** D63 §3.3: an interview supports a judgment; it can lift 证据不足 to 访谈支持, nothing else. */
export function afterInterview(v: Verdict): Verdict {
  return v === '证据不足' ? '访谈支持' : v;
}
const whyKept: Partial<Record<Verdict, string>> = {
  成立: '公开资料已经撑得住',
  不成立: '有没被驳倒的强反证，访谈改不了',
  需要修改: '访谈最多提到“访谈支持”，不高于现在的“部分支持”',
  访谈支持: '已经是访谈支持',
};

export interface InterviewFollowUpResult {
  reportPath: string;
  hits: InterviewHit[];
  /** The claims judged again (touched by an interview). */
  rejudged: string[];
  verdicts: Record<string, Verdict>;
}

const stripKeys = (s: string) => s.replace(/\s*\[(?:E\d+(?:[,，、]\s*E?\d+)*|Q\d+(?:-\d+)?)\]/g, '').trim(); // evidence keys and sub-question tags (复核 A)

export async function executeInterviewFollowUp(opts: { ctx: ToolContext; interviews: string[]; model?: LanguageModel }): Promise<InterviewFollowUpResult> {
  const { ctx } = opts;
  if (!ctx.research) throw new FollowUpDenied('没有调查上下文，不能追加分析');
  const dir = ctx.research.dir;
  const baseV = await latestVersion(ctx.vault, dir, '报告');
  if (!baseV) throw new FollowUpDenied('还没有报告，先完成一次调查');
  const base = await ctx.vault.read(baseV.path);
  if (base.data.delivery !== '已交付') throw new FollowUpDenied(`报告 v${baseV.n} 没有交付，不能在它上面追加分析`);
  const file = await readJudgmentFile(ctx.vault, baseV.path);
  if (!file?.summary || !/^## So what\s*$/m.test(base.body)) throw new FollowUpDenied(`报告 v${baseV.n} 是旧格式，不能追加访谈分析；先重新调查`);
  const { plan, path: planPath } = await loadReportPlan(ctx.vault, base, file.claims).catch((e: unknown) => {
    throw new FollowUpDenied(e instanceof Error ? e.message : '报告绑定的计划不可用');
  });
  if (!isPlanApproved(plan)) throw new FollowUpDenied('报告绑定的计划还没批准，不能追加分析');
  const reportCtx: ToolContext = { ...ctx, phase: resolvePhase({ track: 'research', plan }), research: { ...ctx.research, plan, planPath } };
  const { model } = await resolveRunModels(ctx.vault, { model: opts.model });
  const log = (action: string, change: string, reason: string) => ctx.vault.appendLog(ctx.logPath, { time: ctx.now().toISOString(), actor: 'AI', action, change, reason }).catch(() => {});

  // ── which judgments each interview touches ──────────────────────────────
  const ids = file.claims.map((c) => c.claimId);
  const keyOf = new Map(plan.claims.map((c) => [c.id, c.key]));
  const statementOf = new Map(plan.claims.map((c) => [c.id, c.statement]));
  const listed = file.claims.map((c) => `- ${c.claimId}（${c.label}${keyOf.get(c.claimId) ? `，${keyOf.get(c.claimId)}` : ''}）${statementOf.get(c.claimId) ?? ''} → ${c.verdict}`);
  const hits: InterviewHit[] = [];
  const notes: { path: string; title: string; simulated: boolean }[] = [];
  for (const p of opts.interviews) {
    const n = await ctx.vault.read(p);
    const title = n.title;
    notes.push({ path: p, title, simulated: n.data.simulated === true });
    const raw = await llmJson({
      model,
      task: 'interview_affects',
      system: `${WRITING_SYSTEM}\n${taskLine('interview_affects')}`,
      prompt: [
        '下面是报告里的判断，和一份新放进来的访谈记录。找出这份访谈提供了支持的判断（只看访谈说了什么，不用你自己知道的事补）。',
        '',
        '判断：',
        ...listed,
        '',
        `## 访谈：${title}`,
        '',
        n.body.slice(0, 6000),
        '',
        '输出 JSON：{"claims":["C2"],"reason":"一句中文：访谈说了什么、为什么涉及这些判断","by_claim":{"C2":"一句中文：访谈里和这个判断有关的话说了什么"}}；claims 只能用上面列出的编号，没涉及任何判断就写空列表；by_claim 只写 claims 里的编号。',
      ].join('\n'),
      schema: affectsSchema,
    });
    const ok = validHits(raw, ids);
    if (!ok) {
      await log('research:interview-unmatched', `${title}：没有找到它涉及的判断（模型给的是 ${raw.claims.join('、') || '空'}）`, '编号必须是报告里的判断，并写明理由');
      continue;
    }
    hits.push({ interview: title, ...ok });
  }
  const hitsPath = path.posix.join(dir, INTERVIEW_HITS_FILE);
  const full = absoluteInVault(ctx.vault, hitsPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(`${full}.tmp`, `${JSON.stringify(hits, null, 2)}\n`, 'utf8');
  await rename(`${full}.tmp`, full);

  // ── judged again: only the touched ones, by the rule ──────────────────────
  const touched = new Set(hits.flatMap((h) => h.claims));
  const v1 = Object.fromEntries(file.claims.map((c) => [c.claimId, c.verdict])) as Record<string, Verdict>;
  const v2 = Object.fromEntries(file.claims.map((c) => [c.claimId, touched.has(c.claimId) ? afterInterview(c.verdict) : c.verdict])) as Record<string, Verdict>;
  const rejudged = ids.filter((id) => touched.has(id));

  // ── So what again, from the new verdicts (the Summary call, no evidence) ──
  let soWhat = file.summary.so_what;
  try {
    const s = await llmJson({
      model,
      task: 'summary',
      ...summaryPrompt({
        question: plan.question,
        purpose: plan.purpose,
        exploratory: false,
        claims: file.claims.map((c) => ({
          label: c.label,
          statement: statementOf.get(c.claimId) ?? '',
          verdict: v2[c.claimId],
          adjustedNote: touched.has(c.claimId) && v2[c.claimId] !== v1[c.claimId] ? `访谈追加：${v1[c.claimId]} → ${v2[c.claimId]}` : '',
          reasoning: c.judgment.reasoning,
          soWhat: c.judgment.so_what,
          gaps: c.judgment.gaps,
          expertQuestions: [],
          keyEvidence: [],
          key: keyOf.get(c.claimId),
        })),
      }),
      schema: summarySchema,
    });
    if (stripKeys(s.so_what)) soWhat = stripKeys(s.so_what);
  } catch (e) {
    await log('research:interview-summary-failed', `重写 So what 失败：${e instanceof Error ? e.message.slice(0, 120) : String(e)}`, '沿用 v1 的 So what');
  }

  // ── v2 ────────────────────────────────────────────────────────────────────
  const vNext = baseV.n + 1;
  const name = `报告 v${vNext}`;
  const keys = [...new Set(plan.claims.flatMap((c) => (c.key ? [c.key] : [])))].sort();
  const verdictsOfKey = (k: string, by: Record<string, Verdict>) => file.claims.filter((c) => keyOf.get(c.claimId) === k).map((c) => by[c.claimId]);
  const hitsOf = (id: string) => hits.filter((h) => h.claims.includes(id));
  const changes = [
    CHANGE_HEADING,
    '',
    '| | v1 | v2 |',
    '|---|---|---|',
    `| So what | ${cell(stripKeys(file.summary.so_what))} | ${cell(soWhat)} |`,
    ...keys.map((k) => {
      const touchedKey = file.claims.some((c) => keyOf.get(c.claimId) === k && touched.has(c.claimId));
      const before = keyQuestionLabel(keyQuestionVerdict(verdictsOfKey(k, v1)));
      return `| ${k} | ${before} | ${touchedKey ? keyQuestionLabel(keyQuestionVerdict(verdictsOfKey(k, v2))) : UNTOUCHED} |`;
    }),
    '',
    `- 追加的访谈：${notes.map((n) => `${link(n.path)}${n.simulated ? '（模拟访谈）' : ''}`).join('、') || '无'}`,
    ...file.claims.map((c) => {
      const id = c.claimId;
      if (!touched.has(id)) return `- ${c.label}：沿用 v1（${v1[id]}）`;
      const why = hitsOf(id).map((h) => `${h.interview}：${h.reason}`).join('；');
      return v2[id] !== v1[id] ? `- ${c.label}：${v1[id]} → ${v2[id]}（${why}）` : `- ${c.label}：${v1[id]}，不变（访谈涉及，${whyKept[v1[id]] ?? '判断不变'}；${why}）`;
    }),
    '- 访谈最多把判断提到“访谈支持”，不能提到“成立”；这次没有新做联网检索。',
    '',
  ];
  const lines = base.body.trimEnd().split('\n');
  const titleAt = lines.findIndex((l) => /^# /.test(l));
  if (titleAt >= 0) lines[titleAt] = lines[titleAt].replace(/调查报告 v\d+/, `调查报告 v${vNext}`);
  const sw = lines.indexOf('## So what');
  const swEnd = lines.findIndex((l, i) => i > sw && l.startsWith('## '));
  if (soWhat !== file.summary.so_what) lines.splice(sw + 1, swEnd - sw - 1, '', soWhat, '');
  // the three reasons again: each with what the interviews said about the judgments it rests on (bottom up, so the indexes hold)
  const record = await loadEvidenceRecord(ctx.vault, baseV.path, base.data);
  const { reasons, added } = reasonsWithInterviews(file, record, hits, new Set(notes.filter((n) => n.simulated).map((n) => n.title)));
  const why = lines.findIndex((l) => /^## 为什么/.test(l));
  const whyEnd = lines.findIndex((l, i) => i > why && l.startsWith('## '));
  const starts = why < 0 ? [] : lines.flatMap((l, i) => (i > why && i < whyEnd && /^\d+\. /.test(l) ? [i] : []));
  for (let r = starts.length - 1; r >= 0; r--) {
    if (!added[r]?.length) continue;
    let end = starts[r] + 1;
    while (end < whyEnd && /^ {3}- /.test(lines[end])) end++;
    lines.splice(end, 0, ...added[r]);
  }
  const appendix = lines.indexOf('## 附录：过程和证据');
  lines.splice(appendix < 0 ? lines.length : appendix, 0, ...changes);

  const { id: _id, version: _v, created: _c, updated: _u, type: _t, status: _s, author: _a, evidence_record_file: _e, ...kept } = base.data as Record<string, unknown>;
  const written = (await executeTool(
    'write_draft',
    {
      note_type: 'report',
      name,
      status: '进行中',
      frontmatter: {
        ...kept,
        id: `report-${Date.now().toString(36)}-v${vNext}`,
        version: vNext,
        derived_from: [link(baseV.path), ...notes.map((n) => link(n.path))],
        verdicts_proposed: v2,
        interview_followup: { from: link(baseV.path), interviews: notes.map((n) => link(n.path)), hits_file: INTERVIEW_HITS_FILE },
      },
      body: `${lines.join('\n')}\n`,
      why: '访谈放进来以后的追加分析：只重判访谈涉及的判断',
    },
    reportCtx,
  )) as { path: string };

  // the evidence and the judgment v2 stands on: v1's, with the new verdicts and So what
  const sidecar = await writeEvidenceSidecar(ctx.vault, written.path, record);
  const note = await ctx.vault.read(written.path);
  await ctx.vault.write(written.path, { frontmatter: { ...note.data, ...sidecar }, body: note.body }, { overwrite: true });
  await saveJudgmentFile(ctx.vault, written.path, {
    ...file,
    report: path.posix.basename(written.path),
    claims: file.claims.map((c) => ({ ...c, verdict: v2[c.claimId] })),
    summary: { ...file.summary, so_what: soWhat, ...(reasons.length ? { reasons } : {}) },
  });
  const changed = file.claims.filter((c) => v2[c.claimId] !== v1[c.claimId]);
  if (changed.length) {
    const proposals = [];
    for (const c of changed) {
      const h = plan.claims.find((x) => x.id === c.claimId)?.hypothesis;
      const res = h ? await ctx.vault.resolveLink(h, ctx.workspacePath).catch(() => null) : null;
      proposals.push({ claimId: c.claimId, hypothesisPath: res?.ok ? res.path : null, verdict: v2[c.claimId] });
    }
    await writeProposedVerdicts({ vault: ctx.vault, logPath: ctx.logPath, reportName: name, now: ctx.now(), proposals });
  }
  await log('research:interview-followup', `${name}：访谈 ${notes.length} 份，重判 ${rejudged.join('、') || '无'}，判断变了 ${changed.map((c) => c.label).join('、') || '无'}`, '访谈只改它涉及的判断，最多到访谈支持');
  return { reportPath: written.path, hits, rejudged, verdicts: v2 };
}
