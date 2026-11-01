'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
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
import { suggestSend } from '@/lib/workplan/send-draft';

const apiErrorSchema = z.object({ error: z.string(), message: z.string() });

export interface SendForOpinionProps {
  workspacePath: string;
  /** The vault path of the latest workplan version. */
  subject: string;
  version: number;
  body: string;
  reviewer: string;
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

/** "发给 {reviewer} 征求意见" without going through the chat: the dialog is prefilled from the workplan body. */
export function SendForOpinion({ workspacePath, subject, body, reviewer }: SendForOpinionProps): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(() => suggestSend(body).summary);
  const [focus, setFocus] = useState(() => suggestSend(body).focus.join('\n'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          gate: 'G1',
          subject,
          summary: text,
          focus: focus
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 8)
            .map((line) => line.slice(0, 500)),
        }),
      });
      if (!res.ok) {
        setError(await readError(res, '提交失败，请重试'));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button type="button" size="sm" className="ml-auto" data-testid="ask-senior" onClick={() => setOpen(true)}>
        请 {reviewer} 提意见
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="send-for-opinion-dialog">
          <DialogHeader>
            <DialogTitle>发给 {reviewer} 征求意见</DialogTitle>
            <DialogDescription>他看完给意见就行，不会挡你往下做。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-muted-foreground text-xs">要他看什么（摘要）</span>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
            </label>
            <label className="block space-y-1">
              <span className="text-muted-foreground text-xs">请他重点看（一行一条，最多 8 条）</span>
              <Textarea value={focus} onChange={(e) => setFocus(e.target.value)} rows={4} />
            </label>
          </div>
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
              data-testid="send-for-opinion-confirm"
              onClick={() => void send()}
              disabled={!summary.trim() || submitting}
            >
              发出去
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
