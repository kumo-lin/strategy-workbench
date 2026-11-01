/** 调查列表 + 新建调查（M2）。 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewResearchForm } from '@/components/research/new-research-form';
import { Badge } from '@/components/ui/badge';
import { assertWorkspacePath, latestVersion, workspaceNameOf } from '@/lib/research/folders';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

export default async function ResearchListPage({ params }: { params: Promise<{ project: string; workspace: string }> }) {
  const p = await params;
  const workspacePath = `20_项目/${decodeURIComponent(p.project)}/${decodeURIComponent(p.workspace)}`;
  const vault = getVault();
  try {
    assertWorkspacePath(workspacePath);
  } catch {
    notFound();
  }
  if (!(await vault.exists(`${workspacePath}/workspace.md`))) notFound();
  const [ws, role] = await Promise.all([vault.readTyped(`${workspacePath}/workspace.md`, 'workspace'), getCurrentRole()]);
  const entries = await vault.list(`${workspacePath}/调查`).catch(() => []);
  const rows = await Promise.all(
    entries
      .filter((e) => e.kind === 'dir')
      .map(async (e) => {
        const plan = await latestVersion(vault, e.path, '计划');
        const report = await latestVersion(vault, e.path, '报告');
        const planNote = plan ? (await vault.read(plan.path)).data : null;
        const reportNote = report ? (await vault.read(report.path)).data : null;
        return { name: e.name, plan, report, planNote, reportNote };
      }),
  );
  const workspaceName = workspaceNameOf(workspacePath);
  const base = `/workspace/${p.project}/${p.workspace}/research`;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">Deep Research · {workspaceName}</h1>
        <p className="text-muted-foreground text-sm">先 grill 对齐、出调查计划、修改并批准，批准之后才开始调查；至少调查一次，报告带引用，summary 在最前面。</p>
      </div>
      <NewResearchForm workspacePath={workspacePath} canCreate={role.name === ws.note.owner} owner={ws.note.owner} base={base} />
      <ul className="divide-y rounded-lg border" data-testid="research-list">
        {rows.length === 0 && <li className="text-muted-foreground p-3 text-sm">还没有调查。</li>}
        {rows.map((r) => (
          <li key={r.name}>
            <Link href={`${base}/${encodeURIComponent(r.name)}`} className="hover:bg-accent/50 flex items-center justify-between gap-3 p-3">
              <span className="font-medium">{r.name}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                {r.plan ? <Badge variant="outline">计划 v{r.plan.n} · {r.planNote?.approved_at ? '已批准' : '待批准'}</Badge> : <Badge variant="outline">待 grill</Badge>}
                {r.report && <Badge variant={r.reportNote?.delivery === '已交付' ? 'default' : 'secondary'}>报告 v{r.report.n} · {String(r.reportNote?.delivery ?? '')}</Badge>}
                {(r.planNote?.exploratory === true) && <Badge variant="secondary">探索性</Badge>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
