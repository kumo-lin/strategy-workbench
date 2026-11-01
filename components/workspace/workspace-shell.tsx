'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { ClipboardList, FileText, Lock, MessagesSquare } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import {
  ASK_USER_NUDGE,
  OPTIONS_IN_BODY_ERROR,
  describeAnswer,
  askUserInputOf,
  optionsWrittenInBody,
  toolNameOf,
  unaskedQuestionMessageId,
} from '@/components/chat/chat-state';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatTimeline } from '@/components/chat/chat-timeline';
import { WORKPLAN_ACTION_EVENT } from '@/components/workflow/next-step-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { WorkspaceStage } from '@/lib/notes/schema';
import type { CommentView, WorkplanVersionView } from '@/lib/workplan/view';
import type { AskUserOutput } from '@/lib/harness/tools/ask-user';
import { CommentList } from './comment-list';
import { RedoButton } from './redo-button';
import { ReviewRequestCard } from './review-request-card';
import { SendForOpinion } from './send-for-opinion';
import { PlanFinalButton } from './plan-final-button';
import { useChatLog } from './use-chat-log';
import { WorkplanPanel } from './workplan-panel';

export interface WorkspaceShellProps {
  workspacePath: string;
  actor: { name: string; kind: 'senior' | 'junior' };
  workspace: { owner: string; reviewer: string; stage: WorkspaceStage; flags: string[] };
  /** Server-computed phase for this track: what the AI may do right now. */
  phase: { label: string; tools: string[] };
  versions: WorkplanVersionView[];
  comments: CommentView[];
  /** 是否还有一份没回复的征求意见。 */
  hasOpenRequest: boolean;
  /** Versions already sent for a G1 opinion (the page hides the button for the latest one). */
  sentVersions: number[];
}

const noopSubscribe = () => () => undefined;
/** False while rendering on the server and during hydration, true afterwards. */
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/** The question text of an ask_user call, found by tool call id (to log the human's answer next to it). */
function questionOf(messages: UIMessage[], toolCallId: string): string {
  for (const m of messages) {
    for (const part of m.parts) {
      if (toolNameOf(part) === 'ask_user' && (part as { toolCallId?: string }).toolCallId === toolCallId) {
        return askUserInputOf((part as { input?: unknown }).input)?.question ?? '';
      }
    }
  }
  return '';
}

export function WorkspaceShell(props: WorkspaceShellProps): JSX.Element {
  const { workspacePath, actor, workspace, phase, versions, comments, hasOpenRequest, sentVersions } = props;
  const isOwner = actor.name === workspace.owner;
  const latest = versions.length > 0 ? versions[versions.length - 1] : null;
  // Radix Tabs derives its trigger/content ids from React.useId, i.e. from the component's position in the
  // tree. In `next dev` that position differs between the server render and hydration (the dev-only segment
  // wrappers), so the ids mismatched and the "1 Issue" badge appeared. The tabs only matter once the page is
  // interactive, so they are rendered after hydration.
  const mounted = useMounted();

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/agent', body: { workspacePath, track: 'workspace' } }), [workspacePath]);
  const { messages, sendMessage, addToolOutput, status, stop, setMessages } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  // Chat history lives in the vault log, with localStorage as the fallback (see use-chat-log).
  useChatLog({ workspacePath, actorName: actor.name, messages, status, setMessages });

  const onAnswer = useCallback(
    (toolCallId: string, output: AskUserOutput) => {
      const question = questionOf(messages, toolCallId);
      const input = messages.flatMap((m) => m.parts).find((p) => (p as { toolCallId?: string }).toolCallId === toolCallId);
      const options = askUserInputOf((input as { input?: unknown } | undefined)?.input)?.options ?? [];
      void addToolOutput({ tool: 'ask_user', toolCallId, output });
      void fetch('/api/workspace/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, question: question || '（提问）', answer: describeAnswer(options, output) || '（空）' }),
      }).catch(() => undefined);
    },
    [messages, addToolOutput, workspacePath],
  );

  const send = useCallback((text: string) => void sendMessage({ text, metadata: { actor: actor.name } }), [sendMessage, actor.name]);
  const onRedone = useCallback(() => send('我想重新做一版研究计划，旧版保留。'), [send]);

  // Safety net for a model that ends a turn with its question in the text instead of an ask_user card:
  // once per message, right after the turn finishes (not for chat history loaded from storage), ask it to resend the card.
  const wasBusy = useRef(false);
  const nudged = useRef(new Set<string>());
  useEffect(() => {
    const busyNow = status === 'submitted' || status === 'streaming';
    const justFinished = wasBusy.current && !busyNow;
    wasBusy.current = busyNow;
    if (!justFinished || !isOwner) return;
    const id = unaskedQuestionMessageId(messages);
    if (!id || nudged.current.has(id)) return;
    nudged.current.add(id);
    void sendMessage({ text: ASK_USER_NUDGE, metadata: { actor: '系统' } });
  }, [status, messages, isOwner, sendMessage]);

  // A question card whose options were written into the question text has no buttons: send it back (at most twice
  // per page, so a model that keeps doing it cannot loop) and log the rejection.
  const rejectedCards = useRef(new Set<string>());
  useEffect(() => {
    if (!isOwner || rejectedCards.current.size >= 2) return;
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      for (const part of m.parts) {
        const p = part as { type: string; state?: string; toolCallId?: string; input?: unknown };
        if (toolNameOf(p) !== 'ask_user' || p.state !== 'input-available' || !p.toolCallId) continue;
        if (rejectedCards.current.has(p.toolCallId) || !optionsWrittenInBody(p.input)) continue;
        rejectedCards.current.add(p.toolCallId);
        void addToolOutput({ tool: 'ask_user', toolCallId: p.toolCallId, state: 'output-error', errorText: OPTIONS_IN_BODY_ERROR });
        void fetch('/api/workspace/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspacePath,
            question: askUserInputOf(p.input)?.question ?? '（提问）',
            answer: '选项写在了问题正文里、options 为空，已要求重发',
            rejected: true,
          }),
        }).catch(() => undefined);
      }
    }
  }, [messages, isOwner, addToolOutput, workspacePath]);

  const interpret = useCallback(
    (c: CommentView) =>
      send(`请帮我解读这条意见（${c.reviewName}${c.target ? ` · 关于「${c.target}」` : ''}）：\n「${c.text}」\n${c.link}`),
    [send],
  );

  const unhandled = comments.filter((c) => c.result !== null && c.handledIn.length === 0);
  const busy = status === 'submitted' || status === 'streaming';

  // The next-step bar (in the layout) has the buttons "开始共创" and "和 AI 一起解读": it tells this page, which owns the chat.
  const actionRef = useRef({ isOwner, busy, send, interpret, first: unhandled[0] });
  useEffect(() => {
    actionRef.current = { isOwner, busy, send, interpret, first: unhandled[0] };
  });
  useEffect(() => {
    const onAction = (e: Event) => {
      const a = actionRef.current;
      if (!a.isOwner || a.busy) return;
      const kind = (e as CustomEvent<string>).detail;
      if (kind === 'cocreate') a.send('我们开始共创这个 Workspace 的研究计划吧。');
      else if (kind === 'interpret' && a.first) a.interpret(a.first);
    };
    window.addEventListener(WORKPLAN_ACTION_EVENT, onAction);
    return () => window.removeEventListener(WORKPLAN_ACTION_EVENT, onAction);
  }, []);

  const emptyHint = (
    <div className="space-y-3">
      <p>
        这里是 {workspace.owner} 和 AI 的对话。AI 会一次问一个问题，问清楚再起草。
      </p>
      {isOwner && versions.length === 0 ? (
        <Button type="button" size="sm" onClick={() => send('我们开始共创这个 Workspace 的研究计划吧。')}>
          开始共创研究计划
        </Button>
      ) : null}
      {isOwner && unhandled.length > 0 ? (
        <Button type="button" size="sm" variant="outline" onClick={() => interpret(unhandled[0])}>
          解读第一条未处理的 comment
        </Button>
      ) : null}
    </div>
  );

  const renderToolExtra = (tool: { toolName: string; state: string; output?: unknown; errorText?: string }): ReactNode =>
    tool.toolName === 'submit_for_review' ? (
      <ReviewRequestCard
        workspacePath={workspacePath}
        state={tool.state}
        output={tool.output}
        errorText={tool.errorText}
        isOwner={isOwner}
        owner={workspace.owner}
        reviewer={workspace.reviewer}
        hasOpenRequest={hasOpenRequest}
      />
    ) : null;

  const disabledReason = isOwner
    ? undefined
    : `这是 ${workspace.owner} 的 Workspace，你以 ${actor.name} 的身份查看。对话只有 owner 能用；意见请到「征求意见」页留。`;

  return (
    <div className="space-y-3" data-testid="workspace-shell">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="bg-card flex h-[calc(100dvh-15rem)] min-h-[28rem] flex-col rounded-lg border" aria-label="对话">
          <header className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
            <MessagesSquare className="size-4" aria-hidden="true" />
            <span>和 AI 讨论 · 研究计划</span>
            <Badge variant="secondary" className="ml-auto">
              {phase.label}
            </Badge>
          </header>
          <div className="min-h-0 flex-1">
            <ChatTimeline
              messages={messages}
              status={status}
              actorName={actor.name}
              onAnswer={onAnswer}
              canAnswer={isOwner}
              emptyHint={emptyHint}
              renderToolExtra={renderToolExtra}
            />
          </div>
          <div className="border-t p-2">
            <ChatComposer
              onSend={send}
              status={status}
              onStop={stop}
              disabled={!isOwner}
              disabledReason={disabledReason}
              placeholder={isOwner ? '回答 AI，或者直接说你的想法…（Enter 发送，Shift+Enter 换行）' : undefined}
            />
          </div>
        </section>

        <section className="bg-card h-[calc(100dvh-15rem)] min-h-[28rem] overflow-hidden rounded-lg border" aria-label="文档">
          {mounted ? (
          <Tabs defaultValue="workplan" className="h-full gap-0">
            <div className="flex items-center gap-2 border-b px-2 py-1.5">
              <TabsList variant="line" className="h-8">
                <TabsTrigger value="workplan" data-testid="tab-workplan">
                  <FileText aria-hidden="true" /> 研究计划
                </TabsTrigger>
                <TabsTrigger value="comments" data-testid="tab-comments">
                  <ClipboardList aria-hidden="true" /> 意见
                  {comments.length > 0 ? (
                    <Badge variant={unhandled.length > 0 ? 'default' : 'secondary'} className="ml-1 h-4 px-1.5">
                      {comments.length}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              </TabsList>
              {isOwner && hasOpenRequest ? (
                <span className="text-muted-foreground ml-auto text-xs" data-testid="opinion-pending">
                  已发给 {workspace.reviewer}，等回复（不挡你）
                </span>
              ) : isOwner && latest !== null && !sentVersions.includes(latest.version) ? (
                <SendForOpinion
                  key={latest.version}
                  workspacePath={workspacePath}
                  subject={latest.path}
                  version={latest.version}
                  body={latest.body}
                  reviewer={workspace.reviewer}
                />
              ) : null}
            </div>
            <TabsContent value="workplan" className="relative min-h-0 overflow-y-auto p-3">
              {isOwner && latest !== null && ['拆题中', 'workplan待审'].includes(workspace.stage) ? (
                <div className="mb-2 flex justify-end">
                  <PlanFinalButton workspacePath={workspacePath} researchHref={`/workspace/${workspacePath.split('/').slice(1).map(encodeURIComponent).join('/')}/research`} />
                </div>
              ) : null}
              {isOwner && workspace.stage === '拆题中' && versions.length > 0 ? (
                <div className="mb-2">
                  <RedoButton
                    workspacePath={workspacePath}
                    nextVersion={versions[versions.length - 1].version + 1}
                    onRedone={onRedone}
                  />
                </div>
              ) : null}
              <WorkplanPanel versions={versions} />
            </TabsContent>
            <TabsContent value="comments" className="relative min-h-0 overflow-y-auto p-3">
              <CommentList
                comments={comments}
                canInterpret={isOwner && !busy}
                disabledReason={isOwner ? (busy ? 'AI 正在回答，稍等一下再发起解读。' : undefined) : `只有 ${workspace.owner} 能发起解读。`}
                onInterpret={interpret}
              />
            </TabsContent>
          </Tabs>
          ) : null}
        </section>
      </div>
      {!isOwner ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Lock className="size-3.5" aria-hidden="true" /> 你以 {actor.name} 的身份查看 {workspace.owner} 的 Workspace。
        </p>
      ) : null}
    </div>
  );
}
