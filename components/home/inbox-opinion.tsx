'use client';

/** D-64 T32 (ui-2b): an opinion on a research plan, from the inbox. Sending one never blocks the analyst. */
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';

export function InboxOpinion({ reviewPath }: { reviewPath: string }): JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const finish = async (withOpinion: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (withOpinion) {
        const c = await post('/api/workspace/review/comment', { reviewPath, text: text.trim() });
        if (!c.ok) throw new Error('意见没有发出去，请重试');
      }
      const d = await post('/api/workspace/review/decision', { reviewPath, decision: withOpinion ? 'reject' : 'approve' });
      if (!d.ok) throw new Error('没有记下来，请重试');
      router.push('/inbox');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="opinion-input">
        你的意见
      </label>
      <textarea id="opinion-input" data-testid="opinion-input" className="bg-background w-full rounded-md border p-2 text-sm" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" data-testid="opinion-later" disabled={busy} onClick={() => router.push('/inbox')}>
          稍后
        </Button>
        <Button variant="outline" data-testid="opinion-none" disabled={busy} onClick={() => finish(false)}>
          看过了，没有意见
        </Button>
        <Button data-testid="opinion-send" disabled={busy || !text.trim()} onClick={() => finish(true)}>
          发送意见
        </Button>
      </div>
    </div>
  );
}
