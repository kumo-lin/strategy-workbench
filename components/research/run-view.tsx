'use client';

import { CheckCircle2, ChevronRight, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type { JSX } from 'react';
import { ToolCard } from '@/components/chat/tool-card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SearchCardEvent, StepEvent } from '@/lib/research/progress';
import type { GroupStatus, RunGroup } from './run-groups';

export interface RunViewProps {
  groups: RunGroup[];
  steps: StepEvent[];
  /** D-64 T38: the search-and-judgment cards (T26). */
  cards?: SearchCardEvent[];
  running: boolean;
  /** Seconds since the run began; undefined when the page does not know. */
  elapsedSec?: number;
  /** "试水调查" / "完整调查" */
  modeName: string;
  /** What the run covers, e.g. "只查 H1". */
  scope: string;
  /** e.g. "计划 v2" */
  planName: string;
  /** "约 3–4 分钟" */
  usual: string;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const SEGMENT: Record<GroupStatus, string> = {
  todo: 'bg-muted-foreground/20',
  running: 'bg-primary animate-pulse',
  waiting: 'bg-amber-400',
  done: 'bg-emerald-500',
  failed: 'bg-destructive',
};

function StepIcon({ status }: { status: StepEvent['status'] }): JSX.Element {
  if (status === 'running') return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />;
  if (status === 'waiting') return <Circle className="size-3.5 shrink-0 text-amber-500" aria-hidden="true" />;
  if (status === 'failed') return <XCircle className="text-destructive size-3.5 shrink-0" aria-hidden="true" />;
  if (status === 'skipped') return <MinusCircle className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />;
  return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />;
}

function GroupIcon({ status }: { status: GroupStatus }): JSX.Element {
  if (status === 'running') return <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />;
  if (status === 'waiting') return <span className="shrink-0 text-xs font-medium text-amber-600">等你确认</span>;
  if (status === 'failed') return <XCircle className="text-destructive size-4 shrink-0" aria-hidden="true" />;
  if (status === 'done') return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />;
  return <Circle className="text-muted-foreground/50 size-4 shrink-0" aria-hidden="true" />;
}

/** The run: a header with the clock, nine segments, and one folded section per step with its own tool cards. */
export function RunView({ groups, steps, cards = [], running, elapsedSec, modeName, scope, planName, usual }: RunViewProps): JSX.Element {
  if (steps.length === 0) {
    return <p className="text-muted-foreground text-sm">还没有开始。批准调查计划后，这里会按 9 步显示进度。</p>;
  }
  const now = [...steps].reverse().find((s) => s.status === 'running');
  return (
    <div className="space-y-3" data-testid="run-view">
      <div className="space-y-2 rounded-lg border p-3" data-testid="run-progress" data-running={running ? 'true' : 'false'}>
        <p className="flex flex-wrap items-baseline gap-2 text-sm font-medium">
          <span>执行</span>
          <span className="text-muted-foreground text-xs font-normal">每一步都留痕，可点开</span>
        </p>
        <p className="text-sm">
          {modeName}
          {running ? '进行中' : '的执行过程'} · {scope} · 按 {planName}
          {elapsedSec !== undefined ? ` · ${running ? '已用' : '用时'} ${mmss(elapsedSec)}` : ''}
          {running ? ` · 通常${usual}` : ''}
        </p>
        <ol className="grid grid-cols-9 gap-1" aria-label="9 步进度">
          {groups.map((g) => (
            <li key={g.n} data-testid="run-segment" data-status={g.status} title={`步骤 ${g.n} · ${g.name}`} className="space-y-0.5">
              <div className={cn('h-1.5 rounded-full', SEGMENT[g.status])} />
              <p className={cn('truncate text-center text-[11px]', g.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground')}>{g.name}</p>
            </li>
          ))}
        </ol>
        {running && now ? <p className="text-muted-foreground text-xs">正在做：{now.title}</p> : null}
      </div>

      <div className="space-y-1.5" data-testid="run-steps">
        {groups
          .filter((g) => g.steps.length || g.tools.length)
          .map((g) => (
            <details key={g.n} data-testid="run-group" data-step={g.n} data-status={g.status} open={g.n === 2 && g.decisionReads > 0} className="group/run rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/run:rotate-90" aria-hidden="true" />
                <GroupIcon status={g.status} />
                <span className="font-medium">
                  步骤 {g.n} · {g.name}
                </span>
                {g.tools.length ? (
                  <span className="text-muted-foreground text-xs">
                    {g.tools.length} 次调用
                    {g.n === 2 && g.decisionReads > 0 ? `，其中 ${g.decisionReads} 条是已确认的决定` : ''}
                  </span>
                ) : null}
                {g.decisionReads > 0 ? (
                  <Badge variant="default" className="ml-auto" data-testid="decisions-used">
                    用到了已确认的决定 ×{g.decisionReads}
                  </Badge>
                ) : null}
              </summary>
              <div className="space-y-2 border-t px-3 py-2">
                <ul className="space-y-1">
                  {g.steps.map((s) => (
                    <li key={s.id} data-testid="run-step" data-status={s.status} className="flex items-start gap-2 text-xs">
                      <StepIcon status={s.status} />
                      <span>
                        <span className="text-muted-foreground mr-1.5">步骤 {s.step}</span>
                        <span className={cn(s.status === 'failed' && 'text-destructive')}>{s.title}</span>
                        {s.detail || s.status === 'skipped' ? (
                          <span className="text-muted-foreground block">{s.status === 'skipped' ? `跳过：${s.detail ?? '这次不需要'}` : s.detail}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                {g.tools.map((t) => (
                  <ToolCard key={t.key} toolName={t.name} state={t.state} input={t.input} output={t.output} errorText={t.errorText} />
                ))}
              </div>
            </details>
          ))}
      </div>
      {cards.length ? (
        <section className="space-y-1.5" aria-label="检索与判断卡片">
          <h3 className="text-sm font-medium">检索与判断卡片</h3>
          <ul className="space-y-1.5">
            {cards.map((c) => (
              <li key={`${c.n}-${c.stop ? 'stop' : c.source}-${c.subQuestion}`} data-testid="search-card" data-source={c.source} data-stop={c.stop ? 'true' : undefined} className={cn('rounded-md border p-2 text-xs', c.stop && 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40')}>
                {c.stop ? (
                  <p className="font-medium">
                    {c.question ?? c.subQuestion} · {c.judgment}
                  </p>
                ) : (
                  <>
                    <p className="text-muted-foreground">
                      第 {c.n} 次检索 · {c.source === 'files' ? '文件管理' : '上网'} · {c.question ?? c.subQuestion}
                    </p>
                    <p>
                      查“{c.query}” → {c.results} 条结果；{c.judgment}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
