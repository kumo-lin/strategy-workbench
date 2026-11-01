'use client';

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
import { Button } from '@/components/ui/button';

const apiErrorSchema = z.object({ error: z.string(), message: z.string() });

export interface RedoButtonProps {
  workspacePath: string;
  /** The version the next write will go to. */
  nextVersion: number;
  /** Called after the request is recorded, to start the new co-creation in the chat. */
  onRedone: () => void;
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

/** "重新做一版": keeps the old workplan and asks for a new version. */
export function RedoButton({ workspacePath, nextVersion, onRedone }: RedoButtonProps): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redo = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/workplan/redo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath }),
      });
      if (!res.ok) {
        setError(await readError(res, '重新做一版失败，请重试'));
        return;
      }
      onRedone();
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        重新做一版
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新做一版研究计划？</AlertDialogTitle>
            <AlertDialogDescription>
              旧版本会保留。重新做出来的会存成 v{nextVersion}，你可以回头比较。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => {
                void redo();
              }}
            >
              确认重新做
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
