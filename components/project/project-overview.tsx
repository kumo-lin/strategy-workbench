import { GitBranch } from 'lucide-react';
import Link from 'next/link';
import type { JSX } from 'react';
import { RoleName } from '@/components/shell/role-name';
import { StageBadge } from '@/components/workspace/stage-badge';
import type { Role } from '@/lib/config/roles';
import type { OverviewWorkspace, ProjectOverview } from '@/lib/project/overview';
import { normalizeWeek } from '@/lib/project/overview';

const href = (project: string, w: OverviewWorkspace) => `/workspace/${encodeURIComponent(project)}/${encodeURIComponent(w.name)}`;

function WorkspaceCard({ project, w, roles }: { project: string; w: OverviewWorkspace; roles: Role[] }): JSX.Element {
  return (
    <Link href={href(project, w)} className="bg-card hover:bg-accent/40 block rounded-lg border p-3" data-testid="workspace-link">
      <p className="font-medium">{w.name}</p>
      <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1 text-xs">
        负责人 <RoleName roles={roles} name={w.owner} /> · Reviewer <RoleName roles={roles} name={w.reviewer} />
        {w.assignedBy ? <span data-testid="assigned-by"> · 由 {w.assignedBy} 指派</span> : null}
      </p>
      <div className="mt-2">
        <StageBadge stage={w.stage} flags={w.flags} />
      </div>
    </Link>
  );
}

/** 第 0 步 · 拆题和分工: one project, read from 项目.md. Display only; nothing is created here. */
export function ProjectOverviewView({ overview, roles }: { overview: ProjectOverview; roles: Role[] }): JSX.Element {
  const o = overview;
  const now = o.currentWeek;
  return (
    <section className="space-y-4" data-testid="project-overview" aria-label={o.project}>
      <h2 className="text-muted-foreground text-sm">{o.project}</h2>

      {o.hasProjectNote ? (
        <div className="rounded-lg border border-violet-500/30 bg-violet-50 p-3 dark:bg-violet-500/10" data-testid="step0-banner">
          <p className="text-sm font-semibold">第 0 步 · 拆题和分工</p>
          <p className="text-muted-foreground mt-0.5 text-sm">Senior 和 AI 把顶层问题拆成议题树，分成 Workspace，指派负责人和 reviewer。</p>
          <p className="mt-1 text-sm">
            {o.confirmed ? `已由 ${o.owner || 'Senior'} 确认` : '尚未确认'}
            {o.confirmedAt ? ` · ${o.confirmedAt}` : ''}
            {o.derivedFrom.length ? ` · 依据：${o.derivedFrom.join('、')}` : ''}
          </p>
        </div>
      ) : null}

      {o.coreQuestion ? (
        <div className="bg-card space-y-1 rounded-lg border p-3" data-testid="project-question">
          <p className="text-xs font-medium text-muted-foreground">顶层问题</p>
          <p className="text-base font-medium">{o.coreQuestion}</p>
          {o.decision ? (
            <>
              <p className="text-muted-foreground pt-1 text-xs font-medium">要支撑的决策</p>
              <p className="text-sm">{o.decision}</p>
            </>
          ) : null}
        </div>
      ) : null}

      {o.branches.length ? (
        <div className="space-y-2" data-testid="issue-tree">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <GitBranch className="size-4" aria-hidden="true" /> 议题树 · 第一层 {o.branches.length} 枝
          </h3>
          <ol className="space-y-2">
            {o.branches.map((b) => (
              <li key={b.no} className="bg-card rounded-lg border p-3" data-testid="issue-branch">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold">枝 {b.no} · {b.title}</span>
                  <span className="text-muted-foreground text-xs">{b.week}</span>
                  {now && normalizeWeek(b.week) === now ? <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">现在</span> : null}
                </div>
                <p className="text-muted-foreground mt-0.5 text-sm">{b.asks}</p>
                {b.workspaces.length ? (
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {b.workspaces.map((w) => (
                      <li key={w.path}>
                        <WorkspaceCard project={o.project} w={w} roles={roles} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground mt-2 rounded-md border border-dashed px-3 py-2 text-xs">Workspace 待建（还没开工，不画占位卡）</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {o.unplaced.length ? (
        <div className="space-y-2" data-testid="unplaced-workspaces">
          {o.branches.length ? <h3 className="text-sm font-semibold">不在议题树上的 Workspace</h3> : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {o.unplaced.map((w) => (
              <li key={w.path}>
                <WorkspaceCard project={o.project} w={w} roles={roles} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
