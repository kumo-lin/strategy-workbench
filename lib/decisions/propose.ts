/**
 * propose_decision (PRD §6.4, §10.2, §7 rules 10–11): the AI writes a 决定 + 理由 as a
 * draft. What the system enforces, not the prompt:
 *   - only a Senior's request drafts one; the report must be delivered and in this Workspace
 *   - status is always 推断, author AI, decided_by empty; only `decision.confirm` changes that
 *   - every reason carries block citations that exist AND that the report itself cites;
 *     the quote in front of each is copied from the source block, never from the model
 *   - derived_from is the report; relates_to is the Workspace, the project and the hypotheses
 *     the report is about, so later research finds the decision along relates_to (./retrieve.ts)
 */
import { splitClaimText, loadSourceInfo } from '@/lib/research/sources';
import { extractWikiLinks, parseWikiLink, toWikiLink, type Vault } from '@/lib/vault';
import type { ToolContext } from '@/lib/harness/types';
import { loadModelsConfig } from '@/lib/config/models';
import { resolveProviderId } from '@/lib/models/provider';
import { ReviewFlowError } from '@/lib/workplan/review-flow';
import { checkDecisionBody, citedBlocks, insufficientOnlyBlocks } from './check';
import type { ProposeDecisionArgs } from './schema';

/** The request is understood but the vault's state says no (HTTP 409 through the shared error mapper). */
export class DecisionFlowError extends ReviewFlowError {
  name = 'DecisionFlowError';
}

export interface ProposeDecisionResult {
  path: string;
  name: string;
  status: '推断';
  report: string;
  reasons: number;
  relates_to: string[];
  /** true when an earlier 推断 draft of the same name was replaced. */
  replaced: boolean;
  /** "label（model）" of the model that wrote the draft; null when it cannot be told. */
  model: string | null;
}

/** The provider / model behind a draft, in the shape of M2's `research:done` row (label + model). */
export interface DraftModelInfo {
  providerId: string;
  label: string;
  model: string;
}

/**
 * `draftDecision` knows which model it called; the harness context is a frozen contract, so the caller
 * hangs that on a copy of it. The model-facing arguments cannot carry it: the AI must not name itself.
 */
export type DraftToolContext = ToolContext & { draftModel?: DraftModelInfo };

export const modelText = (m: Pick<DraftModelInfo, 'label' | 'model'>) => `${m.label}（${m.model}）`;

/** Who drafted: the model `draftDecision` called, else the active provider in the model config. */
async function draftingModel(ctx: DraftToolContext): Promise<Pick<DraftModelInfo, 'label' | 'model'> | null> {
  if (ctx.draftModel) return ctx.draftModel;
  try {
    const config = await loadModelsConfig(ctx.vault);
    return config.providers[resolveProviderId(config)] ?? null;
  } catch {
    return null;
  }
}

const noExt = (p: string) => p.replace(/\.md$/, '');
const baseName = (p: string) => noExt(p).split('/').pop() ?? p;
/** `…/WS-A/workspace.md` shows as WS-A. */
const displayName = (p: string) => (baseName(p) === 'workspace' ? (noExt(p).split('/').at(-2) ?? 'workspace') : baseName(p));
const linkOf = (path: string) => toWikiLink(noExt(path), { alias: displayName(path) });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/** The report this draft is about: delivered, and inside this Workspace's 调查/. */
export async function loadDeliveredReport(ctx: ToolContext, reportPath: string) {
  const path = reportPath.trim().replace(/^\[\[|\]\]$/g, '');
  const full = path.endsWith('.md') ? path : `${path}.md`;
  if (!full.startsWith(`${ctx.workspacePath}/调查/`)) throw new DecisionFlowError(`报告必须在本 Workspace 的 调查/ 里：${full}`);
  if (!(await ctx.vault.exists(full))) throw new DecisionFlowError(`找不到报告：${full}`);
  const report = await ctx.vault.read(full);
  if (report.data.type !== 'report') throw new DecisionFlowError(`${full} 不是报告`);
  if (report.data.delivery === '草稿') throw new DecisionFlowError('报告还没有交付（自检没有通过）：交付之后才能起草决定');
  return report;
}

/** Hypothesis notes the report is about: linked from its frontmatter or its body. */
async function hypothesesOf(vault: Vault, report: { path: string; data: Record<string, unknown>; body: string }): Promise<string[]> {
  const raw = Array.isArray(report.data.relates_to) ? (report.data.relates_to as string[]) : [];
  const links = [...raw.map((r) => parseWikiLink(r)).filter((l) => l !== null), ...extractWikiLinks(report.body)];
  const out: string[] = [];
  for (const l of links) {
    const r = await vault.resolveLink(l.raw, report.path);
    if (!r.ok || out.includes(r.path)) continue;
    if ((await vault.read(r.path)).data.type === 'hypothesis') out.push(r.path);
  }
  return out;
}

async function renderCite(vault: Vault, link: string, reportPath: string, inReport: Set<string>): Promise<string> {
  const c = await vault.checkCitation(link, { fromPath: reportPath });
  if (!c.ok || !c.path || !c.block) throw new DecisionFlowError(`引用 ${link} 对不上（${c.error ?? '未知'}）：只能引用资料里存在的块`);
  if (!inReport.has(`${c.path}#${c.block}`)) throw new DecisionFlowError(`引用 ${link} 报告里没有引用过：决定的理由只能用报告引用过的证据`);
  const info = await loadSourceInfo(vault, c.path).catch(() => {
    throw new DecisionFlowError(`引用 ${link} 的资料已在文件管理里取消勾选：决定的理由不能用它`);
  });
  if (!info) throw new DecisionFlowError(`${link} 指向的不是资料笔记`);
  const quote = splitClaimText(c.blockText ?? '').quote.replace(/[“”"]/g, '').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();
  const origin = info.origin === '网络' ? `网络 · ${info.gradedBy === '人' ? '人工定级' : 'AI 定级'}` : '知识库';
  return `“${clip(quote, 90)}”（${info.grade} 级，${origin}）[[${info.linkTarget}#^${c.block}]]`;
}

export function safeNoteName(name: string): string {
  return name.replace(/[\\/:*?"<>|[\]#^\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
}

/** 复核 P11: a name with a suffix that survives the 60-character cut (the base is shortened, never the suffix). */
export function withSuffix(name: string, suffix: string): string {
  return `${safeNoteName(name).slice(0, 60 - suffix.length).trim()}${suffix}`;
}

/**
 * Where a draft goes. The name is the model's own, so a second model drafting from the same report can land on
 * the first one's file. Only the same model redrafting replaces its own 推断 draft; a different model's draft,
 * and anything already confirmed, is left alone and the new one is saved under "<名字>（<模型 label>）" (+ 序号).
 */
async function placeDraft(vault: Vault, dir: string, name: string, drafter: string | null, label: string) {
  const basePath = `${dir}/${name}.md`;
  const base = (await vault.exists(basePath)) ? await vault.read(basePath) : null;
  const ownDraft = (n: Awaited<ReturnType<Vault['read']>> | null) =>
    n?.data.type === 'decision' && n.data.status === '推断' && ((n.data.drafted_by_model as string | undefined) ?? null) === drafter;
  if (!base) return { fileName: name, path: basePath, existing: null };
  if (ownDraft(base)) return { fileName: name, path: basePath, existing: base };
  // What is already confirmed (or is not a decision at all) is never replaced, whoever drafts.
  if (base.data.type !== 'decision' || (base.data.status !== '推断' && base.data.status !== '已否决')) {
    throw new DecisionFlowError(`「${name}」已经是${String(base.data.status)}的决定，不能覆盖：换一个名字`);
  }
  // A returned decision is history: the next draft goes beside it as 「第 2 稿」, never on top of it.
  const candidates: string[] = [];
  if (base.data.status === '已否决') for (let i = 2; i < 50; i++) candidates.push(withSuffix(name, `（第 ${i} 稿）`));
  candidates.push(withSuffix(name, `（${safeNoteName(label)}）`));
  for (let i = 2; i < 50; i++) candidates.push(withSuffix(name, `（${safeNoteName(label)}） ${i}`));
  for (const fileName of candidates) {
    const path = `${dir}/${fileName}.md`;
    if (!(await vault.exists(path))) return { fileName, path, existing: null };
    const existing = await vault.read(path);
    if (ownDraft(existing)) return { fileName, path, existing };
  }
  throw new DecisionFlowError(`「${name}」已经有太多同名的决定，换一个名字`);
}

export async function proposeDecision(args: ProposeDecisionArgs, ctx: DraftToolContext): Promise<ProposeDecisionResult> {
  const { vault } = ctx;
  if (ctx.role.kind !== 'senior') throw new DecisionFlowError(`只有 Senior 可以起草决定（现在是 ${ctx.role.name}）`);
  const report = await loadDeliveredReport(ctx, args.report);
  const baseName0 = safeNoteName(args.name);
  if (!baseName0) throw new DecisionFlowError('决定的名字不能为空');
  // D63 §1: a decision must say where it holds (the schema keeps scope optional so older decisions still read)
  if (typeof args.scope !== 'string' || !args.scope.trim()) throw new DecisionFlowError('决定必须写适用边界（scope）');

  const inReport = await citedBlocks(vault, report.body, report.path);
  const weakOnly = await insufficientOnlyBlocks(vault, report.body, report.path);
  const reasonLines: string[] = [];
  for (const r of args.reasons) {
    const keys: string[] = [];
    for (const link of r.cites) {
      const c = await vault.checkCitation(link, { fromPath: report.path });
      if (c.path && c.block) keys.push(`${c.path}#${c.block}`);
    }
    if (keys.length && keys.every((k) => weakOnly.has(k))) {
      throw new DecisionFlowError(`理由「${oneLine(r.text).slice(0, 30)}」的证据只来自报告判为"证据不足"的论点：这类论点不能支撑决定，只能写进"还缺什么"或"什么情况下要重新考虑"`);
    }
    const cites: string[] = [];
    for (const link of r.cites) cites.push(await renderCite(vault, link, report.path, inReport));
    reasonLines.push(`- **${r.kind}**：${oneLine(r.text)} ${cites.join(' ')}`);
  }

  // Block links elsewhere (counter-evidence, gaps…) are held to the same rule as reasons, minus the quote.
  for (const [field, texts] of [['决定', [args.decision]], ['反证', args.counter], ['还缺什么', args.gaps], ['重新考虑', args.reconsider], ['理由', args.reasons.map((r) => r.text)]] as const) {
    for (const l of texts.flatMap((t) => extractWikiLinks(t)).filter((x) => x.block)) {
      if (field === '理由') throw new DecisionFlowError(`理由的 text 里不要写块链接 ${l.raw}：放进 cites`);
      const c = await vault.checkCitation(l.raw, { fromPath: report.path });
      if (!c.ok || !inReport.has(`${c.path}#${c.block}`)) throw new DecisionFlowError(`「${field}」里的引用 ${l.raw} 不是报告引用过的块`);
    }
  }

  const affects: string[] = [];
  for (const raw of args.affects) {
    const l = parseWikiLink(raw);
    const res = l ? await vault.resolveLink(raw, `${ctx.projectPath}/决策/${baseName0}.md`) : null;
    if (!l || !res?.ok) throw new DecisionFlowError(`「影响」里的链接 ${raw} 找不到对应的笔记`);
    const type = (await vault.read(res.path)).data.type;
    if (type !== 'workspace' && type !== 'hypothesis' && type !== 'project') {
      throw new DecisionFlowError(`「影响」只能指向 Workspace、假设或项目，${raw} 是 ${String(type)}`);
    }
    affects.push(linkOf(res.path));
  }

  const hypotheses = await hypothesesOf(vault, report);
  const reportLink = linkOf(report.path);
  const relatesTo = [linkOf(`${ctx.workspacePath}/workspace.md`), linkOf(`${ctx.projectPath}/项目.md`), ...hypotheses.map(linkOf)];
  const list = (items: string[]) => items.map((s) => `- ${oneLine(s)}`).join('\n');
  const body = [
    `# ${baseName0}`,
    '',
    `> **草稿，状态"推断"**。由 AI 根据 ${reportLink} 起草，等 Senior 看过、改过再确认；\`decided_by\` 只能由人设。`,
    '',
    '## 决定',
    '',
    args.decision.trim(),
    '',
    '## 理由',
    '',
    ...reasonLines,
    '',
    '## 适用边界',
    '',
    args.scope.trim(),
    '',
    '## 反证和不确定',
    '',
    list(args.counter.length ? args.counter : ['报告没有找到反证']),
    '',
    '## 还缺什么',
    '',
    list(args.gaps.length ? args.gaps : ['报告没有列出缺口']),
    '',
    '## 影响',
    '',
    list(affects.length ? affects : ['（没有指明）']),
    '',
    '## 什么情况下要重新考虑',
    '',
    list(args.reconsider),
    '',
  ].join('\n');

  // The same check the Senior's edit and the confirmation go through, applied before anything is written.
  const dm = await draftingModel(ctx);
  const drafter = dm ? modelText(dm) : null;
  const { fileName, path, existing } = await placeDraft(vault, `${ctx.projectPath}/决策`, baseName0, drafter, dm?.label ?? '未记录模型');
  const check = await checkDecisionBody(vault, { decisionPath: path, reportPath: report.path, body: body.replace(/^# .*/, `# ${fileName}`) });
  if (!check.ok) throw new DecisionFlowError(`起草的决定没有通过自检：${check.problems.join('；')}`);
  const now = ctx.now().toISOString();
  const date = now.slice(0, 10);
  await vault.write(
    path,
    {
      frontmatter: {
        id: `dec-${ctx.now().getTime().toString(36)}`,
        type: 'decision',
        status: '推断',
        created: existing ? String(existing.data.created ?? date) : date,
        updated: date,
        author: 'AI',
        ...(drafter ? { drafted_by_model: drafter } : {}),
        derived_from: [reportLink],
        relates_to: relatesTo,
        decided_by: null,
        trigger: reportLink,
        reason: oneLine(args.reason),
        scope: oneLine(args.scope),
        affects,
      },
      body: body.replace(/^# .*/, `# ${fileName}`),
    },
    { overwrite: Boolean(existing) },
  );
  return { path, name: fileName, status: '推断', report: report.path, reasons: args.reasons.length, relates_to: relatesTo, replaced: Boolean(existing), model: drafter };
}
