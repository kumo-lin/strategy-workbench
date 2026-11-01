'use client';

import { Lock, SendHorizontal, Square } from 'lucide-react';
import { useState, type JSX, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ChatComposerProps {
  onSend: (text: string) => void;
  /** useChat 的 status。submitted / streaming 时不能发送，显示「停止」。 */
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  onStop?: () => void;
  disabled?: boolean;
  /** disabled 时显示在输入框上方的原因。 */
  disabledReason?: string;
  placeholder?: string;
  /** 外部要预填的文字（比如点了"解读这条 comment"）；每次变化时把输入框内容替换成它。 */
  draft?: { id: number; text: string } | null;
}

const MAX_ROWS = 6;

export function ChatComposer({
  onSend,
  status,
  onStop,
  disabled = false,
  disabledReason,
  placeholder,
  draft,
}: ChatComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [seenDraftId, setSeenDraftId] = useState<number | null>(null);

  // React 允许的「渲染期间按 id 同步外部状态」写法（不使用 effect）。
  if (draft && draft.id !== seenDraftId) {
    setSeenDraftId(draft.id);
    setText(draft.text);
  }

  const busy = status === 'submitted' || status === 'streaming';
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !disabled && !busy;

  const rows = Math.min(MAX_ROWS, Math.max(1, text.split('\n').length));

  const send = () => {
    if (!canSend) return;
    setText('');
    onSend(trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    if (!canSend) return;
    event.preventDefault();
    send();
  };

  return (
    <div data-testid="chat-composer" className="space-y-2">
      {disabled && disabledReason ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          {disabledReason}
        </p>
      ) : null}

      <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
        <Textarea
          data-testid="chat-input"
          value={text}
          rows={rows}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? '和 AI 说点什么…'}
          aria-label="消息输入框"
          disabled={disabled}
          className="min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />

        {busy ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="停止"
            data-testid="chat-stop"
            onClick={() => onStop?.()}
          >
            <Square aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            aria-label="发送"
            data-testid="chat-send"
            onClick={send}
            disabled={!canSend}
          >
            <SendHorizontal aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
