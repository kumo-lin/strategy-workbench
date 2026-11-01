/**
 * D-64 T16: what the next piece of research must take as given, and what it must take as direction.
 *   - 已确认的研究结论（当作前提）: the So what of every report the project confirmed (and of the reports other
 *     projects published as company assets), with the confirmed decisions drafted from them;
 *   - 负责人的意见（当方向用，不当证据用）: this Workspace's review comments and the reasons of the people's edits
 *     to its reports (`human_edits[].basis`).
 * Shared by the research context and the workplan context. Only reads the vault.
 */
import path from 'node:path';
import type { Vault } from '@/lib/vault';
import { listReviews } from '@/lib/workplan/state';
import { confirmedReports } from './confirmed-reports';
import { readJudgmentFile } from './judgment-file';

export interface Conclusion {
  reportPath: string;
  /** `<Workspace> · <调查> · 报告 v2`, or the other project's name for a published asset. */
  label: string;
  soWhat: string;
  decisions: string[];
}

export interface Opinion {
  who: string;
  date: string;
  text: string;
}

export const CONCLUSIONS_HEADING = '## 已确认的研究结论（当作前提）';
export const OPINIONS_HEADING = '## 负责人的意见（当方向用，不当证据用）';

async function listDir(vault: Vault, dir: string) {
  try {
    return await vault.list(dir);
  } catch {
    return [];
  }
}

/** The first paragraph of a markdown section (`## Summary`, `## 决定`), or ''. */
function firstParagraph(body: string, heading: string): string {
  const at = body.split(/\r?\n/).findIndex((l) => l.trim() === heading);
  if (at < 0) return '';
  const rest = body.split(/\r?\n/).slice(at + 1);
  const out: string[] = [];
  for (const line of rest) {
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.trim()) {
      if (out.length) break;
      continue;
    }
    out.push(line.trim());
  }
  return out.join(' ');
}

/** So what: `.judgment.json`'s summary; an older report without it, the first paragraph of its Summary. */
async function soWhatOf(vault: Vault, reportPath: string): Promise<string> {
  const file = await readJudgmentFile(vault, reportPath).catch(() => null);
  const s = file?.summary?.so_what;
  if (typeof s === 'string' && s.trim()) return s.trim();
  try {
    return firstParagraph((await vault.read(reportPath)).body, '## Summary');
  } catch {
    return '';
  }
}

/** The confirmed decisions of `projectPath` whose trigger is `reportPath`, by their 决定 section. */
async function decisionsFrom(vault: Vault, projectPath: string, reportPath: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await listDir(vault, `${projectPath}/决策`)) {
    if (e.kind !== 'file') continue;
    const n = await vault.read(e.path).catch(() => null);
    if (n?.note?.type !== 'decision' || n.note.status !== '已确认') continue;
    const r = await vault.resolveLink(n.note.trigger, e.path);
    if (!r.ok || r.path !== reportPath) continue;
    out.push(firstParagraph(n.body, '## 决定') || n.note.reason);
  }
  return out;
}

export async function confirmedConclusions(vault: Vault, workspacePath: string): Promise<Conclusion[]> {
  const projectPath = path.posix.dirname(workspacePath);
  const out: Conclusion[] = [];
  for (const r of await confirmedReports(vault, workspacePath)) {
    out.push({
      reportPath: r.reportPath,
      label: `${r.workspace} · ${r.investigation} · ${r.reportName}`,
      soWhat: await soWhatOf(vault, r.reportPath),
      decisions: await decisionsFrom(vault, projectPath, r.reportPath),
    });
  }
  // company assets: reports another project published (its unpublished ones never show)
  for (const project of await listDir(vault, '20_项目')) {
    if (project.kind !== 'dir' || project.path === projectPath) continue;
    for (const h of await vault.search({ dir: project.path, types: ['report'], limit: 500 })) {
      if (typeof h.data.published_by !== 'string' || !h.data.published_by) continue;
      out.push({ reportPath: h.path, label: `${project.name}（公司资产）· ${h.title}`, soWhat: await soWhatOf(vault, h.path), decisions: await decisionsFrom(vault, project.path, h.path) });
    }
  }
  return out;
}

export async function ownerOpinions(vault: Vault, workspacePath: string): Promise<Opinion[]> {
  const out: Opinion[] = [];
  for (const review of await listReviews(vault, workspacePath)) {
    for (const c of review.comments) out.push({ who: c.author || review.note.reviewer, date: review.note.updated.slice(0, 10), text: c.text });
  }
  for (const inv of await listDir(vault, `${workspacePath}/调查`)) {
    if (inv.kind !== 'dir') continue;
    for (const e of await listDir(vault, inv.path)) {
      if (e.kind !== 'file' || !/^报告 v\d+\.md$/.test(e.name)) continue;
      const n = await vault.read(e.path).catch(() => null);
      const edits = n?.data.human_edits;
      if (!Array.isArray(edits)) continue;
      for (const ed of edits as Record<string, unknown>[]) {
        if (typeof ed?.basis === 'string' && ed.basis.trim()) out.push({ who: String(n!.data.author ?? ''), date: String(ed.date ?? n!.data.updated ?? '').slice(0, 10), text: ed.basis.trim() });
      }
    }
  }
  return out;
}

/** The two sections, ready for a prompt. */
export function renderPremises(conclusions: Conclusion[], opinions: Opinion[]): string {
  const c = conclusions.length
    ? conclusions
        .map((x) => [`- ${x.label}：${x.soWhat || '（报告没有 So what）'}`, ...x.decisions.map((d) => `  - 对应的决定：${d}`)].join('\n'))
        .join('\n')
    : '（无）';
  const o = opinions.length ? opinions.map((x) => `- ${x.who}${x.date ? `（${x.date}）` : ''}：${x.text}`).join('\n') : '（无）';
  return `${CONCLUSIONS_HEADING}\n${c}\n\n${OPINIONS_HEADING}\n${o}`;
}
