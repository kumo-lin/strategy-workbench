/** D-64 T34 (ui-1): the decision contract on top, the issue tree's lines left to right, each item with where it is. */
import Link from 'next/link';
import type { JSX } from 'react';
import type { Role } from '@/lib/config/roles';
import type { ProjectPage } from '@/lib/project/contract';
import { cn } from '@/lib/utils';
import { AssignOwners } from './assign-owners';

const STATUS_CLASS = { todo: 'text-muted-foreground', active: 'text-sky-700 dark:text-sky-300', waiting: 'text-amber-700 dark:text-amber-300', done: 'text-emerald-700 dark:text-emerald-300' } as const;

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{value || '—'}</dd>
    </div>
  );
}

export function ProjectPageView({ page, roles, actor }: { page: ProjectPage; roles: Role[]; actor: Role }): JSX.Element {
  const c = page.contract;
  const nameOf = (id: string | null) => (id ? (roles.find((r) => r.id === id)?.name ?? id) : '未指派');
  const ws = (name: string) => `/workspace/${encodeURIComponent(page.project)}/${encodeURIComponent(name)}`;
  return (
    <section className="space-y-4" aria-label={page.project}>
      <h1 className="text-lg font-semibold">{page.project}</h1>
      {c ? (
        <div className="bg-card space-y-3 rounded-lg border p-4" data-testid="contract-card" data-status={c.status}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">决策契约</h2>
            <span className="text-muted-foreground text-xs">{c.status === '已确认' ? `已确认 · ${c.approved_by ?? ''} · ${c.approved_at ?? ''}` : 'AI 起草 · 等 Senior 确认'}</span>
          </div>
          <p className="text-sm font-medium">{c.question}</p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Field label="原题" value={c.original_question ?? ''} />
            <Field label="决策负责人" value={c.decision_owner} />
            <Field label="时间" value={c.horizon} />
            <Field label="要做的决定" value={c.decision} />
            <Field label="地域" value={c.geography} />
            <Field label="产品范围" value={c.product_scope} />
            <Field label="不研究" value={c.out_of_scope.join('、')} />
          </dl>
        </div>
      ) : null}
      {page.tree ? (
        <div className="bg-card space-y-3 rounded-lg border p-4" data-testid="issue-tree">
          <h2 className="font-medium">议题树与工作线</h2>
          <p className="text-sm">
            <span className="text-muted-foreground">要回答的问题：</span>
            {page.tree.question}
          </p>
          <div className="grid gap-3 md:grid-flow-col md:auto-cols-fr">
            {page.tree.lines.map((l) => (
              <div key={l.id} className="space-y-2 rounded-md border p-3" data-testid="issue-line" data-line={l.id}>
                <p className="text-sm font-medium">
                  {l.id} {l.title}
                </p>
                <p className="text-muted-foreground text-xs">
                  {l.question} · {nameOf(l.owner)}
                </p>
                <ul className="space-y-1">
                  {l.items.map((it) => (
                    <li key={it.id} className="flex items-center gap-2 text-sm" data-testid="issue-item" data-item={it.id} data-status={it.status}>
                      {it.workspace ? (
                        <Link href={ws(it.workspace)} className="hover:underline">
                          {it.id} {it.title}
                        </Link>
                      ) : (
                        <span>
                          {it.id} {it.title}
                        </span>
                      )}
                      <span className={cn('ml-auto text-xs', STATUS_CLASS[it.status])}>{it.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {actor.kind === 'senior' && c && c.status !== '已确认' ? <AssignOwners project={page.project} /> : null}
        </div>
      ) : null}
    </section>
  );
}
