'use client';

import { ArrowRight, Hourglass } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NextStep, NextStepAction } from '@/lib/workflow/next-step';

/** The page-level events the workplan page listens for (the chat lives there, not in the layout). */
export const WORKPLAN_ACTION_EVENT = 'sw:workplan-action';

/** The one button of a row: an event on this page, a link to the workplan page for it, or a link elsewhere. */
function ActionButton({ action, base, here, testId }: { action: NextStepAction; base: string; here: boolean; testId: string }): JSX.Element | null {
  if (action.kind === 'event') {
    return here ? (
      <Button type="button" size="sm" data-testid={testId} onClick={() => window.dispatchEvent(new CustomEvent(WORKPLAN_ACTION_EVENT, { detail: action.event }))}>
        {action.label}
      </Button>
    ) : (
      <Button asChild size="sm" data-testid={testId}>
        <Link href={base}>去研究计划页：{action.label}</Link>
      </Button>
    );
  }
  return here ? null : (
    <Button asChild size="sm" data-testid={testId}>
      <Link href={action.href}>{action.label}</Link>
    </Button>
  );
}

/** One sentence at the top of a Workspace page: what is next and whose turn it is; the button only when it is yours. */
export function NextStepBar({ next, base }: { next: NextStep; base: string }): JSX.Element {
  const pathname = usePathname();
  const action = next.action;
  const here = action ? (action.page === 'workplan' ? pathname === base : pathname.startsWith(`${base}/${action.page}`)) : false;
  const aside = next.aside;
  const asideHere = aside?.action ? (aside.action.page === 'workplan' ? pathname === base : pathname.startsWith(`${base}/${aside.action.page}`)) : false;
  return (
    <div
      data-testid="next-step"
      data-turn={next.turn}
      data-step={next.step}
      className={cn('flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm', next.turn === 'mine' ? 'border-primary/50 bg-primary/5' : 'bg-muted/30')}
    >
      <div className="flex flex-wrap items-center gap-2">
        {next.turn === 'waiting' ? <Hourglass className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" />}
        <span className="min-w-0 flex-1">{next.text}</span>
        {next.turn === 'mine' && action ? <ActionButton action={action} base={base} here={here} testId="next-step-action" /> : null}
      </div>
      {aside ? (
        <div data-testid="next-step-aside" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{aside.text}</span>
          {aside.action ? <ActionButton action={aside.action} base={base} here={asideHere} testId="next-step-aside-action" /> : null}
        </div>
      ) : null}
    </div>
  );
}
