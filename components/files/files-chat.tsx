'use client';

/**
 * D-64 T37 (ui-3, ui-5): 按你的任务找资料 — the files page's chat (phase files_chat). A proposed change of the
 * selection (set_selection) is a card: nothing changes until the analyst clicks 同意.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatTimeline, type ToolRenderInfo } from '@/components/chat/chat-timeline';
import { postSelection, SELECTION_AGREED, type AgreedSelection } from '@/components/files/files-manager';
import { Button } from '@/components/ui/button';
import type { SelectionProposal } from '@/lib/harness/tools/set-selection';

function ProposalCard({ workspacePath, proposal, canEdit }: { workspacePath: string; proposal: SelectionProposal; canEdit: boolean }): JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<'open' | 'done' | 'no' | 'error'>('open');
  const accept = async () => {
    // the file list on this page saves it (in order with its own clicks); without one, save it here
    const ok = await new Promise<boolean>((done) => {
      const detail: AgreedSelection = { selection: proposal.proposal, handled: false, done };
      window.dispatchEvent(new CustomEvent(SELECTION_AGREED, { detail }));
      if (!detail.handled) void postSelection(workspacePath, proposal.proposal).then(done);
    });
    setState(ok ? 'done' : 'error');
    if (ok) router.refresh();
  };
  return (
    <div data-testid="selection-proposal" className="space-y-2 rounded-md border p-2 text-sm">
      <ul className="list-disc pl-5">{proposal.changes.length ? proposal.changes.map((c) => <li key={c}>{c}</li>) : <li>没有变化</li>}</ul>
      {state === 'open' && canEdit && proposal.changes.length ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" data-testid="selection-accept" onClick={() => void accept()}>
            同意
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setState('no')}>
            不用
          </Button>
        </div>
      ) : null}
      {state === 'done' ? <p className="text-muted-foreground text-xs">已按这个调整。</p> : state === 'no' ? <p className="text-muted-foreground text-xs">没有调整。</p> : state === 'error' ? <p className="text-destructive text-xs">没有保存，请重试。</p> : null}
    </div>
  );
}

export function FilesChat({ workspacePath, actorName, canEdit }: { workspacePath: string; actorName: string; canEdit: boolean }): JSX.Element {
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/agent', body: { workspacePath, track: 'files' } }), [workspacePath]);
  const { messages, sendMessage, status, stop } = useChat({ transport });
  const extra = (tool: ToolRenderInfo): ReactNode =>
    tool.toolName === 'set_selection' && tool.state === 'output-available' && tool.output ? <ProposalCard workspacePath={workspacePath} proposal={tool.output as SelectionProposal} canEdit={canEdit} /> : null;
  return (
    <section data-testid="files-chat" className="bg-card flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border" aria-label="按你的任务找资料">
      <header className="border-b px-3 py-2 text-sm font-medium">按你的任务找资料</header>
      <div className="min-h-0 flex-1">
        <ChatTimeline messages={messages} status={status} actorName={actorName} onAnswer={() => {}} canAnswer={false} emptyHint="说说这次要做什么，AI 按任务挑出该先读的资料，也可以问某份资料和任务有没有关系。" renderToolExtra={extra} />
      </div>
      <div className="border-t p-2">
        <ChatComposer onSend={(text) => void sendMessage({ text, metadata: { actor: actorName } })} status={status} onStop={stop} disabled={!canEdit} disabledReason="只有这个 Workspace 的负责人能用" placeholder="例如：这次要先读什么？" />
      </div>
    </section>
  );
}
