/** 项目页（第 0 步）：顶层问题、议题树、路线图、依赖；议题树每一枝挂着它的 Workspace。`/` 和 `/workspace` 是同一页。 */
import { HomeVaultTree } from '@/components/vault/home-vault-tree';
import { ProjectOverviewView } from '@/components/project/project-overview';
import { getRoles } from '@/lib/session/role';
import { loadProjectOverview } from '@/lib/project/overview';
import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

export default async function ProjectPage() {
  const vault = getVault();
  const [projects, roles, tree] = await Promise.all([vault.list('20_项目'), getRoles(), vault.tree()]);
  const overviews = await Promise.all(projects.filter((e) => e.kind === 'dir').map((p) => loadProjectOverview(vault, p.name)));
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">项目</h1>
      {overviews.map((o) => (
        <ProjectOverviewView key={o.project} overview={o} roles={roles} />
      ))}
      <details className="bg-card rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">vault 目录（数据层、semantic 层和配置的全部笔记）</summary>
        <div className="mt-2" data-testid="vault-tree">
          <HomeVaultTree nodes={tree} />
        </div>
      </details>
    </div>
  );
}
