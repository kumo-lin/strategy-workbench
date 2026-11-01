'use client';

import { CheckCircle2, Loader2, SendHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { z } from 'zod';
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationTitle } from '@/components/ai-elements/confirmation';

const reviewMaterialSchema = z.object({
  prepared: z.literal(true),
  gate: z.enum(['G1', '结论', 'G2', 'G3']),
  subject: z.string(),
  version: z.number(),
  summary: z.string(),
  focus: z.array(z.string()),
  hypotheses: z.array(z.string()),
  next: z.string(),
});

const apiErrorSchema = z.object({ error: z.string(), message: z.string() });

export interface ReviewRequestCardProps {
  workspacePath: string;
  /** tool part 的状态：input-streaming | input-available | output-available | output-error | output-denied */
  state: string;
  /** tool part 的 output（可能是 undefined / 不合法）。 */
  output: unknown;
  errorText?: string;
  /** 当前登录的人是不是 Workspace 的 owner。 */
  isOwner: boolean;
  owner: string;
  reviewer: string;
  /** 是否还有一份没回复的征求意见。 */
  hasOpenRequest: boolean;
}

/** `20_项目/…/假设：X.md` → `假设：X` */
function lastSegment(path: string): string {
  const tail = path.split('/').pop() ?? path;
  return tail.replace(/\.md$/, '');
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

export function ReviewRequestCard({
  workspacePath,
  state,
  output,
  errorText,
  isOwner,
  owner,
  reviewer,
  hasOpenRequest,
}: ReviewRequestCardProps): JSX.Element {
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const material = reviewMaterialSchema.safeParse(output);
  const preparing = state === 'input-streaming' || state === 'input-available';
  const failed = state === 'output-error' || state === 'output-denied';

  const submit = async () => {
    if (!material.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/review/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          gate: material.data.gate,
          subject: material.data.subject,
          summary: material.data.summary,
          focus: material.data.focus,
        }),
      });
      if (!res.ok) {
        setError(await readError(res, '提交失败，请重试'));
        return;
      }
      setSubmitted(true);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div
        data-testid="review-request-card"
        data-submitted="true"
        className="rounded-lg border border-emerald-500/30 bg-emerald-50 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2
            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            已发给 {reviewer} 征求意见
          </p>
        </div>
        {material.success ? (
          <p className="mt-1 pl-6 text-xs text-emerald-700/80 dark:text-emerald-300/80">
            研究计划 v{material.data.version}
          </p>
        ) : null}
      </div>
    );
  }

  const header = material.success
    ? `准备发给 ${reviewer} 征求意见：研究计划 v${material.data.version}`
    : '发送确认';

  const disabledReason = !isOwner
    ? `只有 ${owner} 能发`
    : hasOpenRequest
      ? `上一份还在等 ${reviewer} 回复`
      : null;

  return (
    <div
      data-testid="review-request-card"
      data-submitted="false"
      className="space-y-3 rounded-lg border bg-card p-3"
    >
      <div className="flex items-center gap-2">
        <SendHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">{header}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">AI 准备 · 等你确认</span>
      </div>

      {preparing ? (
        <div className="space-y-2" role="status">
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          <p className="text-xs text-muted-foreground">正在准备要发出的材料…</p>
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">{errorText ?? '准备材料失败'}</p>
      ) : !material.success ? (
        <p className="text-sm text-muted-foreground">材料格式不对</p>
      ) : (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {material.data.summary}
          </p>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">请 {reviewer} 重点看</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {material.data.focus.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              涉及 {material.data.hypotheses.length} 个假设
            </p>
            <div className="flex flex-wrap gap-1.5">
              {material.data.hypotheses.map((path, index) => (
                <span
                  key={`${index}-${path}`}
                  className="inline-flex items-center rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {lastSegment(path)}
                </span>
              ))}
            </div>
          </div>

          <Confirmation approval={{ id: 'review-request' }} state="approval-requested" className="items-stretch">
            <ConfirmationTitle>AI 只准备了材料。你确认后，才会真正发给 {reviewer} 征求意见。</ConfirmationTitle>
            <ConfirmationActions>
              <ConfirmationAction
                size="sm"
                data-testid="submit-review"
                onClick={() => {
                  void submit();
                }}
                disabled={submitting || disabledReason !== null}
              >
                {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <SendHorizontal aria-hidden="true" />}
                发给 {reviewer} 征求意见
              </ConfirmationAction>
            </ConfirmationActions>
            {disabledReason ? <p className="text-xs text-muted-foreground">{disabledReason}</p> : null}
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </Confirmation>
        </div>
      )}
    </div>
  );
}
