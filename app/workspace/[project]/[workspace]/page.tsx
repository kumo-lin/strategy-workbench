import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { locateWorkspace, workspacePhase, type WorkspaceParams } from '@/lib/workplan/page-data';
import { listReviews } from '@/lib/workplan/state';
import { buildCommentViews, buildReviewViews, buildWorkplanViews } from '@/lib/workplan/view';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage({ params }: { params: Promise<WorkspaceParams> }) {
  const loc = await locateWorkspace(params);
  const { ctx, phase } = await workspacePhase(loc);
  const [versions, comments, reviews, reviewViews] = await Promise.all([
    buildWorkplanViews(loc.vault, loc.workspacePath),
    buildCommentViews(loc.vault, loc.workspacePath),
    listReviews(loc.vault, loc.workspacePath),
    buildReviewViews(loc.vault, loc.workspacePath),
  ]);
  const hasOpenRequest = reviews.some((r) => r.note.gate === 'G1' && r.note.result === null);
  const sentVersions = reviewViews.flatMap((r) => (r.gate === 'G1' && r.version !== null ? [r.version] : []));
  const { owner, reviewer, stage, flags } = ctx.workspace;
  return (
    <WorkspaceShell
      workspacePath={loc.workspacePath}
      actor={{ name: loc.role.name, kind: loc.role.kind }}
      workspace={{ owner, reviewer, stage, flags }}
      phase={phase}
      versions={versions}
      comments={comments}
      hasOpenRequest={hasOpenRequest}
      sentVersions={sentVersions}
    />
  );
}
