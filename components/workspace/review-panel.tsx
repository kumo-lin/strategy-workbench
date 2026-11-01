'use client';

import { Loader2, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { z } from 'zod';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ReadOnlyNotice } from '@/components/shell/readonly-notice';
import { WindowLink } from '@/components/shell/window-link';
import type { ReviewView } from '@/lib/workplan/view';

const apiErrorSchema = z.object({ error: z.string(), message: z.string() });

export interface ReviewPanelProps {
  review: ReviewView;
  /** 当前登录的人。 */
  actorName: string;
  /** 能不能留 comment（服务端规则：审批没有结论，且不是提交人自己）。 */
  canComment: boolean;
  /** 能不能点通过/打回（当前人是这次审批的 reviewer）。 */
  canDecide: boolean;
  /** 「关于」下拉框的候选（workplan 的小标题），可以为空。 */
  targets: string[];
}

async function readError(res: Response, fallback: string): Promise<string> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return fallback;
  }
  const parsed = apiErrorSchema.safeParse(data);
  return parsed.success ? parsed.data.message : fallback;
}

function resultLabel(result: ReviewView['result'], isReport: boolean): string {
  if (isReport) {
    if (result === '通过') return '已确认';
    if (result === '打回') return '有意见';
    return '等确认';
  }
  if (result === '通过') return '看过了';
  if (result === '打回') return '有意见';
  return '等回复';
}

function resultBadgeClass(result: ReviewView['result']): string {
  if (result === '通过') {
    return 'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300';
  }
  if (result === '打回') {
    return 'border-rose-500/30 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300';
  }
  return 'border-sky-500/30 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300';
}

export function ReviewPanel({
  review,
  actorName,
  canComment,
  canDecide,
  targets,
}: ReviewPanelProps): JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  /** The decision went through: show it at once, not 10–15 s later when the page refreshes. */
  const [decided, setDecided] = useState<'approve' | 'reject' | null>(null);

  const pending = review.result === null && decided === null;
  const result: ReviewView['result'] = decided === 'approve' ? '通过' : decided === 'reject' ? '打回' : review.result;
  /** 结论 reviews confirm a delivered report; G1 asks for an opinion on the workplan. */
  const isReport = review.gate === '结论';
  const trimmed = text.trim();

  const approveTitle = isReport ? '确认这份报告？' : '确认「看过了，没有要改的」？';
  const approveDescription = isReport
    ? `确认后，这份报告会放进项目文件，同一项目里别的 Workspace 在“文件”里能看到。${
        review.comments.length > 0
          ? `你留的 ${review.comments.length} 条意见 ${review.requester} 会看到。`
          : '你还没有留意见。'
      }`
    : `研究计划会标上「${review.reviewer} 看过」，不挡 ${review.requester} 往下做。${
        review.comments.length > 0
          ? `你留的 ${review.comments.length} 条意见 ${review.requester} 会看到，由 AI 帮他解读你的意图、给出几种改法。`
          : '你还没有留意见。'
      }`;
  const rejectDescription = isReport
    ? `${review.requester} 会收到你的意见，改完可以再提交；这份报告暂时不会放进项目文件。`
    : `${review.requester} 会收到你的意见，和 AI 一起解读后决定怎么改；这不会挡住他往下做。`;

  const addComment = async () => {
    if (!trimmed || commenting) return;
    setCommenting(true);
    setCommentError(null);
    try {
      const res = await fetch('/api/workspace/review/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewPath: review.path,
          text: trimmed,
          ...(target ? { target } : {}),
        }),
      });
      if (!res.ok) {
        setCommentError(await readError(res, '添加意见失败，请重试'));
        return;
      }
      setText('');
      setTarget('');
      router.refresh();
    } catch {
      setCommentError('网络错误，请重试');
    } finally {
      setCommenting(false);
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (deciding !== null) return;
    setDeciding(decision);
    setDecisionError(null);
    try {
      const res = await fetch('/api/workspace/review/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewPath: review.path, decision }),
      });
      if (!res.ok) {
        setDecisionError(await readError(res, '操作失败，请重试'));
        return;
      }
      setDecided(decision);
      router.refresh();
    } catch {
      setDecisionError('网络错误，请重试');
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div
      data-testid="review-panel"
      data-result={review.result ?? 'pending'}
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">{review.name}</h2>
          <Badge variant="outline" className={resultBadgeClass(result)}>
            {resultLabel(result, isReport)}
          </Badge>
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <User className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {isReport
              ? `${review.requester} 提交给 ${review.reviewer} 确认`
              : `${review.requester} 发给 ${review.reviewer} 征求意见`}
          </span>
          {review.version !== null ? <span>· 研究计划 v{review.version}</span> : null}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">提交说明</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {review.summary}
        </p>
      </div>

      {review.focus.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">请重点看</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {review.focus.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">
          意见（{review.comments.length}）
        </p>
        {review.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有意见</p>
        ) : (
          <ul className="space-y-2">
            {review.comments.map((comment) => (
              <li key={comment.id} className="rounded-md border bg-background p-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                    {comment.id}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <User className="size-3" aria-hidden="true" />
                    {comment.author}
                  </span>
                  {comment.target ? <span>关于：{comment.target}</span> : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {comment.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pending && canComment ? (
        <div className="space-y-2 border-t pt-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            关于（可选）
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={commenting}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            >
              <option value="">{isReport ? '整份报告' : '整份研究计划'}</option>
              {targets.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <Textarea
            data-testid="comment-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="写下你的意见，一条一个意思"
            aria-label="Comment 内容"
            disabled={commenting}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">以 {actorName} 的身份留意见</p>
            <Button
              type="button"
              size="sm"
              data-testid="add-comment"
              onClick={() => {
                void addComment();
              }}
              disabled={!trimmed || commenting}
            >
              {commenting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              添加意见
            </Button>
          </div>
          {commentError ? (
            <p className="text-xs text-destructive" role="alert">
              {commentError}
            </p>
          ) : null}
        </div>
      ) : null}

      {pending ? (
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="approve-review"
              onClick={() => setConfirm('approve')}
              disabled={!canDecide || deciding !== null}
            >
              {deciding === 'approve' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              {isReport ? '确认，放进项目文件' : '看过了，没有要改的'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive"
              data-testid="reject-review"
              onClick={() => setConfirm('reject')}
              disabled={!canDecide || deciding !== null || review.comments.length === 0}
              title={
                review.comments.length === 0 ? '有意见的话，先留一条 comment 说明是什么' : undefined
              }
            >
              {deciding === 'reject' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              有意见，请修改
            </Button>
          </div>
          {!canDecide ? (
            <ReadOnlyNotice
              cannot={isReport ? '只读：你不能确认这份报告。' : '只读：你不能回复这次征求意见。'}
              who={
                isReport
                  ? `${review.reviewer} 才能确认；${review.requester} 提交的，不能自己确认。`
                  : `${review.reviewer} 才能回复；${review.requester} 发出的，不能自己回复。`
              }
              can={
                isReport
                  ? canComment
                    ? `看这份报告，在上面留意见；确认由 ${review.reviewer} 来做。`
                    : `看这份报告；意见由 ${review.reviewer} 和别的角色来留。`
                  : canComment
                    ? `看这份研究计划，在上面留意见；有没有意见由 ${review.reviewer} 来回复。`
                    : `看这份研究计划；意见由 ${review.reviewer} 和别的角色来留。`
              }
              where={<WindowLink roleName={review.reviewer} />}
            />
          ) : null}
          {decisionError ? (
            <p className="text-xs text-destructive" role="alert">
              {decisionError}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="border-t pt-3 text-sm text-muted-foreground">
          {review.reviewer} {result === '通过' ? (isReport ? '已确认' : '看过了') : '有意见'}
        </p>
      )}

      <AlertDialog
        open={confirm === 'approve'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{approveTitle}</AlertDialogTitle>
            <AlertDialogDescription>{approveDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deciding !== null}
              onClick={() => {
                void decide('approve');
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirm === 'reject'}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认「有意见，请修改」？</AlertDialogTitle>
            <AlertDialogDescription>{rejectDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              className="text-destructive"
              disabled={deciding !== null}
              onClick={() => {
                void decide('reject');
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
