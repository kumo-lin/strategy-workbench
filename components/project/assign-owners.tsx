'use client';

/** D-64 T34: the Senior confirms the contract and the issue tree with its owners (确定，指派负责人). */
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';

export function AssignOwners({ project }: { project: string }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/project/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
      if (!res.ok) throw new Error('没有确认成功，请重试');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button data-testid="assign-owners" disabled={busy} onClick={confirm}>
        确定，指派负责人
      </Button>
      {error ? <span className="text-destructive text-sm">{error}</span> : null}
    </div>
  );
}
