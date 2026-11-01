import { Check } from 'lucide-react';
import type { JSX } from 'react';
import { FLOW_STEPS, stepStatus, type FlowState } from '@/lib/workflow/steps';
import { cn } from '@/lib/utils';

/** The Workspace's 7 steps (D-64 T30): each cell names its step and who does it; the current one says whose turn it is. */
export function FlowBar({ state }: { state: FlowState }): JSX.Element {
  return (
    <ol data-testid="flow-bar" data-current={state.current} className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-7" aria-label="工作流：7 步">
      {FLOW_STEPS.map((step) => {
        const status = stepStatus(state, step.n);
        const current = status === 'current';
        return (
          <li
            key={step.n}
            data-step={step.n}
            data-status={status}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'flex min-w-0 flex-col rounded-md border px-2 py-1 text-xs',
              current ? 'border-primary bg-primary/10 text-foreground' : status === 'done' ? 'bg-muted/40 text-muted-foreground' : 'text-muted-foreground/70',
            )}
          >
            <span className={cn('flex items-center gap-1', current && 'font-medium')}>
              {status === 'done' ? <Check className="size-3 shrink-0 text-emerald-600" aria-hidden="true" /> : null}
              {step.n} {step.name}
            </span>
            <span className="truncate text-[11px]">{current && state.who ? `轮到 ${state.who}` : state.cellWho[step.n - 1]}</span>
          </li>
        );
      })}
    </ol>
  );
}
