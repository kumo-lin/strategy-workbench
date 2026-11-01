'use client';

/** D-64 T42 (ui-4f): project outputs, with an explicit human-only publish action. */
import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toFieldText } from '@/components/decision/format';
import type { StoredOutput } from '@/lib/research/stored-outputs';

export function StoredOutputs({ items, canPublish }: { items: StoredOutput[]; canPublish: boolean }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publish = async (path: string) => {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch('/api/asset/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setError(data.message ?? '没有发布成功，请重试');
      } else router.refresh();
    } catch {
      setError('没有发布成功，请检查网络后重试');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="space-y-3 p-3" data-testid="stored-list">
      <h2 className="text-sm font-semibold">存入项目文件的 项目产出</h2>
      <p className="text-muted-foreground text-sm">同一项目里的其他工作区看得到；尚未发布的产出不会出现在其他项目。</p>
      {items.map((item) => (
        <article key={item.path} data-testid="stored-item" data-kind={item.kind} className="space-y-2 rounded-lg border p-3">
          <a href={item.href} className="text-sm font-medium underline">{toFieldText(item.name)}</a>
          <p className="text-muted-foreground text-xs">{item.confirmedBy} · {item.confirmedAt}{item.simulated ? ' · 模拟访谈' : ''}</p>
          {item.published ? <p className="text-muted-foreground text-xs">已发布为公司资产</p> : canPublish && item.kind !== '访谈' ? (
            <Button data-testid="publish-asset" variant="outline" size="sm" disabled={busy !== null} onClick={() => void publish(item.path)}>
              {busy === item.path ? '发布中…' : '发布为公司资产'}
            </Button>
          ) : null}
        </article>
      ))}
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
    </section>
  );
}
