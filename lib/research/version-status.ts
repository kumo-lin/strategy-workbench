/**
 * What a report version is, said as it is (D-39 aftermath): a delivered report in the older structure (论点 → 子问题,
 * not the question tree) that no person confirmed, and that no 对照表 pins as the version to compare, must not read as
 * a confirmed latest conclusion (S3's WS-A 报告 v4 and W5 报告 v1). Such a version gets
 *   "旧结构版本，未经用户确认" — "确认" when the same investigation has a version a person confirmed (the confirmation
 *   is what this one lacks), "判断" when none has (nothing there was judged by a person yet);
 *   "，已被新结构的版本取代" once a later version of the same investigation is a question-tree report.
 * Drafts keep their own label (versionStatuses below), and nothing is named in code: the rule reads the frontmatter.
 * Pure — safe to import from client components (pinnedTeamReport only reads the vault it is given).
 */
import type { Vault } from '@/lib/vault';

export interface VersionInfo {
  path: string;
  /** The version number (报告 v4 → 4). */
  n: number;
  data: Record<string, unknown>;
  body: string;
}

/** A question-tree report (D-39): its frontmatter says so, or (an older write) its sub-questions are "## Q1 …" sections. */
export const isTreeReport = (v: Pick<VersionInfo, 'data' | 'body'>): boolean => v.data.report_format === 'question_tree' || /^## Q\d+ /m.test(v.body);

/** A person confirmed the report's content (content_confirmed_by / _at, or any *_confirmed_by field). */
export const isConfirmed = (data: Record<string, unknown>): boolean => Object.entries(data).some(([k, v]) => /confirmed(?:_by|_at)?$/.test(k) && v !== null && v !== undefined && v !== '' && v !== false);

/** path → the label of each version the rule applies to (the others have none). */
export function versionStatusLabels(versions: VersionInfo[], pinnedMain?: string | null): Map<string, string> {
  const out = new Map<string, string>();
  const word = versions.some((v) => isConfirmed(v.data)) ? '确认' : '判断';
  for (const v of versions) {
    if (isTreeReport(v) || isConfirmed(v.data) || v.data.delivery !== '已交付' || v.path === pinnedMain) continue;
    const replaced = versions.some((w) => w.n > v.n && isTreeReport(w));
    out.set(v.path, `旧结构版本，未经用户${word}${replaced ? '，已被新结构的版本取代' : ''}`);
  }
  return out;
}

/*
 * The versions a run left on the way (kept: deleting them would rewrite the history), said as they are:
 *   a 试水调查 (its first run was small, not a 追加调查) → "试水调查 · 只回答了第一个子问题" (an older-structure report:
 *   "只查了第一个假设"; a small run takes the first hypothesis in reading order);
 *   a draft the self-check stopped → "草稿 · 自检未通过（原因）", the reason being the first kind of failed_checks in
 *   plain words ("见报告顶部" when it has none);
 *   either of the two, when a later version of the same investigation was delivered → "… · 之后的 vN 已交付" (the latest);
 *   a version only rewritten from an earlier one's evidence (D-48: research_run.rewrite, rewrite_of) → "用 vN 的证据重写，没有重新调查".
 */

export const isDelivered = (data: Record<string, unknown>): boolean => data.delivery === '已交付';

/** The version the report page shows when none is picked: the latest delivered one, else the latest. Any order. */
export function defaultVersion<T extends Pick<VersionInfo, 'n' | 'data'>>(versions: T[]): T | undefined {
  const newest = [...versions].sort((a, b) => b.n - a.n);
  return newest.find((v) => isDelivered(v.data)) ?? newest[0];
}

/** The version's own run was a 试水调查 (a 追加调查 also records its budget as the mode; it is not one). */
export function isSmallRun(data: Record<string, unknown>): boolean {
  if (data.follow_up) return false;
  const rr = data.research_run as { mode?: unknown } | undefined;
  return (typeof rr?.mode === 'string' ? rr.mode : data.run_mode) === 'small';
}

/**
 * A version only rewritten (D-48: the writing redone on an earlier version's evidence, nothing searched): the version
 * it was rewritten from (rewrite_of "[[…/报告 v4|报告 v4]]" → 4; 0 when the link does not say), else null.
 */
export function rewrittenFrom(data: Record<string, unknown>): number | null {
  const rr = data.research_run as { rewrite?: unknown } | undefined;
  if (rr?.rewrite !== true && !data.rewrite_of) return null;
  const m = typeof data.rewrite_of === 'string' ? /v(\d+)\s*(?:\]\]|$)/.exec(data.rewrite_of.replace(/\|[^\]]*/, '')) : null;
  return m ? Number(m[1]) : 0;
}

const KEY = (k: string) => new RegExp(`(?<![A-Za-z0-9])${k}(?![A-Za-z0-9])`, 'g');

/**
 * The evidence-key check fired on the source's own text, not on a key the model leaked: every key it named is either
 * part of a %-encoded URL (%E6…) or written in a quoted original (“…E7 Frontier Suite…”, a product name).
 */
function sourceWording(keys: string[], body: string): boolean {
  const quotes = [...body.matchAll(/“[^”]*”/g)].map((m) => m[0]);
  const encoded = (k: string) => {
    const at = [...body.matchAll(KEY(k))].map((m) => m.index ?? 0);
    return at.length > 0 && at.every((i) => body[i - 1] === '%');
  };
  return keys.length > 0 && keys.every((k) => quotes.some((q) => KEY(k).test(q)) || encoded(k));
}

/** failed_checks are stored as their messages: the kind of a message, in plain words (a kind not listed: 见报告顶部). */
const KINDS: { kind: RegExp; say: string | ((failed: string[], body: string) => string) }[] = [
  { kind: /截断/, say: (f) => (/判断/.test(f[0]) ? '判断输出被截断' : '模型输出被截断') },
  {
    kind: /证据编号/,
    say: (f, body) => {
      const keys = [...new Set(f.flatMap((m) => [.../(?<![A-Za-z0-9])E\d+(?![A-Za-z0-9])/.exec(m) ?? []]))];
      return sourceWording(keys, body) ? '证据编号检查误报' : '正文里漏出了证据编号';
    },
  },
  { kind: /写入后的文件自检失败/, say: '写好的文件复查没有通过' },
  { kind: /对不上/, say: '引用的原文和资料对不上' },
  { kind: /没有写出原文/, say: '引用缺原文' },
  { kind: /引用的资料不存在|引用的块不存在|资料名有歧义|链接找不到笔记/, say: '引用的资料找不到' },
  { kind: /没有对应的脚注/, say: '角标没有对应的脚注' },
  { kind: /有数字但没有出处/, say: '数字没有出处' },
  { kind: /没有出处/, say: '证据没有出处' },
  { kind: /^缺少|缺少“|没有回答|没有任何假设|必须放在最前面/, say: '报告缺了必需的部分' },
];

/** Why a draft was not delivered: the first kind of its failed_checks, in plain words. `body`: the report as stored. */
export function draftReason(failedChecks: unknown, body: string): string {
  const failed = Array.isArray(failedChecks) ? failedChecks.filter((f): f is string => typeof f === 'string') : [];
  const first = failed[0];
  const k = first ? KINDS.find((x) => x.kind.test(first)) : undefined;
  if (!first || !k) return '见报告顶部';
  if (typeof k.say === 'string') return k.say;
  // the kind's own messages, and the report without the draft notice above its title (it repeats them)
  const title = body.search(/^# /m);
  return k.say(failed.filter((f) => k.kind.test(f)), title > 0 ? body.slice(title) : body);
}

export interface VersionStatus {
  label: string;
  /** Said at the top of the report too: a version that must not read as a confirmed latest conclusion. */
  note: boolean;
}

/** path → what each version is: a rewrite, a 试水调查, a stopped draft, M3's older-structure label (versionStatusLabels). */
export function versionStatuses(versions: VersionInfo[], pinnedMain?: string | null): Map<string, VersionStatus> {
  const old = versionStatusLabels(versions, pinnedMain);
  const out = new Map<string, VersionStatus>();
  for (const v of versions) {
    const small = isSmallRun(v.data);
    const draft = v.data.delivery === '草稿' && Array.isArray(v.data.failed_checks) && v.data.failed_checks.length > 0;
    const parts: string[] = [];
    const from = rewrittenFrom(v.data);
    if (from !== null) parts.push(`用${from ? ` v${from} ` : '上一版'}的证据重写，没有重新调查`);
    if (small) parts.push(`试水调查 · ${isTreeReport(v) ? '只回答了第一个子问题' : '只查了第一个假设'}`);
    if (draft) parts.push(`草稿 · 自检未通过（${draftReason(v.data.failed_checks, v.body)}）`);
    if (old.has(v.path)) parts.push(old.get(v.path)!);
    const later = (small || draft) && versions.filter((w) => w.n > v.n && isDelivered(w.data)).sort((a, b) => b.n - a.n)[0];
    if (later) parts.push(`之后的 v${later.n} 已交付`);
    if (parts.length) out.set(v.path, { label: parts.join(' · '), note: draft || old.has(v.path) });
  }
  return out;
}

/** A report version of an investigation folder. */
export interface ReportRef {
  n: number;
  path: string;
  name: string;
}

/**
 * The version an older must-3 comparison note of the folder fixed as its main comparison (`compare.team_report`,
 * D-22). The comparison page is gone (D-64 T31); the S3 notes still name it, and its label stays as it was.
 */
export async function pinnedTeamReport(vault: Vault, dir: string, reports: ReportRef[]): Promise<ReportRef | undefined> {
  const byPath = new Map(reports.map((r) => [r.path, r]));
  for (const e of await vault.list(dir).catch(() => [])) {
    if (e.kind !== 'file' || !e.name.endsWith('.md') || byPath.has(e.path)) continue;
    const compare = (await vault.read(e.path).catch(() => null))?.data.compare as { team_report?: unknown } | undefined;
    if (typeof compare?.team_report !== 'string') continue;
    const res = await vault.resolveLink(compare.team_report, e.path);
    const ref = res.ok ? byPath.get(res.path) : undefined;
    if (ref) return ref;
  }
  return undefined;
}
