'use client';

/**
 * One investigation: chat (grill + plan) on the left; plan / run / report on the right.
 * The chat uses M1's ChatTimeline; the run is streamed from /api/research/execute and shown
 * with the same tool cards plus the 9 steps.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type JSX, type MutableRefObject, type ReactNode } from 'react';
import { chatStorageKey, loadChat, saveChat } from '@/lib/research/chat-store';
import { ASK_USER_NUDGE } from '@/components/chat/chat-state';
import { ChatTimeline } from '@/components/chat/chat-timeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ExplanationContext } from '@/lib/research/explanation-types';
import type { InterviewAdvice } from '@/lib/research/interview-advice';
import { ConfirmStep } from './confirm-step';
import { InterviewAdvicePanel, ReanalysisPanel } from './interview-steps';
import { Textarea } from '@/components/ui/textarea';
import { ReadOnlyNotice } from '@/components/shell/readonly-notice';
import { WindowLink } from '@/components/shell/window-link';
import type { CitationDetail } from '@/lib/research/citation-types';
import type { EditablePlan } from '@/lib/research/plan-types';
import type { ResearchUIMessage } from '@/lib/research/progress';
import type { ResearchMode } from '@/lib/research/constants';
import { messageToNudge } from './chat-nudge';
import { lastResultOf, latestRun } from './run-tab';
import { FollowUpDialog } from './follow-up-dialog';
import { RunDialog } from './run-dialog';
import { PlanEditor } from './plan-editor';
import type { LengthFlag } from '@/lib/report/length-flags';
import type { CitationFlag, EntityFlagShown, SummaryFlag } from '@/lib/report/citation-flags';
import type { VerifyItem } from '@/lib/report/citation-verify';
import { ReportViewer, type ReportVersion } from './report-viewer';
import type { HumanEdit } from '@/lib/report/human-edits';
import type { ReportReviewNote } from '@/lib/report/review-notes';
import type { SourceWarning } from '@/lib/report/source-warnings';
import { groupRun } from './run-groups';
import { RunView } from './run-view';
import { MODE_NAME, MODE_TIME } from '@/lib/research/mode-copy';
import { hypothesisLabel, treeOrder } from '@/lib/research/question-tree';

export interface WorkbenchPlan {
  name: string;
  path: string;
  approved: boolean;
  exploratory: boolean;
  editable: EditablePlan;
}
export interface WorkbenchReport {
  path: string;
  markdown: string;
  delivery: '已交付' | '草稿';
  exploratory: boolean;
  failedChecks: string[];
  humanEdits: HumanEdit[];
  sourceWarnings: SourceWarning[];
  reviewNotes?: ReportReviewNote[];
  lengthFlags?: LengthFlag[];
  citationFlags?: CitationFlag[];
  entityFlags?: EntityFlagShown[];
  /** The report's citation_verify (D-56 ⑦): the three-check result shown beside each footnote. */
  citationVerify?: VerifyItem[];
  summaryFlags?: SummaryFlag[];
  citations: Record<string, CitationDetail>;
  versions: ReportVersion[];
  /** This version's status note (an unconfirmed older-structure version), shown at the top of the report. */
  statusNote?: string;
  /** How far the first run went (frontmatter `run_mode` and the hypotheses it judged); not set for a follow-up. */
  scope?: { mode: ResearchMode; hypotheses: string[] };
}
export interface ResearchWorkbenchProps {
  workspacePath: string;
  researchDir: string;
  title: string;
  roleName: string;
  owner: string;
  stage: string;
  plan: WorkbenchPlan | null;
  report: WorkbenchReport | null;
  /** The model the config points at right now, e.g. `DeepSeek V4.1-Flash（deepseek-flash）` (M4 4.3). */
  modelText: string;
  /** M3: Senior 专用的"起草决定"面板；别的角色不传。D-64 T41: it is step 6 (提交确认), next to the report's summary. */
  decisionSlot?: ReactNode;
  /** D-64 T41: the step the page opens on (`?step=confirm` from the inbox). */
  initialStep?: 'plan' | 'run' | 'report' | 'interview' | 'reanalysis' | 'confirm' | 'stored';
  storedSlot?: ReactNode;
  /** The shortcut to it at the top of the report (Senior), or the note that the decision is Senior's (a Junior). */
  decisionTop?: ReactNode;
  /** The log says a run started and never ended, and no run is going on the server (it died with the process). */
  interrupted?: { startedAt: string } | null;
  /** The perspectives the team requires a plan to cover (90_配置/团队.md). */
  perspectives?: string[];
  /** C1: the report's Senior-confirmation box, at the top of the report tab. */
  reportReviewSlot?: ReactNode;
  /** D-64 T40: step 4 — the interview advice read from the report (null: the report has none). */
  interviewAdvice?: InterviewAdvice | null;
  /** D-64 T40: step 5 — the change table of a version the interviews produced (null: none yet). */
  reportChanges?: string[][] | null;
  explanationContext?: ExplanationContext | null;
}

async function post(url: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(json.error ?? `HTTP ${res.status}`) };
    return { ok: true, json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 复核 P7: the chat on the left follows the step the right side shows (it said 调查计划 on every step). */
const CHAT_TITLE: Record<string, string> = { plan: '调查计划', run: '调查执行', report: '调查报告', interview: '访谈建议' };

/** 复核 P10: the change table compares the version before this one with this one (v2 and v3 after a second round). */
function changeHeadsOf(name: string | undefined): [string, string] | undefined {
  const n = Number(/v(\d+)$/.exec(name ?? '')?.[1]);
  return n > 1 ? [`v${n - 1}`, `v${n}`] : undefined;
}

function ChatPanel({ workspacePath, researchDir, roleName, locked }: { workspacePath: string; researchDir: string; roleName: string; locked: boolean }): JSX.Element {
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/agent', body: { workspacePath, track: 'research', researchDir } }), [workspacePath, researchDir]);
  const { messages, sendMessage, addToolOutput, status, error, setMessages } = useChat({ transport, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls });
  const [text, setText] = useState('');
  // The grill Q&A survives a refresh (per browser; the plan and the log are the durable record).
  const key = chatStorageKey(roleName, researchDir);
  useEffect(() => {
    setMessages(loadChat(window.localStorage, key));
  }, [key, setMessages]);
  useEffect(() => {
    saveChat(window.localStorage, key, messages as UIMessage[], status);
  }, [messages, status, key]);
  const busy = status === 'submitted' || status === 'streaming';
  // A question written in the text instead of an ask_user card: ask the model, once, to resend it as a card.
  const wasBusy = useRef(false);
  const nudged = useRef(new Set<string>());
  useEffect(() => {
    const id = messageToNudge({ wasBusy: wasBusy.current, status, messages: messages as UIMessage[], nudged: nudged.current });
    wasBusy.current = status === 'submitted' || status === 'streaming';
    if (id) void sendMessage({ text: ASK_USER_NUDGE, metadata: { actor: '系统' } });
  }, [status, messages, sendMessage]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="research-chat">
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <ChatTimeline
          messages={messages as UIMessage[]}
          status={status}
          actorName={roleName}
          canAnswer={!busy}
          onAnswer={(id, output) => void addToolOutput({ tool: 'ask_user', toolCallId: id, output })}
          emptyHint={<p className="text-muted-foreground p-4 text-sm">告诉 AI 你想调查什么。它会先问清楚三件事：调查什么、为什么、怎么拆成子问题，再起草按问题树组织的调查计划：每个子问题一个假设，每个假设一份验证计划。{locked ? '' : ''}</p>}
        />
      </div>
      {error && <p className="text-destructive px-3 text-xs">{error.message}</p>}
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !busy) {
            void sendMessage({ text });
            setText('');
          }
        }}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line (not while an IME is composing).
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2} placeholder="说说你想调查什么…" aria-label="给 AI 的消息" disabled={busy} className="min-h-0 resize-none" />
        <Button type="submit" disabled={busy || !text.trim()}>
          发送
        </Button>
      </form>
    </div>
  );
}

/** Why the research tools are off before the plan is approved, and what the AI can do meanwhile (UI/UX 方案 #12). */
function ToolsLockedCard(): JSX.Element {
  return (
    <div role="note" data-testid="tools-locked" className="border-b bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
      <p className="font-medium">调查工具还没开放</p>
      <p className="text-muted-foreground text-xs">联网搜索、读网页要等这份计划批准后，系统才放开。现在 AI 只能帮你改计划。</p>
      <details className="text-muted-foreground mt-1 text-xs">
        <summary className="cursor-pointer">为什么这样设计</summary>
        <p className="mt-1">开不开放由系统按计划有没有批准来决定，不是写在提示词里让 AI 自觉遵守：计划没批准时，这些工具根本不会交给 AI，它想用也用不了。</p>
      </details>
    </div>
  );
}

/** Start a run: a follow-up (its claim and question), or the plan's run in the mode given (else the picker's). */
type StartRun = (followUp?: { claimId: string; question: string; budget?: 'small' | 'full' }, mode?: ResearchMode) => void;

function RunPanel({
  workspacePath,
  researchDir,
  roleName,
  canRun,
  approved,
  ownerName,
  planName,
  firstHypothesis,
  lastRunMode,
  hasReport,
  onViewReport,
  startRef,
  onFinished,
  onRunningChange,
  interrupted,
}: {
  workspacePath: string;
  researchDir: string;
  roleName: string;
  canRun: boolean;
  approved: boolean;
  ownerName: string;
  /** "计划 v2" and the first hypothesis of its tree (what a 试水调查 covers), for the progress header. */
  planName: string;
  firstHypothesis: string;
  /** How the report on the page was run (a 试水调查 offers "跑完整调查…"); null = no first-run report. */
  lastRunMode: ResearchMode | null;
  hasReport: boolean;
  /** "查看报告 v5": the workbench opens the newest report. */
  onViewReport: () => void;
  /** The workbench calls this when the owner approves the plan: approving IS starting. */
  startRef: MutableRefObject<StartRun | null>;
  onFinished: (run: { replay: boolean }) => void;
  /** The workbench shows the run's state on the step bar. */
  onRunningChange: (running: boolean) => void;
  /** The log says a run started and never ended, and no run is going on the server. */
  interrupted: { startedAt: string } | null;
}): JSX.Element {
  // The run is a background job on the server: after a refresh or a dropped connection the chat re-attaches to it
  // (GET replays the steps so far and follows the rest) — the run itself never depended on this page.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/research/execute',
        body: { workspacePath, researchDir },
        prepareReconnectToStreamRequest: () => ({ api: `/api/research/execute?${new URLSearchParams({ workspacePath, researchDir })}` }),
      }),
    [workspacePath, researchDir],
  );
  // a replay of a run that had already ended (reconnecting after a refresh) is not "the run just finished"
  const replayRef = useRef(false);
  const { messages, sendMessage, status, error } = useChat<ResearchUIMessage>({
    transport,
    resume: true,
    onData: (part) => {
      if (part.type === 'data-attach') replayRef.current = part.data.replay;
    },
  });
  const running = status === 'submitted' || status === 'streaming';
  useEffect(() => {
    onRunningChange(running);
  }, [running, onRunningChange]);
  // a run ends only after this page has seen it running: right after "开始调查" the chat is still "ready" with the last
  // run's messages, which once read as "the run just finished" and moved the page to that run's report
  const sawRunningRef = useRef(false);
  useEffect(() => {
    if (running) sawRunningRef.current = true;
  }, [running]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const finishedRef = useRef(false);
  /** The mode of the run this page started (a re-attached run says its own in `data-job`). */
  const [startedMode, setStartedMode] = useState<ResearchMode | null>(null);
  const [startedFollowUp, setStartedFollowUp] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<ResearchMode>('small');

  const start: StartRun = (followUp, picked) => {
    finishedRef.current = false;
    setStartedMode(followUp ? (followUp.budget ?? 'small') : (picked ?? 'small'));
    setStartedFollowUp(Boolean(followUp));
    replayRef.current = false;
    sawRunningRef.current = false;
    setStartedAt(Date.now());
    setElapsed(0);
    // 追加调查 goes to the same endpoint; the body says which claim and what to look at. The mode chosen in the dialog
    // (the only place it is chosen) goes in the request itself: nothing is kept on the page that a reload could reset.
    // D-64 T22 (D2): one run — the library first, then the web for what has a gap; it never stops to ask
    void sendMessage({ text: followUp ? '追加调查' : '开始执行' }, followUp ? { body: { followUp } } : { body: { mode: picked ?? 'small' } });
  };
  useEffect(() => {
    startRef.current = (followUp, picked) => {
      if (!running) start(followUp, picked);
    };
    return () => {
      startRef.current = null;
    };
  });
  // this run's messages only: an earlier run's steps and result stay out of its progress
  const current = latestRun(messages);
  // A re-attached run: its clock started on the server.
  const jobStart = current.flatMap((m) => m.parts).find((p) => p.type === 'data-job');
  const clockStart = startedAt ?? (jobStart && jobStart.type === 'data-job' ? jobStart.data.startedAt : null);
  const runMode: ResearchMode = (jobStart && jobStart.type === 'data-job' ? jobStart.data.mode : undefined) ?? startedMode ?? lastRunMode ?? 'small';
  const { groups, steps, cards } = groupRun(current);
  const r = lastResultOf(current.flatMap((m) => m.parts));
  useEffect(() => {
    if (!running || clockStart === null) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - clockStart) / 1000)), 500);
    return () => clearInterval(t);
  }, [running, clockStart]);
  useEffect(() => {
    if (status === 'ready' && sawRunningRef.current && clockStart !== null && !finishedRef.current && messages.length > 0) {
      finishedRef.current = true;
      sawRunningRef.current = false;
      setElapsed(Math.round((Date.now() - clockStart) / 1000));
      onFinished({ replay: replayRef.current });
    }
  }, [status, clockStart, messages.length, onFinished]);

  return (
    <div className="space-y-3 p-3" data-testid="research-run">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="run-start"
          disabled={!canRun || running}
          onClick={() => {
            setDialogMode(lastRunMode === 'small' ? 'full' : (lastRunMode ?? 'small'));
            setDialogOpen(true);
          }}
        >
          {running ? '执行中…' : !hasReport && !r ? '开始调查…' : lastRunMode === 'small' ? '跑完整调查…' : '再跑一次调查…'}
        </Button>
        {clockStart !== null && <span className="sr-only" data-testid="run-elapsed">用时 {elapsed} 秒</span>}
        {!approved && <span className="text-muted-foreground text-xs">先在“调查计划”里批准计划：批准就是开始。</span>}
      </div>
      {approved && !canRun && (
        <ReadOnlyNotice
          cannot="只读：你不能在这里开始调查。"
          who={`${ownerName}（负责人）才能开始或重跑调查。`}
          can={`看进度和工具卡片；调查跑完后，你可以在“报告”里读结果（现在你是 ${roleName}）。`}
          where={<WindowLink roleName={ownerName} />}
        />
      )}
      {interrupted && !running && messages.length === 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="run-interrupted">
          上一次执行在 {interrupted.startedAt} 开始，没有跑完（服务重启或出错），没有生成新的报告。已经查到的资料留在资料库里，可以重新开始调查。
        </p>
      )}
      {error && <p className="text-destructive text-xs">{error.message}</p>}
      {r && !running && (
        <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="run-result">
          <p className="font-medium">
            {r.delivered ? `✓ ${String(r.reportName ?? '报告')} 已交付 · 引用已自检` : `报告未交付：${(r.failedChecks as string[]).join('；')}`}
            {' · '}用时 {Math.floor(Number(r.durationMs) / 60000)} 分 {Math.round(Number(r.durationMs) / 1000) % 60} 秒
          </p>
          {!startedFollowUp && runMode === 'small' ? <p data-testid="run-scope-note">这次只查了 {firstHypothesis}，其余假设本次没有查。</p> : null}
          <p className="text-muted-foreground text-xs">
            {r.model ? <span data-testid="run-model" title={(r.model as { model: string }).model}>模型 {(r.model as { label: string }).label} · </span> : null}搜索 {String((r.usage as { searches: number }).searches)} 次 · 抓取 {String((r.usage as { fetches: number }).fetches)} 次
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" data-testid="run-view-report" onClick={onViewReport}>
              查看{String(r.reportName ?? '报告')} →
            </Button>
          </div>
        </div>
      )}
      <RunView
        groups={groups}
        steps={steps}
        cards={cards}
        running={running}
        elapsedSec={clockStart === null ? undefined : elapsed}
        modeName={startedFollowUp ? `追加调查（${MODE_NAME[runMode]}预算）` : MODE_NAME[runMode]}
        scope={startedFollowUp ? '只查新加的那个子问题' : runMode === 'small' ? `只查 ${firstHypothesis}` : '查全部假设'}
        planName={planName}
        usual={MODE_TIME[runMode]}
      />
      <RunDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={hasReport || r ? '用这份已批准的计划再跑一次调查？' : `开始调查：${planName}`}
        description={`${planName} 已经批准，不需要再批准：选好范围，点确认就开跑。`}
        mode={dialogMode}
        onModeChange={setDialogMode}
        firstHypothesis={firstHypothesis}
        happensTitle="点了确认会发生："
        happens={(usual) => [`马上按 ${planName} 开跑（${usual}），页面停在“执行”，每一步都看得到；你可以走开，关掉页面也不会停。`, '跑完生成新的报告版本，旧报告保留，可以切版本对照。', '不会替你跳到报告页：跑完这里出现“查看报告”。']}
        confirmLabel={(name) => `开始${name}`}
        onConfirm={() => start(undefined, dialogMode)}
      />
    </div>
  );
}

export function ResearchWorkbench(props: ResearchWorkbenchProps): JSX.Element {
  const { workspacePath, researchDir, plan, report, roleName, owner } = props;
  const router = useRouter();
  const isOwner = roleName === owner;
  const approved = Boolean(plan?.approved);
  const [tab, setTab] = useState<string>(props.initialStep ?? (report ? 'report' : 'plan'));
  const [reportView, setReportView] = useState<string | null>(null);
  const startRef = useRef<StartRun | null>(null);
  /** The version just saved: its editor is a new one (key = path), and says "已保存为 …" itself. */
  const [savedName, setSavedName] = useState<string | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [running, setRunning] = useState(false);
  /** "查看报告": the newest version, not one picked earlier (?v=…), on the report step. */
  const viewNewestReport = () => {
    if (reportView || new URLSearchParams(window.location.search).has('v')) {
      setReportView(null);
      router.replace(window.location.pathname);
    } else router.refresh();
    setTab('report');
  };

  // each step says its state (UI/UX 方案 #10); the numbers are the Workspace flow's steps 4–6
  const planStatus = !plan ? '未起草' : approved ? `${plan.name} · 已批准` : isOwner ? `${plan.name} · 草稿 · 轮到你` : `${plan.name} · 草稿 · 等 ${owner}`;
  const runStatus = running ? '进行中' : !approved ? '等计划批准' : report ? '已跑过' : isOwner ? '未开始 · 轮到你' : `未开始 · 等 ${owner}`;
  const reportStatus = running ? '生成中…' : report ? `${report.versions.find((v) => v.path === report.path)?.name.replace('报告 ', '') ?? ''} ${report.delivery}`.trim() : '未生成';

  // steps 5–7 have their own content (追加分析's panel, 提交确认's summary and decision, the stored outputs): the plan's chat
  // would only take half the width from them
  const noPlanChat = tab === 'reanalysis' || tab === 'confirm' || tab === 'stored';
  return (
    <div
      className={`grid h-[calc(100vh-16rem)] min-h-[30rem] gap-3 p-3 ${noPlanChat ? 'lg:grid-cols-1' : tab === 'report' ? 'lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]' : 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'}`}
    >
      <section hidden={noPlanChat} className={`${noPlanChat ? 'hidden' : 'flex'} min-h-0 flex-col rounded-lg border`} aria-label="对话">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b p-2">
          <h1 className="truncate text-sm font-semibold">
            和 AI 讨论 · {CHAT_TITLE[tab] ?? '调查计划'}<span className="text-muted-foreground font-normal"> · {props.title}</span>
          </h1>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" data-testid="model-badge">模型：{props.modelText}</Badge>
            {approved ? <Badge variant="outline">计划已批准 · 调查工具已开放</Badge> : null}
            {plan?.exploratory && <StatusBadge status="探索性" />}
          </span>
        </header>
        {approved ? null : <ToolsLockedCard />}
        <div className="min-h-0 flex-1">
          <ChatPanel workspacePath={workspacePath} researchDir={researchDir} roleName={roleName} locked={!approved} />
        </div>
      </section>
      <section className="flex min-h-0 min-w-0 flex-col rounded-lg border" aria-label="计划、执行和报告">
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="m-2 h-auto max-w-[calc(100%-1rem)] shrink-0 flex-nowrap justify-start self-start overflow-x-auto" data-testid="step-bar">
            <TabsTrigger value="plan" className="flex-col items-start gap-0 px-3 py-1" data-testid="step-plan">
              <span>第 2 步 · 调查计划</span>
              <span className="text-muted-foreground text-[11px] font-normal">{planStatus}</span>
            </TabsTrigger>
            <TabsTrigger value="run" className="flex-col items-start gap-0 px-3 py-1" data-testid="step-run">
              <span>第 3 步 · 执行</span>
              <span className="text-muted-foreground text-[11px] font-normal">{runStatus}</span>
            </TabsTrigger>
            <TabsTrigger value="report" className="flex-col items-start gap-0 px-3 py-1" data-testid="step-report">
              <span>第 3 步 · 报告</span>
              <span className="text-muted-foreground text-[11px] font-normal">{reportStatus}</span>
            </TabsTrigger>
            {report && props.interviewAdvice ? (
              <TabsTrigger value="interview" className="flex-col items-start gap-0 px-3 py-1" data-testid="step-interview">
                <span>第 4 步 · 访谈建议</span>
                <span className="text-muted-foreground text-[11px] font-normal">{props.interviewAdvice.groups.length} 位</span>
              </TabsTrigger>
            ) : null}
            {report ? (
              <TabsTrigger value="reanalysis" className="flex-col items-start gap-0 px-3 py-1" data-testid="step-reanalysis">
                <span>第 5 步 · 追加分析</span>
                <span className="text-muted-foreground text-[11px] font-normal">{props.reportChanges ? '已追加' : '未开始'}</span>
              </TabsTrigger>
            ) : null}
            {report && props.decisionSlot ? (
              <TabsTrigger value="confirm" className="flex-col items-start gap-0 px-3 py-1" data-testid="step-confirm">
                <span>第 6 步 · 提交确认</span>
                <span className="text-muted-foreground text-[11px] font-normal">决定 + 理由</span>
              </TabsTrigger>
            ) : null}
          {props.storedSlot ? <TabsTrigger value="stored" data-testid="step-stored">第 7 步 · 存入项目文件</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="plan" forceMount className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3 data-[state=inactive]:hidden">
            {plan ? (
              <PlanEditor
                key={plan.path}
                plan={plan.editable}
                planName={plan.name}
                approved={plan.approved}
                canEdit={isOwner}
                perspectives={props.perspectives}
                ownerName={owner}
                savedNotice={savedName === plan.name ? `已保存为 ${plan.name}` : undefined}
                onSave={async (next) => {
                  const r = await post('/api/research/plan', { workspacePath, researchDir, plan: next });
                  if (!r.ok) return r;
                  setSavedName(String(r.json.name));
                  router.refresh();
                  return { ok: true as const, name: String(r.json.name) };
                }}
                onApprove={async (picked) => {
                  // `picked` is what the approve dialog showed: that is the run that starts
                  const r = await post('/api/research/approve', { workspacePath, researchDir, plan: plan.path });
                  if (!r.ok) return r;
                  router.refresh();
                  setTab('run');
                  startRef.current?.(undefined, picked); // approving the plan starts the run
                  return { ok: true as const };
                }}
              />
            ) : (
              <p className="text-muted-foreground p-4 text-sm">还没有调查计划。在左边和 AI 对话：先回答它的几个问题，它会起草 计划 v1。</p>
            )}
          </TabsContent>
          <TabsContent value="run" forceMount className="relative min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
            <RunPanel
              workspacePath={workspacePath}
              researchDir={researchDir}
              roleName={roleName}
              canRun={approved && isOwner}
              approved={approved}
              ownerName={owner}
              planName={plan?.name ?? '计划'}
              firstHypothesis={plan ? hypothesisLabel(plan.editable, treeOrder(plan.editable)[0] ?? plan.editable.claims[0]?.id ?? '') : 'H1'}
              lastRunMode={report?.scope?.mode ?? null}
              hasReport={Boolean(report)}
              onViewReport={viewNewestReport}
              startRef={startRef}
              interrupted={props.interrupted ?? null}
              onRunningChange={setRunning}
              onFinished={() => router.refresh()} // the page does not move: the run's result says it is done, with a button
            />
          </TabsContent>
          <TabsContent value="report" className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {report ? props.reportReviewSlot : null}
            {running && report ? (
              <p role="status" data-testid="report-generating" className="m-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                新的报告正在生成：跑完后到“执行”点“查看报告”。下面先显示上一版（{report.versions.find((v) => v.path === report.path)?.name ?? '上一版'}），仅供参考。
              </p>
            ) : null}
            {report ? (
              <ReportViewer
                markdown={report.markdown}
                citations={report.citations}
                versions={report.versions}
                currentVersion={reportView ?? report.path}
                onSelectVersion={(path) => {
                  setReportView(path);
                  router.push(`?v=${encodeURIComponent(path)}`);
                }}
                exploratory={report.exploratory}
                delivery={report.delivery}
                failedChecks={report.failedChecks}
                humanEdits={report.humanEdits}
                sourceWarnings={report.sourceWarnings}
                reviewNotes={report.reviewNotes}
                lengthFlags={report.lengthFlags}
                citationFlags={report.citationFlags}
                entityFlags={report.entityFlags}
                citationVerify={report.citationVerify}
                summaryFlags={report.summaryFlags}
                statusNote={report.statusNote}
                scope={report.scope}
                decisionTop={props.decisionTop}
                // 追加调查: the owner, on the latest delivered report, with an approved plan
                onFollowUp={isOwner && approved && report.delivery === '已交付' && report.path === report.versions[0]?.path ? () => setFollowUpOpen(true) : undefined}
                onNextStep={props.interviewAdvice ? () => setTab('interview') : undefined}
              />
            ) : (
              <p className="text-muted-foreground p-4 text-sm">{running ? '报告正在生成：跑完后到“执行”点“查看报告”。' : '报告在调查执行完、引用自检通过之后出现在这里。'}</p>
            )}
          </TabsContent>
          {report && props.interviewAdvice ? (
            <TabsContent value="interview" className="relative min-h-0 flex-1 overflow-y-auto">
              <InterviewAdvicePanel advice={props.interviewAdvice} title={props.title} onNext={() => setTab('reanalysis')} />
            </TabsContent>
          ) : null}
          {report ? (
            <TabsContent value="reanalysis" className="@container relative min-h-0 flex-1 overflow-y-auto">
              <ReanalysisPanel
                workspacePath={workspacePath}
                researchDir={researchDir}
                canUpload={isOwner && approved}
                reportName={report.versions.find((v) => v.path === report.path)?.name ?? null}
                changes={props.reportChanges ?? null}
                explanationContext={props.explanationContext ?? null}
                reportMarkdown={report.markdown}
                changeHeads={changeHeadsOf(report.versions.find((v) => v.path === report.path)?.name)}
                submitSlot={props.reportReviewSlot}
              />
            </TabsContent>
          ) : null}
          {report && props.decisionSlot ? (
            <TabsContent value="confirm" forceMount className="relative min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
              <ConfirmStep markdown={report.markdown} reportName={report.versions.find((v) => v.path === report.path)?.name ?? '报告'}>
                {props.decisionSlot}
              </ConfirmStep>
            </TabsContent>
          ) : null}
        {props.storedSlot ? <TabsContent value="stored" forceMount className="relative min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">{props.storedSlot}</TabsContent> : null}
        </Tabs>
      </section>
      {plan && report ? (
        <FollowUpDialog
          open={followUpOpen}
          onOpenChange={setFollowUpOpen}
          baseReport={report.versions[0]?.name ?? '最新的报告'}
          claims={plan.editable.claims.map((c, i) => ({ id: c.id, label: `H${i + 1}`, statement: c.statement }))}
          onSubmit={(claimId, question, budget) => {
            setTab('run');
            startRef.current?.({ claimId, question, budget });
          }}
        />
      ) : null}
    </div>
  );
}
