'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function NewResearchForm({ workspacePath, canCreate, owner, base }: { workspacePath: string; canCreate: boolean; owner: string; base: string }): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/research/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath, name }) });
      const json = (await res.json()) as { researchDir?: string; error?: string };
      if (!res.ok || !json.researchDir) throw new Error(json.error ?? `HTTP ${res.status}`);
      router.push(`${base}/${encodeURIComponent(json.researchDir.split('/').pop()!)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !busy) void create();
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="新调查的名字，例如：IT 可管理性" className="max-w-xs" disabled={!canCreate || busy} aria-label="新调查的名字" />
      <Button type="submit" disabled={!canCreate || busy || !name.trim()}>
        新建调查
      </Button>
      {!canCreate && <span className="text-muted-foreground text-xs">只有 Workspace 的负责人（{owner}）可以新建调查</span>}
      {error && <span className="text-destructive text-xs">{error}</span>}
    </form>
  );
}
