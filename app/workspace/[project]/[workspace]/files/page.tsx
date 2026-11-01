/** 文件管理 (D-64 T37, ui-3): the five groups with what the AI reads, and the chat that finds files for the task. */
import { FilesChat } from '@/components/files/files-chat';
import { FilesManager } from '@/components/files/files-manager';
import { Markdown } from '@/components/workspace/markdown';
import type { Vault } from '@/lib/vault';
import { readSelection } from '@/lib/research/selection';
import { loadFiles } from '@/lib/workplan/files-view';
import { locateWorkspace, type WorkspaceParams } from '@/lib/workplan/page-data';

export const dynamic = 'force-dynamic';

interface LibraryDoc {
  title: string;
  publisher: string;
  simulated: boolean;
  body: string;
}

/** The note `?doc=` points at, or null: only a `.md` directly in 10_资料库, with no traversal. */
async function readLibraryDoc(vault: Vault, doc: string | undefined): Promise<LibraryDoc | null> {
  if (!doc || !doc.startsWith('10_资料库/') || !doc.endsWith('.md') || doc.includes('..')) return null;
  if (!(await vault.exists(doc))) return null;
  try {
    const note = await vault.read(doc);
    return {
      title: note.title,
      publisher: typeof note.data.publisher === 'string' ? note.data.publisher : '',
      simulated: note.data.simulated === true || note.data.publisher === '模拟',
      body: note.body,
    };
  } catch {
    return null;
  }
}

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<WorkspaceParams>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const loc = await locateWorkspace(params);
  const [sp, files, selection, ws] = await Promise.all([searchParams, loadFiles(loc.vault, loc.workspacePath, loc.basePath), readSelection(loc.vault, loc.workspacePath), loc.vault.readTyped(`${loc.workspacePath}/workspace.md`, 'workspace')]);
  const canEdit = loc.role.name === ws.note.owner;
  const doc = await readLibraryDoc(loc.vault, sp.doc);
  return (
    <div className="space-y-4" data-testid="files-page">
      {doc ? (
        <section data-testid="library-doc" className="bg-card space-y-2 rounded-lg border p-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold">
              {doc.title}
              {doc.simulated ? <span className="text-amber-700 dark:text-amber-400 text-xs font-normal">（模拟）</span> : null}
            </h2>
            <a href={`${loc.basePath}/files`} className="text-muted-foreground hover:text-foreground shrink-0 text-sm">
              关闭
            </a>
          </div>
          {doc.publisher ? <p className="text-muted-foreground text-xs">{doc.publisher}</p> : null}
          <Markdown source={doc.body} />
        </section>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <FilesManager
          groups={{ outputs: files.outputs, background: files.background, company: files.company, public: files.public, assets: files.assets }}
          selection={selection}
          canEdit={canEdit}
          workspacePath={loc.workspacePath}
        />
        <FilesChat workspacePath={loc.workspacePath} actorName={loc.role.name} canEdit={canEdit} />
      </div>
    </div>
  );
}
