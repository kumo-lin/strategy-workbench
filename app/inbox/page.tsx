/** D-64 T32 (ui-2b): 待你处理 — plans sent for your opinion, reports sent for you to confirm. */
import Link from 'next/link';
import { InboxOpinion } from '@/components/home/inbox-opinion';
import { WorkplanPanel } from '@/components/workspace/workplan-panel';
import { loadInbox } from '@/lib/inbox';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { buildWorkplanViews } from '@/lib/workplan/view';

export const dynamic = 'force-dynamic';

const KIND = { opinion: '研究计划 · 征求意见', confirm: '报告 · 要你确认' } as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const [{ open }, role] = await Promise.all([searchParams, getCurrentRole()]);
  const vault = getVault();
  const items = await loadInbox(vault, role);
  const opened = items.find((i) => i.kind === 'opinion' && i.reviewPath === open) ?? null;
  const review = opened ? await vault.read(opened.reviewPath) : null;
  const versions = opened ? await buildWorkplanViews(vault, opened.workspacePath) : [];
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">待你处理</h1>
      <p className="text-muted-foreground text-sm">研究计划只是来征求意见，不卡流程；报告要你确认，确认以后才会作为项目产出存入文件管理</p>
      {items.length === 0 ? <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">现在没有等你处理的事。</p> : null}
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.reviewPath} data-testid="inbox-item" data-kind={i.kind} className="bg-card rounded-lg border p-3 text-sm">
            <Link href={i.href} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{KIND[i.kind]}</span>
              <span>
                {i.project} / {i.workspace}
              </span>
              <span className="text-muted-foreground ml-auto text-xs">
                {i.requester} · {i.created.slice(0, 10)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {opened && review ? (
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" aria-label="征求意见">
          <div className="bg-card rounded-lg border p-3">
            <WorkplanPanel versions={versions} initialVersion={Number(review.data.version) || undefined} />
          </div>
          <div className="bg-card rounded-lg border p-3">
            <InboxOpinion reviewPath={opened.reviewPath} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
