'use client';

/**
 * The one dialog that starts an investigation, for both ways in: approving a plan ("批准并开始调查…") and running an
 * approved plan again ("跑完整调查…"). The mode is chosen here, once, and travels with the request (UI/UX 方案 #6, #25):
 * there is no other mode control on the page, so there is nothing for a reload to reset.
 */
import type { JSX, ReactNode } from 'react';
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
import type { ResearchMode } from '@/lib/research/constants';
import { MODE_COMMON, MODE_NAME, MODE_TIME, modeFacts } from '@/lib/research/mode-copy';
import { cn } from '@/lib/utils';

export interface RunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  mode: ResearchMode;
  onModeChange: (m: ResearchMode) => void;
  /** What a 试水调查 covers, e.g. "H1". */
  firstHypothesis: string;
  /** The "会发生" list; gets the chosen mode's usual time. */
  happens: (usual: string) => ReactNode[];
  happensTitle: string;
  confirmLabel: (modeName: string) => string;
  busy?: boolean;
  onConfirm: () => void;
}

export function RunDialog(p: RunDialogProps): JSX.Element {
  const usual = MODE_TIME[p.mode];
  return (
    <AlertDialog open={p.open} onOpenChange={p.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p.title}</AlertDialogTitle>
          <AlertDialogDescription>{p.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="调查范围">
            {(['small', 'full'] as const).map((m) => {
              const facts = modeFacts(m, p.firstHypothesis);
              const chosen = p.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  data-testid={`run-option-${m}`}
                  onClick={() => p.onModeChange(m)}
                  className={cn('rounded-md border px-3 py-2 text-left', chosen ? 'border-primary/60 bg-primary/5' : 'text-muted-foreground hover:bg-accent/40')}
                >
                  <span className="block font-medium text-foreground">
                    {chosen ? '● ' : '○ '}
                    {MODE_NAME[m]} · {MODE_TIME[m]}
                    {m === 'small' ? '（默认）' : ''}
                  </span>
                  <span className="block text-xs">查哪些：{facts.scope}；{facts.web}。</span>
                  <span className="block text-xs">什么时候用：{facts.when}</span>
                </button>
              );
            })}
            <p className="text-xs text-muted-foreground">{MODE_COMMON}</p>
          </div>
          <div>
            <p className="font-medium">{p.happensTitle}</p>
            <ol className="list-decimal pl-5 text-xs text-muted-foreground">
              {p.happens(usual).map((li, i) => (
                <li key={i}>{li}</li>
              ))}
            </ol>
          </div>
          <p data-testid="approve-mode" className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
            将以 <strong className="font-semibold">{MODE_NAME[p.mode]}</strong> 开始
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction disabled={p.busy} onClick={p.onConfirm}>
            {p.confirmLabel(MODE_NAME[p.mode])}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
