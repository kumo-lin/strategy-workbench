import { loadExplanationContext } from '@/lib/research/explanation-context';
import { loadReportPlan } from '@/lib/research/report-plan';
import { readJudgmentFile } from '@/lib/research/judgment-file';
import type { ExplanationContext } from '@/lib/research/explanation-types';
import { StoredOutputs } from '@/components/research/stored-outputs';
import { loadStoredOutputs } from '@/lib/research/stored-outputs';
/** 一次调查：对话（grill）→ 计划（修改、批准）→ 执行 → 报告。 */
import type { EditablePlan } from '@/lib/research/plan-types';
import { changeTableOf, interviewAdviceOf, type InterviewAdvice } from '@/lib/research/interview-advice';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DecisionPanel } from '@/components/decision/decision-panel';
import { ReportReviewBox } from '@/components/workspace/report-review-box';
import { ReviewPanel } from '@/components/workspace/review-panel';
import { decisionsOfReport } from '@/lib/decisions/review';
import { ResearchWorkbench, type WorkbenchReport } from '@/components/research/research-workbench';
import { resolveReportCitations } from '@/lib/research/citations';
import { readHumanEdits } from '@/lib/report/human-edits';
import { readLengthFlags } from '@/lib/report/length-flags';
import { readCitationFlags, readEntityFlags, readSummaryFlags } from '@/lib/report/citation-flags';
import { readCitationVerify } from '@/lib/report/citation-verify';
import { readReviewNotes } from '@/lib/report/review-notes';
import { readSourceWarnings } from '@/lib/report/source-warnings';
import { assertResearchDir, latestVersion } from '@/lib/research/folders';
import { findJob, interruptedRun, jobKey } from '@/lib/research/job';
import { toEditable } from '@/lib/research/plan-types';
import { hypothesisLabel } from '@/lib/research/question-tree';
import { modelLine } from '@/lib/config/model-info';
import { defaultVersion, pinnedTeamReport, versionStatuses } from '@/lib/research/version-status';
import { getCurrentRole, roleTitle } from '@/lib/session/role';
import { loadPerspectives } from '@/lib/config/perspectives';
import { loadProjectOverview, originOf } from '@/lib/project/overview';
import { getVault } from '@/lib/vault';
import { reportReviewOf } from '@/lib/workplan/report-review';
import { buildReviewViews } from '@/lib/workplan/view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  return { title: await roleTitle(decodeURIComponent((await params).name)) };
}

/** What the first run of this report covered: a 试水调查 answers one hypothesis only (UI/UX 方案 #26). A follow-up's budget says nothing about the whole report. */
function scopeOf(data: Record<string, unknown>, plan: ReturnType<typeof toEditable> | null): { scope?: NonNullable<WorkbenchReport['scope']> } {
  if (data.follow_up) return {};
  const mode = data.run_mode;
  if (mode !== 'small' && mode !== 'full') return {};
  const ids = data.verdicts_proposed && typeof data.verdicts_proposed === 'object' ? Object.keys(data.verdicts_proposed) : [];
  const hypotheses = plan ? ids.filter((id) => plan.claims.some((c) => c.id === id)).map((id) => hypothesisLabel(plan, id)) : [];
  return { scope: { mode, hypotheses } };
}

/** C1: the report's one-line answer as the confirmation summary; footnote marks and bold stripped, cut to 300. */
function summaryDraftOf(body: string, reportName: string): string {
  const line = /^-\s*(?:一句话答案|回答（一句话）)[：:]\s*(.+)$/m.exec(body);
  const text = (line ? line[1] : `请确认这份报告：${reportName}`)
    .replace(/\[\^\d+\]/g, '')
    .replace(/\[Q\d+[^\]]*\]/g, '')
    .replace(/\*\*/g, '')
    .trim();
  return text.slice(0, 300);
}

/** The Workspaces that wait for this one on the issue tree (or, in the older table, share its branch): whoever investigates there next meets this decision (#19). */
async function nextUsersOf(vault: ReturnType<typeof getVault>, project: string, workspacePath: string): Promise<string[]> {
  const origin = originOf(await loadProjectOverview(vault, project), workspacePath);
  return (origin.dependents.length ? origin.dependents : origin.siblings).map((w) => `${w.name}（${w.owner}）`);
}

export default async function ResearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; workspace: string; name: string }>;
  searchParams: Promise<{ v?: string; step?: string }>;
}) {
  const [p, sp] = await Promise.all([params, searchParams]);
  const workspacePath = `20_项目/${decodeURIComponent(p.project)}/${decodeURIComponent(p.workspace)}`;
  const researchDir = `${workspacePath}/调查/${decodeURIComponent(p.name)}`;
  const vault = getVault();
  try {
    assertResearchDir(workspacePath, researchDir);
  } catch {
    notFound();
  }
  if (!(await vault.exists(`${workspacePath}/workspace.md`))) notFound();
  const [ws, role, planV] = await Promise.all([vault.readTyped(`${workspacePath}/workspace.md`, 'workspace'), getCurrentRole(), latestVersion(vault, researchDir, '计划')]);

  let plan = null;
  if (planV) {
    const n = await vault.readTyped(planV.path, 'research_plan');
    plan = {
      name: `计划 v${planV.n}`,
      path: planV.path,
      approved: Boolean(n.note.approved_at && n.note.approved_by_owner && n.note.status === '已确认'),
      exploratory: n.note.exploratory,
      editable: toEditable(n.note),
    };
  }

  // 内部资料清单 of a run that stopped after the vault: only when it belongs to the latest approved plan (else it is stale).

  const entries = await vault.list(researchDir).catch(() => []);
  const reportVersions = entries
    .flatMap((e) => {
      const m = /^报告 v(\d+)\.md$/.exec(e.name);
      return e.kind === 'file' && m ? [{ n: Number(m[1]), path: e.path, name: e.name.replace(/\.md$/, '') }] : [];
    })
    .sort((a, b) => b.n - a.n);
  const all = await Promise.all(reportVersions.map(async (r) => ({ path: r.path, n: r.n, ...(await vault.read(r.path).then((x) => ({ data: x.data, body: x.body }))) })));
  const wanted = sp.v ? reportVersions.find((r) => r.path === sp.v) : undefined;
  // by default the latest delivered version (a later draft stays in the list, labelled)
  const chosen = wanted ?? reportVersions.find((r) => r.path === defaultVersion(all)?.path);
  let report: WorkbenchReport | null = null;
  let explanationContext: ExplanationContext | null = null;
  let reportPlan: EditablePlan | null = null;
  if (chosen) {
    const n = await vault.read(chosen.path);
    explanationContext = await loadExplanationContext(vault, n);
    const judgments = await readJudgmentFile(vault, chosen.path).catch(() => null);
    const bound = judgments ? await loadReportPlan(vault, n, judgments.claims).catch(() => null) : null;
    reportPlan = bound ? toEditable(bound.plan) : null;
    // what each version is, in the list; at the top too for a stopped draft or an unconfirmed older-structure version (version-status.ts)
    const status = versionStatuses(all, (await pinnedTeamReport(vault, researchDir, reportVersions))?.path);
    report = {
      path: chosen.path,
      markdown: n.body,
      delivery: n.data.delivery === '草稿' ? '草稿' : '已交付',
      exploratory: n.data.exploratory === true,
      failedChecks: Array.isArray(n.data.failed_checks) ? (n.data.failed_checks as string[]) : [],
      humanEdits: readHumanEdits(n.data),
      sourceWarnings: readSourceWarnings(n.data),
      reviewNotes: readReviewNotes(n.data),
      lengthFlags: readLengthFlags(n.data),
      citationFlags: readCitationFlags(n.data),
      entityFlags: readEntityFlags(n.data),
      citationVerify: readCitationVerify(n.data),
      summaryFlags: readSummaryFlags(n.data),
      citations: await resolveReportCitations(vault, n.body, chosen.path),
      versions: reportVersions.map((r, i) => ({ name: r.name, path: r.path, label: [i === 0 ? '最新' : '', status.get(r.path)?.label ?? ''].filter(Boolean).join(' · ') || undefined })),
      ...(status.get(chosen.path)?.note ? { statusNote: status.get(chosen.path)!.label } : {}),
      ...scopeOf(n.data, plan?.editable ?? null),
    };
  }

  const info = chosen && report?.delivery === '已交付' ? await reportReviewOf(vault, workspacePath, chosen.path) : null;
  // M3: only a Senior sees "起草决定", and only on a delivered report. D-64 T41: it is step 6 (提交确认), and confirming
  // there also passes the report's open 结论 review.
  const decisions = chosen && role.kind === 'senior' && report?.delivery === '已交付' ? await decisionsOfReport(vault, `20_项目/${decodeURIComponent(p.project)}`, chosen.path) : null;
  const decisionSlot =
    chosen && decisions ? (
      <DecisionPanel
        workspacePath={workspacePath}
        researchDir={researchDir}
        reportPath={chosen.path}
        decisions={decisions}
        nextUsers={await nextUsersOf(vault, decodeURIComponent(p.project), workspacePath)}
        reviewPath={info?.state === 'open' && role.name === ws.note.reviewer ? info.reviewPath : null}
      />
    ) : undefined;
  // Top of the report: a Junior is told whose decision it is (#17); a Senior has step 6.
  const decisionTop =
    report?.delivery !== '已交付' || decisions ? undefined : (
      <span className="text-muted-foreground text-xs" data-testid="decision-note">
        决定 + 理由由 Senior 确认；你在这里能看，不能起草或确认。
      </span>
    );

  // C1: hand a delivered report to the Senior for confirmation, above the report.
  let reportReviewSlot: ReactNode = null;
  if (chosen && report && info) {
    const reviewer = ws.note.reviewer;
    let panel: ReactNode;
    if (info.state === 'open' && role.kind === 'senior' && role.name === reviewer) {
      const view = (await buildReviewViews(vault, workspacePath)).find((v) => v.path === info.reviewPath);
      if (view) {
        panel = (
          <ReviewPanel
            review={view}
            actorName={role.name}
            canComment={role.name !== view.requester}
            canDecide={role.kind === 'senior' && role.name === view.reviewer}
            targets={[]}
          />
        );
      }
    }
    reportReviewSlot = (
      <ReportReviewBox
        workspacePath={workspacePath}
        reportPath={chosen.path}
        reportName={chosen.name}
        owner={ws.note.owner}
        reviewer={reviewer}
        state={info.state}
        isOwner={role.name === ws.note.owner}
        canSubmit={chosen.path === reportVersions[0]?.path}
        summaryDraft={summaryDraftOf(report.markdown, chosen.name)}
        panel={panel}
      />
    );
  }

  // A run that died with the server leaves research:start as the last word in the log; a run still going has a job here.
  const interrupted = findJob(jobKey(workspacePath, researchDir)) ? null : interruptedRun(await vault.readLog(`${workspacePath}/日志.md`).catch(() => []), researchDir);

  const stored = chosen && info?.state === 'confirmed' ? await loadStoredOutputs(vault, workspacePath, chosen.path, `/workspace/${encodeURIComponent(p.project)}/${encodeURIComponent(p.workspace)}`) : [];
  const storedSlot = stored.length ? <StoredOutputs items={stored} canPublish={role.kind === 'senior'} /> : undefined;
  return (
    <ResearchWorkbench
      workspacePath={workspacePath}
      researchDir={researchDir}
      title={decodeURIComponent(p.name)}
      roleName={role.name}
      owner={ws.note.owner}
      stage={ws.note.stage}
      plan={plan}
      report={report}
      explanationContext={explanationContext}
      modelText={await modelLine(vault)}
      decisionSlot={decisionSlot}
      initialStep={
        sp.step === 'stored' ? (storedSlot ? 'stored' : undefined)
          : sp.step === 'confirm' ? (decisionSlot ? 'confirm' : undefined)
            : sp.step === 'plan' || sp.step === 'run' || sp.step === 'report' || sp.step === 'interview' || sp.step === 'reanalysis' ? sp.step
              : undefined
      }
      storedSlot={storedSlot}
      decisionTop={decisionTop}
      reportReviewSlot={reportReviewSlot}
      interrupted={interrupted}
      perspectives={await loadPerspectives(vault)}
      interviewAdvice={adviceOf(report?.markdown, reportPlan)}
      reportChanges={report ? changeTableOf(report.markdown) : null}
    />
  );
}

/** D-64 T40: step 4 of the page — the report's interview advice, each ask with its hypothesis; null when there is none. */
function adviceOf(body: string | undefined, plan: EditablePlan | null): InterviewAdvice | null {
  if (!body) return null;
  const hypotheses = Object.fromEntries((plan?.claims ?? []).map((c) => [hypothesisLabel(plan!, c.id), c.statement]));
  const a = interviewAdviceOf(body, hypotheses);
  return a.rows.length || a.gaps.length ? a : null;
}
