'use client';

/** D-64 T35: 研究计划定了，往下做调查计划 → — the owner says the plan is final and goes on to the investigation plan. */
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';

export function PlanFinalButton({ workspacePath, researchHref }: { workspacePath: string; researchHref: string }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/plan-final', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath }) });
      if (!res.ok) throw new Error('没有记下来，请重试');
      router.push(researchHref);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误，请重试');
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" data-testid="plan-final" disabled={busy} onClick={go}>
        研究计划定了，往下做调查计划 →
      </Button>
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
    </span>
  );
}
