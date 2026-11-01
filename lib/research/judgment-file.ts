/**
 * D-48 第 4 轮 A: `报告 vN.judgment.json`, the judgment a report was written on. A later rewrite of the writing only
 * (scripts/rewrite-report.ts) takes it as fixed: the conditions' states and evidence as they were, the verdict derived
 * from them by code; the model only writes. Across versions the evidence is known by its block link, never by its key
 * (the keys are numbered again every run).
 *
 * A report written before this file existed is read back from its body (judgmentFromBody): each condition line
 * "  - ① <条件> → 状态：（系统复核：…）说明[^3][^5]", each footnote's definition ending with its block link.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verdictSchema, type ResearchPlanNote, type Verdict } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import type { ClaimResult } from './judge';
import { plannedConditions } from './judge';
import { hypothesisLabel } from './question-tree';
import { CONDITION_STATUSES, judgmentSchema, type ConditionStatus, type Judgment, type Recommendation, type SummaryDraft } from './schemas';

/** One condition as stored: keys are this version's, `keyed` maps them to block links. */
export interface StoredCondition {
  n: number;
  label: string;
  text: string;
  status: ConditionStatus;
  keys: string[];
  note: string;
  adjusted?: string;
}

export interface JudgmentFile {
  report: string;
  /** This version's evidence keys → block links. */
  keyed: Record<string, string>;
  claims: { claimId: string; label: string; conditions: StoredCondition[]; verdict: Verdict; adjusted?: boolean; adjustNote?: string; judgment: Judgment }[];
  /** 第 5 轮: the Summary as the model wrote it (its one-line answer among it) and the recommendation, keyed as above. */
  summary?: Omit<SummaryDraft, 'recommendation'>;
  recommendation?: Recommendation;
  /** "body": read back from the report's text (a report written before the file existed). */
  source?: 'run' | 'body';
}

/**
 * A hypothesis' judgment, frozen: its conditions with the evidence as block links. `note` keeps where each footnote
 * stood, as ⟦i⟧ (an index into `refs`), so the note reads the same once the keys are given again.
 */
export interface FrozenCondition {
  n: number;
  label: string;
  text: string;
  status: ConditionStatus;
  refs: string[];
  note: string;
  adjusted?: string;
}
export interface FrozenClaim {
  claimId: string;
  label: string;
  conditions: FrozenCondition[];
  verdict: Verdict | null;
  /** From a judgment file: the whole judgment as stored, keyed by `keyed` (a card kept word for word, --only). */
  stored?: { judgment: Judgment; keyed: Record<string, string> };
  /** 第 5 轮 --only: not listed, so its card is rendered from `stored` as it was, no model call. */
  keep?: boolean;
}

export const judgmentFilePath = (reportPath: string) => `${reportPath.replace(/\.md$/, '')}.judgment.json`;

function absolute(vault: Vault, rel: string): string {
  const root = path.resolve(vault.root);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error(`path escapes the vault: ${rel}`);
  return full;
}

export async function saveJudgmentFile(vault: Vault, reportPath: string, file: JudgmentFile): Promise<string> {
  const rel = judgmentFilePath(reportPath);
  const full = absolute(vault, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(`${full}.tmp`, `${JSON.stringify(file, null, 1)}\n`, 'utf8');
  await rename(`${full}.tmp`, full);
  return rel;
}

/** The file of a run's results: each claim's conditions and judgment, the keys it uses mapped to their blocks. */
export function judgmentFileOf(reportPath: string, results: ClaimResult[], summary?: SummaryDraft): JudgmentFile {
  const keyed: Record<string, string> = {};
  for (const r of results) for (const [k, e] of r.keyed) keyed[k] = e.ref;
  return {
    report: path.posix.basename(reportPath),
    keyed,
    claims: results.map((r) => ({
      claimId: r.claim.id,
      label: r.label,
      conditions: (r.conditions ?? []).map((c) => ({ n: c.n, label: c.label, text: c.text, status: c.status, keys: c.keys, note: c.note, ...(c.adjusted ? { adjusted: c.adjusted } : {}) })),
      verdict: r.verdict,
      ...(r.adjusted ? { adjusted: true, adjustNote: r.adjustNote } : {}),
      judgment: r.judgment,
    })),
    ...(summary ? { summary: summaryWithout(summary), ...(summary.recommendation ? { recommendation: summary.recommendation } : {}) } : {}),
    source: 'run',
  };
}

const summaryWithout = ({ recommendation: _, ...rest }: SummaryDraft) => rest;

export async function readJudgmentFile(vault: Vault, reportPath: string): Promise<JudgmentFile | null> {
  try {
    return JSON.parse(await readFile(absolute(vault, judgmentFilePath(reportPath)), 'utf8')) as JudgmentFile;
  } catch {
    return null;
  }
}

const KEY = /\[(E\d+)\]/g;

/** The stored file, frozen: keys back to block links (a key the file does not map: that claim cannot be frozen). */
export function frozenFromFile(file: JudgmentFile): { frozen: FrozenClaim[]; unreadable: { label: string; why: string }[] } {
  const frozen: FrozenClaim[] = [];
  const unreadable: { label: string; why: string }[] = [];
  for (const c of file.claims) {
    if (!c.conditions.length) {
      unreadable.push({ label: c.label, why: '判断文件里没有逐条的条件' });
      continue;
    }
    const lost = [...new Set(c.conditions.flatMap((x) => [...x.keys, ...[...x.note.matchAll(KEY)].map((m) => m[1])]))].filter((k) => !file.keyed[k]);
    if (lost.length) {
      unreadable.push({ label: c.label, why: `判断文件里 ${lost.join('、')} 对不上块链接` });
      continue;
    }
    frozen.push({
      claimId: c.claimId,
      label: c.label,
      verdict: c.verdict,
      ...(file.source !== 'body' && c.judgment ? { stored: { judgment: c.judgment, keyed: file.keyed } } : {}),
      conditions: c.conditions.map((x) => {
        const refs: string[] = [];
        const at = (ref: string) => (refs.includes(ref) ? refs.indexOf(ref) : refs.push(ref) - 1);
        const note = x.note.replace(KEY, (_, k: string) => `⟦${at(file.keyed[k])}⟧`);
        for (const k of x.keys) at(file.keyed[k]);
        return { n: x.n, label: x.label, text: x.text, status: x.status, refs, note, ...(x.adjusted ? { adjusted: x.adjusted } : {}) };
      }),
    });
  }
  return { frozen, unreadable };
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
const STATUS = new RegExp(` → (${CONDITION_STATUSES.join('|')})(?:：(.*))?$`);

/** The footnote definitions of a report body: n → block link (the last [[…]] of the line). */
export function footnoteRefs(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\[\^(\d+)\]:.*?(\[\[[^\]]+\]\])\s*$/gm)) out.set(m[1], m[2]);
  return out;
}

/**
 * A report written before the judgment file existed, read back from its text: per hypothesis section ("#### 假设
 * H2-1：" / "### 假设 H1："), its condition lines and its 提议的判断. A section whose lines do not match the plan's
 * conditions, or cite a footnote with no block link, is unreadable: that hypothesis is judged again.
 */
export function frozenFromBody(body: string, plan: Pick<ResearchPlanNote, 'claims'> & Partial<ResearchPlanNote>): { frozen: FrozenClaim[]; unreadable: { label: string; why: string }[] } {
  const refsOf = footnoteRefs(body);
  const lines = body.split('\n');
  const frozen: FrozenClaim[] = [];
  const unreadable: { label: string; why: string }[] = [];
  for (const claim of plan.claims) {
    const label = hypothesisLabel(plan as ResearchPlanNote, claim.id);
    const planned = plannedConditions(claim);
    if (!planned.length) continue; // an older plan's hypothesis: no conditions to freeze
    const start = lines.findIndex((l) => new RegExp(`^#{3,4} 假设 ${label.replace(/[-]/g, '\\-')}：`).test(l));
    if (start < 0) {
      unreadable.push({ label, why: '正文里没有这个假设的小节' });
      continue;
    }
    const end = lines.findIndex((l, i) => i > start && /^#{2,4} /.test(l));
    const section = lines.slice(start + 1, end < 0 ? undefined : end);
    const conditionLines = section.filter((l) => new RegExp(`^ {2}- [${CIRCLED}] `).test(l));
    const verdictLine = section.find((l) => l.startsWith('- 提议的判断：'));
    const why = (() => {
      if (conditionLines.length !== planned.length) return `正文里逐条对照的条件有 ${conditionLines.length} 条，计划里要判的是 ${planned.length} 条`;
      return null;
    })();
    if (why) {
      unreadable.push({ label, why });
      continue;
    }
    const conditions: FrozenCondition[] = [];
    let bad: string | null = null;
    conditionLines.forEach((l, i) => {
      const m = STATUS.exec(l);
      if (!m) {
        bad ??= `${CIRCLED[i]} 读不出状态`;
        return;
      }
      let rest = (m[2] ?? '').trim();
      let adjusted: string | undefined;
      const sys = /^（系统复核：(.*?)）/.exec(rest);
      if (sys) {
        adjusted = sys[1];
        rest = rest.slice(sys[0].length);
      }
      const refs: string[] = [];
      let missing: string | null = null;
      const note = rest.replace(/\[\^(\d+)\]/g, (_, n: string) => {
        const ref = refsOf.get(n);
        if (!ref) {
          missing ??= `[^${n}]`;
          return '';
        }
        const at = refs.includes(ref) ? refs.indexOf(ref) : refs.push(ref) - 1;
        return `⟦${at}⟧`;
      });
      if (missing) {
        bad ??= `${CIRCLED[i]} 的脚注 ${missing} 没有块链接`;
        return;
      }
      conditions.push({ n: planned[i].n, label: CIRCLED[i], text: planned[i].text, status: m[1] as ConditionStatus, refs, note, ...(adjusted ? { adjusted } : {}) });
    });
    if (bad) {
      unreadable.push({ label, why: bad });
      continue;
    }
    const said = verdictSchema.safeParse(verdictLine?.replace('- 提议的判断：', '').replace(/（.*$/, '').trim());
    frozen.push({ claimId: claim.id, label, conditions, verdict: said.success ? said.data : null });
  }
  return { frozen, unreadable };
}

/** A judgment file written from a report's body (--backfill-judgment): the keys are the footnote numbers (E3 = [^3]). */
export function judgmentFileFromBody(reportPath: string, body: string, frozen: FrozenClaim[]): JudgmentFile {
  const refsOf = footnoteRefs(body);
  const keyOf = new Map([...refsOf].map(([n, ref]) => [ref, `E${n}`]));
  const keyed = Object.fromEntries([...refsOf].map(([n, ref]) => [`E${n}`, ref]));
  const section = (label: string) => {
    const lines = body.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^#{3,4} 假设 ${label.replace(/[-]/g, '\\-')}：`).test(l));
    const end = lines.findIndex((l, i) => i > start && /^#{2,4} /.test(l));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };
  const lineAfter = (s: string[], head: RegExp) => s.find((l) => head.test(l))?.replace(head, '').trim() ?? '';
  return {
    report: path.posix.basename(reportPath),
    keyed,
    claims: frozen.map((f) => {
      const conditions = f.conditions.map((c) => ({
        n: c.n,
        label: c.label,
        text: c.text,
        status: c.status,
        keys: c.refs.map((r) => keyOf.get(r)!),
        note: c.note.replace(/⟦(\d+)⟧/g, (_, i: string) => `[${keyOf.get(c.refs[Number(i)])}]`),
        ...(c.adjusted ? { adjusted: c.adjusted } : {}),
      }));
      const s = section(f.label);
      const cite = (t: string) => t.replace(/\[\^(\d+)\]/g, (m, n: string) => (refsOf.has(n) ? `[E${n}]` : m));
      const judgment = judgmentSchema.parse({
        verdict: f.verdict ?? '证据不足',
        reasoning: '（从报告正文读回）',
        conditions: conditions.map((c) => ({ n: c.n, status: c.status, keys: c.keys, note: c.note })),
        changed: cite(lineAfter(s, /^- 改了什么：/)),
        answer: cite(lineAfter(s, /^- (?:Q[\d-]+ 的)?回答：/)),
        so_what: [cite(lineAfter(s, /^- So What：/))].filter(Boolean),
        support_lines: [],
        counter_lines: [],
        challenge_responses: [],
        model_knowledge: [],
        gaps: [],
        expert_questions: [],
      });
      return { claimId: f.claimId, label: f.label, conditions, verdict: f.verdict ?? judgment.verdict, judgment };
    }),
    source: 'body',
  };
}

const GROUP = /[[【]\s*E\d+[^\]】\n]*[\]】]/g;

/** Every evidence key a stored part cites: in its bracket groups, and in the fields that hold keys. */
export function storedKeys(v: unknown): string[] {
  const out = new Set<string>();
  const walk = (x: unknown, field?: string) => {
    if (typeof x === 'string') {
      const found = field === 'key' || field === 'keys' || field === 'rebutted' ? (x.match(/E\d+/g) ?? []) : [...x.matchAll(GROUP)].flatMap((m) => m[0].match(/E\d+/g) ?? []);
      for (const k of found) out.add(k);
    } else if (Array.isArray(x)) x.forEach((y) => walk(y, field));
    else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(v);
  return [...out];
}

/**
 * A stored part with this run's keys: each old key → its block link → the key this run gave that block. Only the
 * bracket groups of the words and the fields that hold keys; "E7" in a product's name stays. Null: a key has no new one.
 */
export function rekeyed<T>(v: T, keyed: Record<string, string>, keyOf: Map<string, string>): T | null {
  const to = (k: string) => (keyed[k] ? keyOf.get(keyed[k]) : undefined);
  if (storedKeys(v).some((k) => !to(k))) return null;
  const walk = (x: unknown, field?: string): unknown => {
    if (typeof x === 'string') {
      if (field === 'key' || field === 'keys' || field === 'rebutted') return x.replace(/E\d+/g, (k) => to(k) ?? k);
      return x.replace(GROUP, (g) => g.replace(/E\d+/g, (k) => to(k) ?? k));
    }
    if (Array.isArray(x)) return x.map((y) => walk(y, field));
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, k)]));
    return x;
  };
  return walk(v) as T;
}
