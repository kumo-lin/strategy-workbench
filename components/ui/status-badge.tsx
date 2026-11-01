import type { JSX } from 'react';
import { Badge } from '@/components/ui/badge';
import type { NoteStatus } from '@/lib/notes/schema';
import { cn } from '@/lib/utils';

/**
 * 每个状态一套克制的配色：浅色底 + 深色字，`dark:` 下换成深底浅字。
 * 颜色只取 Tailwind 调色板里少数几种（sky / amber / emerald / rose / violet）。
 */
export const STATUS_META: Record<NoteStatus, { label: string; className: string }> = {
  进行中: {
    label: '进行中',
    className:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300',
  },
  推断: {
    label: '推断',
    className:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  },
  已确认: {
    label: '已确认',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  },
  已否决: {
    label: '已否决',
    className:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
  },
  探索性: {
    label: '探索性',
    className:
      'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300',
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: NoteStatus;
  className?: string;
}): JSX.Element {
  const meta = STATUS_META[status];

  return (
    <Badge variant="outline" data-status={status} className={cn(meta.className, className)}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {meta.label}
    </Badge>
  );
}
