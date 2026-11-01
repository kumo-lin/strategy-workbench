'use client';

import { AlertCircle, Bot, User } from 'lucide-react';
import { useState, type JSX } from 'react';
import type { LogEntry } from '@/lib/vault';
import { cn } from '@/lib/utils';

type LogFilter = 'all' | 'ai' | 'human' | 'approval';

const FILTERS: readonly { id: LogFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI' },
  { id: 'human', label: '人' },
  { id: 'approval', label: '审批' },
];

const APPROVAL_PREFIX = 'event:';

const TONE = {
  muted: 'bg-muted text-muted-foreground',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
} as const;

function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  switch (filter) {
    case 'ai':
      return entry.actor === 'AI';
    case 'human':
      return entry.actor !== 'AI';
    case 'approval':
      return entry.action.startsWith(APPROVAL_PREFIX);
    default:
      return true;
  }
}

function actionTone(action: string): string {
  if (action.startsWith('event:')) return TONE.emerald;
  if (action.startsWith('answer:')) return TONE.sky;
  if (action.startsWith('comment:')) return TONE.amber;
  if (action.startsWith('write:')) return TONE.violet;
  return TONE.muted;
}

function formatTime(time: string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return time;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isFailure(change: string): boolean {
  return change.trimStart().startsWith('✗');
}

export function LogTable({ entries }: { entries: LogEntry[] }): JSX.Element {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());

  const counts: Record<LogFilter, number> = {
    all: entries.length,
    ai: entries.filter((e) => e.actor === 'AI').length,
    human: entries.filter((e) => e.actor !== 'AI').length,
    approval: entries.filter((e) => e.action.startsWith(APPROVAL_PREFIX)).length,
  };

  // Newest first; copy so the prop array is never mutated.
  const rows = entries
    .map((entry, index) => ({ entry, key: `${index}:${entry.time}:${entry.action}` }))
    .reverse();

  const visible = rows.filter(({ entry }) => matchesFilter(entry, filter));

  function toggle(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div data-testid="log-table" className="overflow-hidden rounded-lg border bg-card">
      {entries.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  active
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span>{f.label}</span>
                <span
                  className={cn(
                    'font-mono text-[11px]',
                    active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}
                >
                  {counts[f.id]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          {entries.length === 0 ? '还没有记录。' : '没有符合筛选条件的记录。'}
        </p>
      ) : (
        <ul className="divide-y">
          {visible.map(({ entry, key }) => {
            const isAI = entry.actor === 'AI';
            const failed = isFailure(entry.change);
            const open = expanded.has(key);
            return (
              <li
                key={key}
                data-testid="log-row"
                data-actor={entry.actor}
                data-action={entry.action}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(key)}
                  className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {formatTime(entry.time)}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1">
                      {isAI ? (
                        <Bot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      )}
                      <span className="text-xs font-medium text-foreground">{isAI ? 'AI' : entry.actor}</span>
                    </span>
                    <span
                      className={cn(
                        'max-w-full break-all rounded px-1.5 py-0.5 font-mono text-[11px]',
                        actionTone(entry.action),
                      )}
                    >
                      {entry.action}
                    </span>
                    {failed ? (
                      <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                    ) : null}
                  </span>

                  <span className="mt-1 block text-xs">
                    <span
                      className={cn(
                        'whitespace-pre-wrap break-words',
                        open ? 'text-foreground' : 'line-clamp-3',
                        failed && 'text-destructive',
                      )}
                    >
                      {entry.change}
                    </span>
                  </span>

                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{entry.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
