'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX, type ReactNode } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const apiErrorSchema = z.object({ error: z.string(), message: z.string() });

export interface ReportReviewBoxProps {
  workspacePath: string;
  reportPath: string;
  reportName: string;
  owner: string;
  reviewer: string;
  state: 'none' | 'open' | 'confirmed' | 'sent_back';
  isOwner: boolean;
  /** The page says this report is delivered and is the newest version. */
  canSubmit: boolean;
  /** Prefilled summary. */
  summaryDraft: string;
  /** The reviewer's ReviewPanel, built by the page. */
  panel?: ReactNode;
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

/** "提交给 {reviewer} 确认" above a delivered report, and what happened to that request. */
export function ReportReviewBox({
  workspacePath,
  reportPath,
  reviewer,
  state,
  isOwner,
  canSubmit,
  summaryDraft,
  panel,
}: ReportReviewBoxProps): JSX.Element | null {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(summaryDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The submit went through: show the waiting state at once, not 10–15 s later when the page refreshes. */
  const [done, setDone] = useState(false);

  // The server value wins again once the page refreshes and `state` changes.
  const shown = done && (state === 'none' || state === 'sent_back') ? 'open' : state;

  if (shown === 'none' && !(isOwner && canSubmit)) return null;

  const send = async () => {
    const text = summary.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/review/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          gate: '结论',
          subject: reportPath,
          summary: text,
          focus: [],
        }),
      });
      if (!res.ok) {
        setError(await readError(res, '提交失败，请重试'));
        return;
      }
      setOpen(false);
      setDone(true);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const submitButton = (
    <>
      <Button type="button" size="sm" data-testid="submit-report" onClick={() => setOpen(true)}>
        报告没问题，提交给 {reviewer} →
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>提交给 {reviewer} 确认</DialogTitle>
            <DialogDescription>他确认后，这份报告会放进项目文件，同一项目的别的 Workspace 能看到。</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">要他看什么（摘要）</span>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
          </label>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button
              type="button"
              data-testid="submit-report-confirm"
              onClick={() => void send()}
              disabled={!summary.trim() || submitting}
            >
              提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return (
    <div data-testid="report-review-box" data-state={shown} className="m-3 space-y-3 rounded-lg border bg-card p-4 text-sm">
      {shown === 'confirmed' ? (
        <p>✓ {reviewer} 已确认，这份报告已放进项目文件</p>
      ) : shown === 'open' ? (
        <>
          <p data-testid="report-review-open">已提交给 {reviewer}，等确认</p>
          {panel}
        </>
      ) : shown === 'sent_back' ? (
        <>
          <p>{reviewer} 有意见，改完可以再提交</p>
          {isOwner && canSubmit ? submitButton : null}
        </>
      ) : (
        submitButton
      )}
    </div>
  );
}
