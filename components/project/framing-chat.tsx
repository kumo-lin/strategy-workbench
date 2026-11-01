'use client';

/**
 * D-64 T33 (ui-0b): 和 AI 定义问题. The first message creates the project (an unnamed draft, the message as its question)
 * and opens it here with that message (`?project=…&q=…`); every turn then runs in the project's framing phase
 * (/api/agent, track project). The page re-reads the vault after each turn, so the contract and the issue tree show
 * up as the AI drafts them.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatTimeline } from '@/components/chat/chat-timeline';
import type { AskUserOutput } from '@/lib/harness/tools/ask-user';

const draftName = (d = new Date()) => `未命名项目 ${d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}`;

export function FramingChat({ project, firstMessage, actorName, canFrame }: { project: string | null; firstMessage?: string; actorName: string; canFrame: boolean }): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/agent', body: { workspacePath: `20_项目/${project}`, track: 'project' } }), [project]);
  const { messages, sendMessage, addToolOutput, status, stop } = useChat({ transport, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls });

  const send = useCallback(
    async (text: string) => {
      setError(null);
      if (project) return void sendMessage({ text, metadata: { actor: actorName } });
      const name = draftName();
      const res = await fetch('/api/project/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, coreQuestion: text.replace(/\s+/g, ' ').trim().slice(0, 300) }) });
      if (!res.ok) return setError(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? '没有建成项目，请重试');
      router.replace(`/new?project=${encodeURIComponent(name)}&q=${encodeURIComponent(text)}`);
    },
    [project, sendMessage, actorName, router],
  );
  // the message that created the project is the first turn of its chat
  const sentFirst = useRef(false);
  useEffect(() => {
    if (!project || !firstMessage || sentFirst.current) return;
    sentFirst.current = true;
    void sendMessage({ text: firstMessage, metadata: { actor: actorName } });
    router.replace(`/new?project=${encodeURIComponent(project)}`);
  }, [project, firstMessage, sendMessage, actorName, router]);
  const onAnswer = useCallback((toolCallId: string, output: AskUserOutput) => void addToolOutput({ tool: 'ask_user', toolCallId, output }), [addToolOutput]);

  // the contract and the tree are drawn by the server page: re-read it when a turn ends
  const wasBusy = useRef(false);
  useEffect(() => {
    const busy = status === 'submitted' || status === 'streaming';
    if (wasBusy.current && !busy) router.refresh();
    wasBusy.current = busy;
  }, [status, router]);

  return (
    <section className="bg-card flex h-[calc(100dvh-12rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border" data-testid="framing-chat" aria-label="和 AI 定义问题">
      <header className="border-b px-3 py-2 text-sm font-medium">和 AI 定义问题</header>
      <div className="min-h-0 flex-1">
        <ChatTimeline messages={messages} status={status} actorName={actorName} onAnswer={onAnswer} canAnswer={canFrame} emptyHint="说说你想研究的题目，AI 会先问三件事：要做的决定、时间和地域、不研究什么。" />
      </div>
      {error ? <p className="text-destructive px-3 text-sm">{error}</p> : null}
      <div className="border-t p-2">
        <ChatComposer onSend={(t) => void send(t)} status={status} onStop={stop} disabled={!canFrame} disabledReason="只有 Senior 能新建项目" placeholder="例如：个人 AI 市场将如何演进，对联想意味着什么？" />
      </div>
    </section>
  );
}
