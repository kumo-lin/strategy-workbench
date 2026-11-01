/** D-64 T34 (ui-1): a project's page. A project without an issue tree keeps the older overview. */
import { notFound } from 'next/navigation';
import { ProjectOverviewView } from '@/components/project/project-overview';
import { ProjectPageView } from '@/components/project/project-page';
import { loadProjectPage } from '@/lib/project/contract';
import { loadProjectOverview } from '@/lib/project/overview';
import { getCurrentRole, getRoles } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name);
  const vault = getVault();
  if (!(await vault.exists(`20_项目/${name}/项目.md`))) notFound();
  const [page, roles, actor] = await Promise.all([loadProjectPage(vault, name), getRoles(), getCurrentRole()]);
  if (page.tree) return <ProjectPageView page={page} roles={roles} actor={actor} />;
  return <ProjectOverviewView overview={await loadProjectOverview(vault, name)} roles={roles} />;
}
