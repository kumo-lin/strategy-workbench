'use client';

import { Bot, User } from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusBadge } from '@/components/ui/status-badge';
import { Markdown } from '@/components/workspace/markdown';
import { cn } from '@/lib/utils';
import type { PlanDoc } from '@/lib/workplan/plan-doc';
import type { WorkplanChangeView, WorkplanVersionView } from '@/lib/workplan/view';
import { LEGACY_WORKPLAN_NOTE } from '@/lib/workplan/workplan-tree';

export interface WorkplanPanelProps {
  versions: WorkplanVersionView[]; // 按 version 升序
  /** 先打开哪个版本，默认最新。 */
  initialVersion?: number;
}

const MARKER_CHIP =
  'rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';

/** 意图 / 修改 / 引用块，卡片与 popover 共用；`compact` 用于浮层里的紧凑排版。 */
function ChangeFields({
  change,
  compact = false,
}: {
  change: WorkplanChangeView;
  compact?: boolean;
}): JSX.Element {
  const body = compact ? 'text-xs' : 'text-sm';
  const label = compact ? 'text-[10px]' : 'text-xs';
  const quote = compact ? 'border-l-2 pl-2' : 'border-l-2 pl-3';

  return (
    <>
      {change.commentText ? (
        <blockquote className={cn(quote, body, 'text-muted-foreground')}>
          {change.commentText}
        </blockquote>
      ) : (
        <p className={cn(body, 'text-muted-foreground')}>（找不到这条 comment）</p>
      )}
      <div className="space-y-0.5">
        <h4 className={cn(label, 'font-medium text-muted-foreground')}>我们理解的意图</h4>
        <p className={cn(body, 'text-foreground')}>{change.intent}</p>
      </div>
      <div className="space-y-0.5">
        <h4 className={cn(label, 'font-medium text-muted-foreground')}>修改</h4>
        <p className={cn(body, 'text-foreground')}>{change.change}</p>
      </div>
    </>
  );
}

/** "G1 2026-10-25" → "2026-10-25": the day the opinion was asked. */
const dateOf = (reviewName: string | null) => /\d{4}-\d{2}-\d{2}/.exec(reviewName ?? '')?.[0] ?? '';

/** D-64 T35 (ui-2): the plan as a document — 要回答的问题, 要支撑的决策, 初步判断, then 分支 → 子问题 → 初始假设（待验证）. */
function PlanDocView({ doc }: { doc: PlanDoc }): JSX.Element {
  const section = (title: string, text: string) => (
    <div className="space-y-0.5">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <p className="text-sm">{text}</p>
    </div>
  );
  return (
    <div data-testid="plan-doc" className="space-y-3">
      {section('要回答的问题', doc.question)}
      {section('要支撑的决策', doc.decision)}
      {section('初步判断', doc.day1)}
      {doc.keyLine ? <p className="text-sm font-medium">{doc.keyLine}</p> : null}
      {doc.branches.map((b) => (
        <section key={b.label} className="space-y-2 rounded-md border p-2.5">
          <p className="text-sm">
            <span className="text-xs text-muted-foreground">分支 {b.label} · </span>
            {b.question}
          </p>
          <ul className="space-y-2">
            {b.children.map((c) => (
              <li key={c.label} className="space-y-0.5 text-sm">
                <p>
                  <span className="text-xs text-muted-foreground">子问题 {c.label} · </span>
                  {c.question}
                </p>
                <p>
                  <span className="text-xs text-muted-foreground">初始假设（待验证）：</span>
                  {c.hypothesis}
                </p>
                {c.key ? (
                  <p data-testid="knockout-line" data-key={c.key} className="text-xs text-amber-800 dark:text-amber-300">
                    {c.key} Knock-out（P0）：结果不理想就会改变 2027 年产品战略{c.ifBad ? `（${c.ifBad}）` : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ChangeCard({ change }: { change: WorkplanChangeView }): JSX.Element {
  return (
    <article
      data-testid="change-card"
      data-traced={String(change.traced)}
      className={cn(
        'space-y-2 rounded-lg border bg-card p-2.5',
        !change.traced && 'border-destructive/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          {change.commentId ?? '?'}
        </span>
        {change.commentAuthor ? (
          <span className="text-foreground">
            对应意见 {change.commentAuthor}
            {dateOf(change.reviewName) ? ` · ${dateOf(change.reviewName)}` : ''}
          </span>
        ) : null}
        {!change.traced ? (
          <span className="ml-auto rounded border border-destructive/40 px-1.5 py-0.5 text-[10px] text-destructive">
            无法追溯到 comment
          </span>
        ) : null}
      </div>
      <ChangeFields change={change} />
    </article>
  );
}

export function WorkplanPanel({ versions, initialVersion }: WorkplanPanelProps): JSX.Element {
  const [selected, setSelected] = useState<number | null>(() => initialVersion ?? null);
  const [compare, setCompare] = useState(true);

  if (versions.length === 0) {
    return (
      <div
        data-testid="workplan-panel"
        className="flex h-full items-center justify-center p-6 text-center"
      >
        <p className="text-sm text-muted-foreground">还没有研究计划。和 AI 对话共创第一版。</p>
      </div>
    );
  }

  const latest = versions[versions.length - 1];
  const current = versions.find((v) => v.version === selected) ?? latest;
  const diffAvailable = current.version > 1 && current.changedLines.length > 0;
  const showDiff = diffAvailable && compare;
  const highlightLines = showDiff ? current.changedLines : [];

  const renderMarker = (id: string): ReactNode => {
    const change = current.changes.find((c) => c.commentId === id);
    if (!change) {
      return (
        <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
          {id}（无对应修改）
        </span>
      );
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`查看意见 ${id} 的修改说明`}
            className={cn(
              MARKER_CHIP,
              'cursor-pointer align-baseline transition-colors hover:bg-amber-200 dark:hover:bg-amber-900/60',
            )}
          >
            ← {id}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {change.commentId ?? '?'}
            </span>
            {change.commentAuthor ? (
              <span className="font-medium text-foreground">{change.commentAuthor}</span>
            ) : null}
            {change.reviewName ? (
              <span className="text-muted-foreground">· {change.reviewName}</span>
            ) : null}
          </div>
          <ChangeFields change={change} compact />
        </PopoverContent>
      </Popover>
    );
  };

  const approvedText = current.approvedBy
    ? `✓ ${current.approvedBy} 看过${current.approvedAt ? ` · ${current.approvedAt.slice(0, 10)}` : ''}`
    : null;

  return (
    <div data-testid="workplan-panel" className="flex h-full flex-col gap-3 overflow-hidden p-3">
      <div role="group" aria-label="切换研究计划版本" className="flex flex-wrap items-center gap-1">
        {versions.map((v) => {
          const isCurrent = v.version === current.version;
          const isLatest = v.version === latest.version;
          return (
            <button
              key={v.version}
              type="button"
              aria-pressed={isCurrent}
              onClick={() => setSelected(v.version)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                isCurrent
                  ? 'border-border bg-accent text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  v.status === '已确认'
                    ? 'bg-emerald-500 dark:bg-emerald-400'
                    : 'bg-sky-500 dark:bg-sky-400',
                )}
              />
              v{v.version}
              {isLatest ? (
                <span className="text-[10px] font-normal text-muted-foreground">最新</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">研究计划 v{current.version}</h3>
        {diffAvailable ? (
          <span data-testid="plan-diff-badge" className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            v{current.version - 1} → v{current.version} 已标出修改
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <StatusBadge status={current.status} />
        <span className="inline-flex items-center gap-1">
          {current.author === 'AI' ? (
            <>
              <Bot aria-hidden="true" className="size-3.5" />
              <span>AI 起草</span>
            </>
          ) : (
            <>
              <User aria-hidden="true" className="size-3.5" />
              <span className="text-foreground">{current.author}</span>
            </>
          )}
        </span>
        <span>{current.created.slice(0, 10)}</span>
        {approvedText ? (
          <span className="text-emerald-700 dark:text-emerald-400">{approvedText}</span>
        ) : (
          // 复核 P7: v2 written on the Senior's opinion said “Senior 还没看过”; say what this version is instead
          <span className="text-muted-foreground">{current.changes.length > 0 ? `已按意见修改 ${current.changes.length} 处` : '征求意见不卡流程，可以直接往下做'}</span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto">
        {current.changes.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              本版修改 · 共 {current.changes.length} 处
            </h3>
            <div className="space-y-2">
              {current.changes.map((change, index) => (
                <ChangeCard key={`${change.comment}-${index}`} change={change} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">正文</h3>
            {diffAvailable ? (
              <button
                type="button"
                aria-pressed={compare}
                onClick={() => setCompare((on) => !on)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  compare
                    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
                    : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    compare ? 'bg-amber-500 dark:bg-amber-400' : 'bg-muted-foreground/40',
                  )}
                />
                与上一版比较
              </button>
            ) : null}
          </div>
          {current.beforeQuestionTree ? (
            <p data-testid="workplan-legacy-note" className="text-xs text-muted-foreground">
              {LEGACY_WORKPLAN_NOTE}
            </p>
          ) : null}
          {current.tree ? <PlanDocView doc={current.tree} /> : null}
          <div data-testid="workplan-body" className={current.tree ? 'hidden' : undefined}>
            <Markdown
              source={current.body}
              highlightLines={highlightLines}
              renderMarker={renderMarker}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
