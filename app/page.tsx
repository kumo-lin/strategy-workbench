/** D-64 T32 (ui-0a): 我的项目 — one card per project, counts read from the vault. */
import Link from 'next/link';
import { loadProjectCards } from '@/lib/project/cards';
import { getVault } from '@/lib/vault';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const cards = await loadProjectCards(getVault());
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">我的项目</h1>
        <Link href="/new" data-testid="new-project" className="bg-primary text-primary-foreground ml-auto rounded-md px-3 py-1.5 text-sm">
          ＋ 新建项目
        </Link>
      </div>
      <p className="text-muted-foreground text-sm">新项目会自动读取团队资料库和以往已确认的决定</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.project} href={`/project/${encodeURIComponent(c.project)}`} data-testid="project-card" data-project={c.project} className="bg-card hover:bg-accent/40 block space-y-2 rounded-lg border p-4">
            <h2 className="font-medium">{c.project}</h2>
            {c.question ? <p className="text-muted-foreground text-sm">{c.question}</p> : null}
            <p className="text-muted-foreground text-xs" data-testid="project-card-counts">
              工作区 {c.workspaces} · 报告 {c.reports} · 已确认决定 {c.decisions}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
