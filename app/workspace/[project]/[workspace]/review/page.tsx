import Link from 'next/link';
import { ReviewPanel } from '@/components/workspace/review-panel';
import { StatusBadge } from '@/components/ui/status-badge';
import { WorkplanPanel } from '@/components/workspace/workplan-panel';
import { LogTable } from '@/components/workspace/log-table';
import { commentTargets } from '@/lib/workplan/comments';
import { locateWorkspace, type WorkspaceParams } from '@/lib/workplan/page-data';
import { buildReviewViews, buildWorkplanViews } from '@/lib/workplan/view';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<WorkspaceParams>;
  searchParams: Promise<{ r?: string }>;
}) {
  const loc = await locateWorkspace(params);
  const { r } = await searchParams;
  const ws = (await loc.vault.readTyped(`${loc.workspacePath}/workspace.md`, 'workspace')).note;
  const [reviews, versions, log] = await Promise.all([
    buildReviewViews(loc.vault, loc.workspacePath),
    buildWorkplanViews(loc.vault, loc.workspacePath),
    loc.vault.readLog(`${loc.workspacePath}/日志.md`),
  ]);
  const hypotheses = (await loc.vault.search({ types: ['hypothesis'], dir: `${loc.project ? `20_项目/${loc.project}/假设` : ''}`, limit: 50 })).filter(
    (h) => String(h.data.workspace ?? '').includes(loc.workspace),
  );

  if (reviews.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm" data-testid="no-reviews">
        还没有征求意见的记录。{ws.owner} 和 AI 共创好研究计划，点「发给 {ws.reviewer} 征求意见」之后，这里会出现要看的内容。
      </div>
    );
  }
  const review = reviews.find((x) => x.name === r) ?? reviews.find((x) => x.result === null) ?? reviews[0];
  const version = versions.find((v) => v.version === review.version) ?? versions[versions.length - 1];
  const actor = loc.role;
  const pending = review.result === null;
  const canComment = pending && actor.name !== review.requester;
  const canDecide = pending && actor.kind === 'senior' && actor.name === review.reviewer;
  const targets = commentTargets(version?.body ?? '');

  return (
    <div className="space-y-3" data-testid="review-page">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="征求意见记录">
        {reviews.map((x) => (
          <Link
            key={x.path}
            href={`${loc.basePath}/review?r=${encodeURIComponent(x.name)}`}
            aria-current={x.path === review.path ? 'page' : undefined}
            className={`rounded-md border px-2 py-1 ${x.path === review.path ? 'bg-accent' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {x.name} · {x.result === '通过' ? '看过了' : x.result === '打回' ? '有意见' : '等回复'}
          </Link>
        ))}
      </nav>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="bg-card space-y-4 rounded-lg border p-3" aria-label="要看的内容">
          <WorkplanPanel key={review.path} versions={versions} initialVersion={version?.version} />
          <div>
            <h3 className="mb-1.5 text-sm font-medium">假设（{hypotheses.length}）</h3>
            <ul className="space-y-1 text-sm">
              {hypotheses.map((h) => (
                <li key={h.path} className="flex items-start gap-2">
                  <StatusBadge status={h.data.status as '进行中'} />
                  <span>
                    <span className="text-muted-foreground">{h.title.split(' ')[0]}</span> {String(h.data.statement ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">推导过程（日志，{log.length} 条）</summary>
            <div className="mt-2">
              <LogTable entries={log} />
            </div>
          </details>
        </section>
        <section className="bg-card rounded-lg border p-3" aria-label="征求意见">
          <ReviewPanel
            key={review.path}
            review={review}
            actorName={actor.name}
            canComment={canComment}
            canDecide={canDecide}
            targets={targets}
          />
        </section>
      </div>
    </div>
  );
}
