'use client';

import { MessageCircleQuestion } from 'lucide-react';
import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { askUserOutputSchema, type AskUserOutput } from '@/lib/harness/tools/ask-user';
import { cn } from '@/lib/utils';
import {
  askUserInputOf,
  buildAskUserAnswer,
  describeAnswer,
  formatJson,
  toggleSelection,
} from './chat-state';
import { RichResponse } from './rich-text';

export interface QuestionCardProps {
  toolCallId: string;
  /** ask_user 的 input（可能还在流式输出，不完整）。 */
  input: unknown;
  /** part.state：input-streaming | input-available | output-available | output-error | output-denied */
  state: string;
  /** 已回答时：part.output。 */
  output?: unknown;
  /** 为 false 时卡片只读（比如别人的对话，或正在生成）。默认 true。 */
  answerable?: boolean;
  onAnswer: (toolCallId: string, output: AskUserOutput) => void;
}

export function QuestionCard({
  toolCallId,
  input,
  state,
  output,
  answerable = true,
  onAnswer,
}: QuestionCardProps): JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const view = askUserInputOf(input);
  const pending = state === 'input-available';
  const answered = state === 'output-available';
  const failed = state === 'output-error' || state === 'output-denied';
  const editable = pending && answerable && !sent;
  const draft = buildAskUserAnswer({ selected, text });

  const statusText = answered
    ? '已回答'
    : failed
      ? state === 'output-denied'
        ? '已拒绝'
        : '出错'
      : '待回答';

  let answerText = '';
  if (answered) {
    const parsed = askUserOutputSchema.safeParse(output);
    answerText = parsed.success
      ? describeAnswer(view?.options ?? [], parsed.data)
      : formatJson(output);
  }

  const pick = (id: string) => {
    if (!view) return;
    setSelected((prev) => toggleSelection(prev, id, view.multiSelect));
  };

  const send = () => {
    if (!draft || sent) return;
    setSent(true);
    onAnswer(toolCallId, draft);
  };

  return (
    <div
      data-testid="question-card"
      data-state={state}
      className="space-y-3 rounded-lg border bg-card p-3"
    >
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">AI 向你提问</span>
        <span className="ml-auto text-xs text-muted-foreground">{statusText}</span>
      </div>

      {view === null ? (
        <div className="space-y-2" role="status">
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          <p className="text-xs text-muted-foreground">正在提问…</p>
        </div>
      ) : (
        <>
          <RichResponse className="text-sm leading-relaxed text-foreground">{view.question}</RichResponse>

          {pending ? (
            <div className="space-y-2">
              {view.options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="选项">
                  {view.options.map((option) => {
                    const isSelected = selected.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={isSelected}
                        disabled={!editable}
                        onClick={() => pick(option.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-sm transition-colors',
                          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                          'disabled:pointer-events-none disabled:opacity-60',
                          isSelected ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-3 shrink-0 items-center justify-center border',
                            view.multiSelect ? 'rounded-[3px]' : 'rounded-full',
                            isSelected ? 'border-primary' : 'border-muted-foreground/50',
                          )}
                        >
                          {isSelected ? (
                            <span
                              className={cn(
                                'size-1.5 bg-primary',
                                view.multiSelect ? 'rounded-[1px]' : 'rounded-full',
                              )}
                            />
                          ) : null}
                        </span>
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {answerable ? (
                <div className="space-y-2">
                  <Textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      // Same as the chat box: Enter sends, Shift+Enter breaks the line, IME composition is left alone.
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        send();
                      }
                    }}
                    placeholder="或者自己写…"
                    aria-label="补充回答"
                    disabled={!editable}
                  />
                  <div className="flex items-center justify-end">
                    <Button type="button" size="sm" onClick={send} disabled={!draft || sent}>
                      发送回答
                    </Button>
                  </div>
                  {sent ? (
                    <p className="text-xs text-muted-foreground">已发送回答，等待 AI 继续…</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">等待回答…</p>
              )}
            </div>
          ) : null}

          {answered ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">你的回答：</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{answerText || '—'}</p>
            </div>
          ) : null}

          {failed ? (
            <p className="text-sm text-destructive">
              {state === 'output-denied'
                ? '这个提问被拒绝了，AI 需要换一种方式。'
                : '这个提问没有得到回答，AI 可以重试。'}
            </p>
          ) : null}

          {!pending && !answered && !failed ? (
            <p className="text-xs text-muted-foreground">正在生成问题…</p>
          ) : null}
        </>
      )}
    </div>
  );
}
