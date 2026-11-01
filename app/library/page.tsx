/** The sidebar's read-only team library catalog; source notes stay unchanged. */
import { getVault } from '@/lib/vault';
export const dynamic = 'force-dynamic';
export default async function LibraryPage() {
  const vault = getVault();
  const entries = await vault.list('10_资料库').catch(() => []);
  const notes = await Promise.all(entries.filter((e) => e.kind === 'file').map((e) => vault.read(e.path)));
  return (
    <section className="space-y-3">
      <h1 className="text-lg font-semibold">团队资料库</h1>
      <p className="text-muted-foreground text-sm">在各工作区的文件管理中选择本次调查使用的资料。</p>
      <ul className="space-y-2">
        {notes.filter((n) => n.data.type === 'source').map((n) => (
          <li key={n.path} className="rounded-lg border p-3 text-sm">
            <p>{n.title}</p>
            <p className="text-muted-foreground text-xs">{String(n.data.publisher ?? '')} · {String(n.data.grade ?? '未定级')}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}