'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { setRole } from '@/app/actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Role } from '@/lib/config/roles';

export function RoleSwitcher({ roles, current, locked = false }: { roles: Role[]; current: string; locked?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hint, setHint] = useState(false);
  // The web address names the role (`junior-b.localhost`): this window cannot change it.
  if (locked) {
    const name = roles.find((r) => r.id === current)?.name ?? current;
    return (
      <button
        type="button"
        data-testid="role-lock"
        aria-label={`本窗口固定为 ${name}`}
        title="要换角色，请用对应网址的窗口"
        onClick={() => setHint((h) => !h)}
        className="text-muted-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
      >
        <Lock className="size-3.5" aria-hidden="true" />
        本窗口
        {hint ? <span className="text-foreground ml-1" data-testid="role-lock-hint">要换角色，请用对应网址的窗口</span> : null}
      </button>
    );
  }
  return (
    <Select
      value={current}
      disabled={pending}
      onValueChange={(id) =>
        startTransition(async () => {
          await setRole(id);
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="min-w-36" aria-label="当前角色" data-testid="role-switcher">
        <UserRound className="size-4 opacity-60" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {roles.map((r) => (
          <SelectItem key={r.id} value={r.id} data-testid={`role-option-${r.id}`}>
            {r.name}
            <span className="text-muted-foreground ml-1 text-xs">{r.kind === 'senior' ? '审批' : '执行'}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
