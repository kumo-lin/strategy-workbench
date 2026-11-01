/** D-64 T33 (ui-0b): 新建项目 — the decision contract and the issue tree start empty; the AI drafts them in the chat. */
import { FramingChat } from '@/components/project/framing-chat';
import { ProjectPageView } from '@/components/project/project-page';
import { loadProjectPage } from '@/lib/project/contract';
import { getCurrentRole, getRoles } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ project?: string; q?: string }> }) {
  const { project, q } = await searchParams;
  const vault = getVault();
  const [actor, roles] = await Promise.all([getCurrentRole(), getRoles()]);
  const exists = project ? await vault.exists(`20_项目/${project}/项目.md`) : false;
  const page = exists && project ? await loadProjectPage(vault, project) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{exists ? project : '未命名项目'}</h1>
          <span className="text-muted-foreground rounded border px-1.5 text-xs">草稿</span>
        </div>
        {page?.contract ? null : (
          <div className="bg-card space-y-2 rounded-lg border p-4" data-testid="contract-empty">
            <h2 className="font-medium">决策契约</h2>
            <p className="text-muted-foreground text-sm">【待输入 Main Question，定义要支持的决策】</p>
          </div>
        )}
        {page?.tree ? null : (
          <div className="bg-card space-y-2 rounded-lg border p-4" data-testid="tree-empty">
            <h2 className="font-medium">议题树与工作线</h2>
            <p className="text-muted-foreground text-sm">【待输入 Main Question 进行 Workstream 拆解】</p>
          </div>
        )}
        {page && (page.contract || page.tree) ? <ProjectPageView page={page} roles={roles} actor={actor} /> : null}
      </div>
      <FramingChat key={exists ? project : 'new'} project={exists ? (project ?? null) : null} firstMessage={exists ? q : undefined} actorName={actor.name} canFrame={actor.kind === 'senior'} />
    </div>
  );
}
