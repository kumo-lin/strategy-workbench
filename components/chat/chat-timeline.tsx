'use client';

import type { UIMessage } from 'ai';
import { Bot, Loader2, User } from 'lucide-react';
import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { PHASE_LABELS, type Phase } from '@/lib/harness/phases';
import type { AskUserOutput } from '@/lib/harness/tools/ask-user';
import { toolNameOf } from './chat-state';
import { plainChatText, RichResponse } from './rich-text';
import { QuestionCard } from './question-card';
import { ToolCard } from './tool-card';

export interface ChatTimelineProps {
  messages: UIMessage[];
  /** useChat 的 status。submitted / streaming 时底部显示「AI 正在思考…」。 */
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  /**
   * 当前登录的人，例如 'Junior A'。user 消息优先显示 `message.metadata.actor`（发送时写进去的
   * 发言人），没有才退回这个名字。发送时请用 `sendMessage({ text, metadata: { actor } })`。
   */
  actorName: string;
  /** ask_user 卡片的回答。 */
  onAnswer: (toolCallId: string, output: AskUserOutput) => void;
  /** 为 false 时所有提问卡片只读。默认 true。 */
  canAnswer?: boolean;
  /** 空对话时显示的内容。 */
  emptyHint?: ReactNode;
  /** 在某个工具卡片下面追加内容（例如 submit_for_review 的确认按钮）。返回 null 就什么也不加。 */
  renderToolExtra?: (tool: ToolRenderInfo) => ReactNode;
}

export interface ToolRenderInfo {
  toolName: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/** 距离底部小于这个像素数就算「在底部附近」。 */
const STICK_THRESHOLD_PX = 80;

interface ToolPartFields {
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

type Block =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'ask'; key: string; fields: ToolPartFields }
  | {
      kind: 'tools';
      key: string;
      items: { key: string; name: string; fields: ToolPartFields }[];
    };

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** 只认 `type: 'text'`；reasoning / source-* / file / data-* 都不算。 */
function textOf(part: unknown): string | null {
  const record = toRecord(part);
  if (!record || record.type !== 'text') return null;
  return typeof record.text === 'string' ? record.text : null;
}

/** 不依赖 AI SDK 的 state 联合类型的窄化，结构化地读 tool part 的字段。 */
function toolFieldsOf(part: unknown): ToolPartFields | null {
  const record = toRecord(part);
  if (!record) return null;
  const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : '';
  if (toolCallId.length === 0) return null;
  return {
    toolCallId,
    state: typeof record.state === 'string' ? record.state : 'input-available',
    input: record.input,
    output: record.output,
    errorText: typeof record.errorText === 'string' ? record.errorText : undefined,
  };
}

/** Who sent a user message, if the sender recorded it in `metadata.actor`. */
export function speakerOf(metadata: unknown): string | null {
  const actor = toRecord(metadata)?.actor;
  return typeof actor === 'string' && actor.trim().length > 0 ? actor : null;
}

function phaseLabelOf(metadata: unknown): string | null {
  const record = toRecord(metadata);
  const phase = record?.phase;
  if (typeof phase !== 'string' || phase.length === 0) return null;
  const label = PHASE_LABELS[phase as Phase];
  return typeof label === 'string' ? label : phase;
}

/** 把一条 assistant 消息的 parts 归并成块：文字、提问卡片、连续的普通工具卡片。 */
function buildBlocks(parts: UIMessage['parts']): Block[] {
  const blocks: Block[] = [];

  parts.forEach((part, index) => {
    const key = `part-${index}`;

    const text = textOf(part);
    if (text !== null) {
      if (text.trim().length > 0) blocks.push({ kind: 'text', key, text });
      return;
    }

    const name = toolNameOf(part);
    if (!name) return;

    const fields = toolFieldsOf(part);
    if (!fields) return;

    if (name === 'ask_user') {
      blocks.push({ kind: 'ask', key, fields });
      return;
    }

    const last = blocks[blocks.length - 1];
    if (last?.kind === 'tools') {
      last.items.push({ key, name, fields });
    } else {
      blocks.push({ kind: 'tools', key, items: [{ key, name, fields }] });
    }
  });

  return blocks;
}

export function ChatTimeline({
  messages,
  status,
  actorName,
  onAnswer,
  canAnswer = true,
  emptyHint,
  renderToolExtra,
}: ChatTimelineProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 用户上一次滚动之后是否还贴着底部；默认贴底，所以首次渲染会滚到底。 */
  const nearBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (messages.length === 0) return;
    // 用户已经往上翻了，就不要把他拽回来。
    if (!nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const thinking =
    status === 'submitted' || (status === 'streaming' && lastMessage?.role === 'user');

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      data-testid="chat-timeline"
      className="relative h-full overflow-y-auto"
    >
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {emptyHint ?? '还没有对话。'}
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col space-y-5 p-4">
          {messages.map((message, messageIndex) => {
            const messageKey = `${message.id}-${messageIndex}`;
            const isLast = messageIndex === messages.length - 1;

            if (message.role === 'user') {
              const texts = message.parts
                .map((part) => textOf(part))
                .filter((text): text is string => text !== null && text.trim().length > 0);

              return (
                <div key={messageKey} className="flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <User className="size-3.5" aria-hidden="true" />
                    <span data-testid="message-actor">{speakerOf(message.metadata) ?? actorName}</span>
                  </div>
                  {texts.length > 0 ? (
                    <div className="flex max-w-[85%] flex-col items-end gap-1.5">
                      {texts.map((text, textIndex) => (
                        <p
                          key={`${messageKey}-text-${textIndex}`}
                          className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
                        >
                          {plainChatText(text)}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }

            const phase = phaseLabelOf(message.metadata);
            const blocks = buildBlocks(message.parts);

            return (
              <div key={messageKey} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="size-3.5" aria-hidden="true" />
                  <span>AI</span>
                  {phase ? (
                    <Badge variant="secondary" className="ml-auto">
                      {phase}
                    </Badge>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  {blocks.map((block) => {
                    if (block.kind === 'text') {
                      return (
                        <RichResponse key={block.key} className="text-sm leading-relaxed text-foreground">
                          {block.text}
                        </RichResponse>
                      );
                    }

                    if (block.kind === 'ask') {
                      return (
                        <QuestionCard
                          key={block.key}
                          toolCallId={block.fields.toolCallId}
                          input={block.fields.input}
                          state={block.fields.state}
                          output={block.fields.output}
                          answerable={canAnswer !== false && isLast}
                          onAnswer={onAnswer}
                        />
                      );
                    }

                    return (
                      <div key={block.key} className="space-y-1.5">
                        {block.items.map((item) => (
                          <div key={item.key} className="space-y-1.5">
                            <ToolCard
                              toolName={item.name}
                              state={item.fields.state}
                              input={item.fields.input}
                              output={item.fields.output}
                              errorText={item.fields.errorText}
                            />
                            {renderToolExtra?.({ toolName: item.name, ...item.fields })}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {thinking ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              <span>AI 正在思考…</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
