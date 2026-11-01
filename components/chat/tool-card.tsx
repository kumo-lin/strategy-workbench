'use client';

import { AlertCircle, Check, ChevronRight, Loader2, Wrench } from 'lucide-react';
import type { JSX } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { formatJson, toolLabel, toolSentence, toolStatusOf, toolTags, type ToolStatus } from './chat-state';

export interface ToolCardProps {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** 例如 phase；显示在头部右侧，可选。 */
  meta?: string;
}

const STATUS_TEXT: Record<ToolStatus, string> = {
  running: '进行中',
  done: '已完成',
  error: '出错',
};

function Section({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: 'error';
}): JSX.Element {
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-xs text-foreground',
          tone === 'error' && 'bg-destructive/5 text-destructive',
        )}
      >
        {body}
      </pre>
    </section>
  );
}

export function ToolCard({
  toolName,
  state,
  input,
  output,
  errorText,
  meta,
}: ToolCardProps): JSX.Element {
  const status = toolStatusOf({ state });
  const sentence = toolSentence(toolName, input);
  const tags = toolTags(toolName, input);
  const hasInput = input !== undefined;
  const hasOutput = output !== undefined;
  const hasError = typeof errorText === 'string' && errorText.length > 0;

  return (
    <Collapsible
      defaultOpen={status === 'error'}
      data-testid="tool-card"
      data-tool={toolName}
      data-status={status}
      className={cn(
        'group/tool rounded-lg border bg-card',
        status === 'error' && 'border-destructive/40',
      )}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 text-sm font-medium text-foreground">{toolLabel(toolName)}</span>
        {tags.map((t) => (
          <Badge key={t} variant="secondary" className="shrink-0" data-testid="tool-tag">
            {t}
          </Badge>
        ))}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{sentence}</span>
        {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
        <span className="shrink-0" aria-hidden="true">
          {status === 'running' ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          {status === 'done' ? (
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : null}
          {status === 'error' ? <AlertCircle className="size-3.5 text-destructive" /> : null}
        </span>
        <span className="sr-only">{STATUS_TEXT[status]}</span>
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90"
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 border-t px-2.5 py-2">
          <p className="text-xs text-muted-foreground">
            原始调用：<code className="font-mono">{toolName}</code>
          </p>
          {hasInput ? <Section title="输入" body={formatJson(input)} /> : null}
          {hasOutput ? <Section title="输出" body={formatJson(output)} /> : null}
          {hasError ? <Section title="错误" body={formatJson(errorText)} tone="error" /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
