'use client';

import { MessageCircleQuestion, User } from 'lucide-react';
import type { JSX } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CommentView } from '@/lib/workplan/view';

export interface CommentListProps {
  comments: CommentView[];
  /** 是否能发起解读（只有 Workspace 的 owner 能）。 */
  canInterpret: boolean;
  /** canInterpret 为 false 时显示在列表上方的说明。 */
  disabledReason?: string;
  onInterpret: (comment: CommentView) => void;
}

const SOFT = {
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
  sky: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300',
  amber:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
} as const;

function resultTone(result: CommentView['result']): string {
  if (result === '通过') return SOFT.emerald;
  if (result === '打回') return SOFT.rose;
  return SOFT.sky;
}

function resultLabel(result: CommentView['result']): string {
  return result ?? '待审';
}

interface CommentGroup {
  reviewPath: string;
  reviewName: string;
  result: CommentView['result'];
  comments: CommentView[];
}

/** 按 reviewPath 分组，保持出现顺序。 */
function groupByReview(comments: CommentView[]): CommentGroup[] {
  const groups: CommentGroup[] = [];
  const indexOf = new Map<string, number>();
  for (const comment of comments) {
    const at = indexOf.get(comment.reviewPath);
    if (at === undefined) {
      indexOf.set(comment.reviewPath, groups.length);
      groups.push({
        reviewPath: comment.reviewPath,
        reviewName: comment.reviewName,
        result: comment.result,
        comments: [comment],
      });
    } else {
      groups[at].comments.push(comment);
    }
  }
  return groups;
}

function CommentCard({
  comment,
  canInterpret,
  onInterpret,
}: {
  comment: CommentView;
  canInterpret: boolean;
  onInterpret: (comment: CommentView) => void;
}): JSX.Element {
  const handled = comment.handledIn.length > 0;
  const pending = comment.result === null;
  const handledLabel = handled
    ? `已在 ${comment.handledIn.map((v) => `v${v}`).join('、')} 处理`
    : '未处理';

  return (
    <li
      data-testid="comment-card"
      data-comment={comment.link}
      data-handled={String(handled)}
      className="space-y-1.5 rounded-md border bg-card p-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="secondary" className="font-mono">
          {comment.id}
        </Badge>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <User className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{comment.author}</span>
        </span>
        {comment.target ? (
          <span className="text-xs text-muted-foreground">关于：{comment.target}</span>
        ) : null}
        <Badge variant="outline" className={handled ? SOFT.emerald : SOFT.amber}>
          {handledLabel}
        </Badge>
      </div>

      <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.text}</p>

      {canInterpret ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant={handled ? 'ghost' : 'outline'}
            disabled={pending}
            title={pending ? '要等 Senior 回复后才能解读' : undefined}
            onClick={() => onInterpret(comment)}
            className="h-7 text-xs"
          >
            <MessageCircleQuestion aria-hidden="true" />
            和 AI 一起解读
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function CommentList({
  comments,
  canInterpret,
  disabledReason,
  onInterpret,
}: CommentListProps): JSX.Element {
  if (comments.length === 0) {
    return (
      <div data-testid="comment-list" className="rounded-lg border bg-card p-3">
        <p className="text-sm text-muted-foreground">
          还没有意见。Senior 看研究计划时留下的意见会出现在这里。
        </p>
      </div>
    );
  }

  const groups = groupByReview(comments);

  return (
    <div data-testid="comment-list" className="space-y-4">
      {!canInterpret && disabledReason ? (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.reviewPath} className="space-y-2">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span className="truncate">{group.reviewName}</span>
            <Badge variant="outline" className={resultTone(group.result)}>
              {resultLabel(group.result)}
            </Badge>
          </h3>
          <ul className="space-y-2">
            {group.comments.map((comment) => (
              <CommentCard
                key={comment.link}
                comment={comment}
                canInterpret={canInterpret}
                onInterpret={onInterpret}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
