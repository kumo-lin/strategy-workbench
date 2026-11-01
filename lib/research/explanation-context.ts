/** Server-only: read and project the report already selected by the page. No writes, model, or latest-version lookup. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { reportSchema, verdictSchema } from '@/lib/notes/schema';
import type { Vault, VaultNote } from '@/lib/vault';
import { assertResearchDir } from './folders';
import { keyQuestionLabel, keyQuestionVerdict } from './evidence';
import { reportPlanPath, reportClaimsMatch } from './report-plan';
import { explanationText } from './explanation-answer';
import { explanationChangesOf } from './interview-advice';
import type { ExplanationContext, ExplanationTarget } from './explanation-types';

// Validate only what this reader uses. In particular, the inner judgment's old verdict is NOT the current verdict.
const fileSchema = z.object({
  report: z.string(), source: z.enum(['run', 'body']).optional(),
  claims: z.array(z.object({
    claimId: z.string().regex(/^C\d+$/), label: z.string().regex(/^H[1-9]\d*(?:-\d+)?$/), verdict: verdictSchema,
    judgment: z.object({ gaps: z.array(z.string()).optional(), expert_questions: z.array(z.string()).optional() }).optional(),
  })).min(1),
  summary: z.object({ gaps: z.array(z.object({ question: z.string(), missing: z.string(), how: z.string() })).optional() }).optional(),
});
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const snapshotOf = (n: Pick<VaultNote, 'path' | 'data' | 'body'>) => JSON.stringify({ path: n.path, data: n.data, body: n.body });
const cleanList = (xs: string[]) => [...new Set(xs.map(explanationText).filter(Boolean))];

/** A report-level disclosure, not proof of which interview supports a particular claim. */
function provenance(body: string): ExplanationContext['interviewProvenance'] {
  const section = body.split('## 因为追加了访谈，结论变了什么').slice(1).pop()?.split(/^## /m)[0];
  const line = section?.split('\n').find((s) => s.startsWith('- 追加的访谈：'));
  if (!line) return 'unknown';
  const notes = [...line.matchAll(/\[\[[^\]]+\]\](（模拟访谈）|（真实访谈）)?/g)];
  if (!notes.length || notes.some((m) => !m[1])) return 'unknown';
  const flags = new Set(notes.map((m) => m[1]));
  return flags.size > 1 ? 'reported_mixed' : flags.has('（模拟访谈）') ? 'reported_simulated' : 'reported_real';
}

/** The interview hits the last follow-up saved next to the reports (none, or unreadable: nothing is said). */
async function savedHits(vault: Vault, dir: string): Promise<{ interview: string; claims: string[]; reason: string; says?: Record<string, string> }[]> {
  try {
    const raw = JSON.parse(await readFile(path.join(vault.root, dir, '访谈命中.json'), 'utf8')) as unknown;
    return Array.isArray(raw) ? raw.filter((h) => h && typeof h.interview === 'string' && Array.isArray(h.claims) && typeof h.reason === 'string') : [];
  } catch {
    return [];
  }
}

export async function loadExplanationContext(vault: Vault, selected: Pick<VaultNote, 'path' | 'data' | 'body'>): Promise<ExplanationContext> {
  const snapshot = snapshotOf(selected);
  const base = { identity: digest(snapshot), reportName: '报告', interviewProvenance: 'unknown' as const };
  const unavailable = (reason: NonNullable<ExplanationContext['unavailableReason']>): ExplanationContext => ({ ...base, state: 'unavailable', unavailableReason: reason, targets: [] });
  try {
    const dir = path.posix.dirname(selected.path);
    assertResearchDir(dir.split('/').slice(0, 3).join('/'), dir);
    const version = /^报告 v([1-9]\d*)\.md$/.exec(path.posix.basename(selected.path));
    if (!version) return unavailable('invalid');
    base.reportName = `报告 v${version[1]}`;
    const report = reportSchema.safeParse(selected.data);
    if (!report.success || report.data.version !== Number(version[1])) return unavailable('invalid');
    const full = path.join(vault.root, selected.path.replace(/\.md$/, '.judgment.json'));
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await readFile(full, 'utf8');
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return unavailable('invalid');
      const file = parsed.data;
      if (file.source === 'body') return unavailable('legacy');
      if (file.report !== path.posix.basename(selected.path) || new Set(file.claims.map((c) => c.claimId)).size !== file.claims.length || new Set(file.claims.map((c) => c.label)).size !== file.claims.length) return unavailable('invalid');
      const proposed = selected.data.verdicts_proposed;
      if (proposed !== undefined) {
        const v = z.record(z.string(), verdictSchema).safeParse(proposed);
        if (!v.success || Object.keys(v.data).length !== file.claims.length || file.claims.some((c) => v.data[c.claimId] !== c.verdict)) return unavailable('invalid');
      }
      const planPath = reportPlanPath(dir, report.data.research_plan);
      const plan = planPath ? await vault.read(planPath).catch(() => null) : null;
      const typed = plan?.note?.type === 'research_plan' ? plan.note : null;
      const mapped = typed && reportClaimsMatch(typed, file.claims) ? typed : null;
      // 复核 P3: what this version's interviews said about each judgment (only a version written by the interview follow-up)
      // only this version's own interviews: the hits file is rewritten on every round (review of P3)
      const own = (selected.data.interview_followup as { interviews?: unknown } | undefined)?.interviews;
      const ownNames = new Set((Array.isArray(own) ? own : []).map((l) => String(l).replace(/^\[\[|\]\]$/g, '').split('|').pop()!.split('/').pop()!.trim()));
      const hits = ownNames.size ? (await savedHits(vault, dir)).filter((h) => ownNames.has(h.interview)) : [];
      const saidAbout = (claimId: string) => cleanList(hits.filter((h) => h.claims.includes(claimId)).map((h) => `${h.interview}：${h.says?.[claimId] ?? h.reason}`));
      const targets: ExplanationTarget[] = file.claims.map((c, i) => ({
        id: `h-${i + 1}`, token: c.label, label: explanationText(`${c.label}${mapped ? ` ${mapped.claims.find((p) => p.id === c.claimId)!.statement}` : ''}`), kind: 'claim',
        verdict: c.verdict, verdictLabel: c.verdict, members: [],
        recordedGaps: cleanList(c.judgment?.gaps ?? []), recordedNextSteps: cleanList(c.judgment?.expert_questions ?? []),
        ...(saidAbout(c.claimId).length ? { interviewSaid: saidAbout(c.claimId).map(explanationText) } : {}),
      }));
      if (mapped) for (const key of [...new Set(mapped.claims.map((c) => c.key).filter((k) => k !== undefined))].sort()) {
        const ids = new Set(mapped.claims.filter((c) => c.key === key).map((c) => c.id));
        const members = file.claims.flatMap((c, i) => ids.has(c.claimId) ? [targets[i]] : []);
        // A partially investigated key cannot be aggregated as if all its hypotheses had a saved result.
        if (!members.length || members.length !== ids.size) continue;
        const gaps = (file.summary?.gaps ?? []).filter((g) => {
          const tokens = g.question.match(/K\d+(?![\dA-Za-z-])/g) ?? [];
          return tokens.length === 1 && tokens[0] === key;
        });
        const verdict = keyQuestionVerdict(members.map((m) => m.verdict));
        targets.push({
          id: `key-${key}`, token: key, label: key, kind: 'key', verdict, verdictLabel: keyQuestionLabel(verdict),
          members: members.map((m) => ({ label: m.token, verdictLabel: m.verdictLabel })),
          recordedGaps: cleanList([...gaps.map((g) => g.missing), ...members.flatMap((m) => m.recordedGaps.map((g) => `${m.token}：${g}`))]),
          recordedNextSteps: cleanList([...gaps.map((g) => g.how), ...members.flatMap((m) => m.recordedNextSteps.map((g) => `${m.token}：${g}`))]),
          ...(members.some((m) => m.interviewSaid?.length) ? { interviewSaid: cleanList(members.flatMap((m) => m.interviewSaid ?? [])) } : {}),
        });
      }
      const current = await vault.read(selected.path);
      if (snapshotOf(current) !== snapshot) return unavailable('updating');
      const planNow = plan ? await vault.read(plan.path).catch(() => null) : null;
      if (await readFile(full, 'utf8') !== raw || (plan && (!planNow || snapshotOf(planNow) !== snapshotOf(plan)))) continue;
      return {
        ...base, state: 'ready', targets, changes: explanationChangesOf(selected.body), interviewProvenance: provenance(selected.body),
        identity: digest(`${snapshot}\n${raw}\n${plan ? snapshotOf(plan) : ''}`),
        ...(!mapped ? { notice: '未能还原该版本的关键问题分组；这里只解释已有假设记录。' } : {}),
      };
    }
    return unavailable('updating');
  } catch (e) {
    return unavailable(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT' ? 'missing' : 'invalid');
  }
}
