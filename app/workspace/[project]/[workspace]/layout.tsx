import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RoleName } from '@/components/shell/role-name';
import { FlowBar } from '@/components/workflow/flow-bar';
import { NextStepBar } from '@/components/workflow/next-step-bar';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { loadProjectOverview, originOf } from '@/lib/project/overview';
import { getRoles, roleTitle } from '@/lib/session/role';
import { nextStepFor } from '@/lib/workflow/next-step';
import { loadWorkspaceFlow } from '@/lib/workflow/load';
import { locateWorkspace, type WorkspaceParams } from '@/lib/workplan/page-data';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<WorkspaceParams> }): Promise<Metadata> {
  const p = await params;
  return { title: await roleTitle(decodeURIComponent(p.workspace)) };
}

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<WorkspaceParams> }) {
  const loc = await locateWorkspace(params);
  if (!(await loc.vault.exists(`${loc.workspacePath}/workspace.md`))) notFound();
  const [overview, roles] = await Promise.all([loadProjectOverview(loc.vault, loc.project), getRoles()]);
  const origin = originOf(overview, loc.workspacePath);
  const flow = await loadWorkspaceFlow(loc.vault, loc.project, loc.workspacePath);
  const next = nextStepFor({
    facts: flow.facts,
    state: flow.state,
    actor: { name: loc.role.name },
    unhandled: flow.unhandled,
    base: loc.basePath,
    investigation: flow.investigation ? encodeURIComponent(flow.investigation.name) : null,
  });
  const ws = overview.branches.flatMap((b) => b.workspaces).concat(overview.unplaced).find((w) => w.path === loc.workspacePath);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{loc.project}</p>
          <h1 className="truncate text-lg font-semibold tracking-tight" title={loc.workspace}>
            {origin.line?.item ?? loc.workspace}
          </h1>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs" data-testid="workspace-origin">
            {origin.line ? (
              <span>来自议题树「{origin.line.title}」</span>
            ) : origin.branchNo !== null ? (
              <span>来自议题树第 {origin.branchNo} 枝{origin.topic ? ` · ${origin.topic}` : ''}</span>
            ) : (
              <span>不在议题树上</span>
            )}
            {origin.week ? <span>· {origin.week}</span> : null}
            {origin.assignedBy ? <span>· 由 {origin.assignedBy} 指派</span> : null}
            {ws ? (
              <>
                <span>·</span>
                <span>
                  负责人 <RoleName roles={roles} name={ws.owner} />
                </span>
              </>
            ) : null}
          </p>
        </div>
        <WorkspaceNav basePath={loc.basePath} />
      </div>
      <FlowBar state={flow.state} />
      <NextStepBar next={next} base={loc.basePath} />
      {children}
    </div>
  );
}
