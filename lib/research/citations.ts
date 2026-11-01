/**
 * Resolve every `[[note#^cN]]` in a report into what the viewer shows when it is clicked
 * (block text, grade, 知识库 / 网络 · AI 定级, publisher, url). Server-side; M4's plain mode
 * can reuse it for its reports. The result is a plain JSON map keyed by the link as written.
 */
import { extractWikiLinks } from '@/lib/vault/links';
import type { Vault } from '@/lib/vault';
import type { CitationDetail } from './citation-types';
import { isUserUploadPlatform } from './grading';
import { loadSourceInfo, noteName } from './sources';

export async function resolveReportCitations(vault: Vault, markdown: string, fromPath?: string): Promise<Record<string, CitationDetail>> {
  const out: Record<string, CitationDetail> = {};
  const checks = await vault.checkCitations(markdown, { fromPath });
  const byLink = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!byLink.has(c.link)) byLink.set(c.link, c);
  for (const l of extractWikiLinks(markdown)) {
    if (!l.block || out[l.raw]) continue;
    const c = byLink.get(l.raw);
    const info = c?.path ? await loadSourceInfo(vault, c.path).catch(() => null) : null;
    out[l.raw] = {
      link: l.raw,
      ok: c?.ok ?? false,
      ...(c?.error ? { error: c.error } : {}),
      sourceName: info?.name ?? (c?.path ? noteName(c.path) : l.target.split('/').pop() ?? l.target),
      sourcePath: c?.path ?? null,
      blockId: l.block,
      blockText: c?.blockText ?? null,
      quote: c?.quote ?? null,
      grade: info?.kind === 'expert' ? null : (info?.grade ?? null),
      gradedBy: info?.kind === 'expert' ? null : (info?.gradedBy ?? null),
      origin: info?.origin ?? null,
      ...(info?.kind === 'expert' ? { simulated: info.simulated } : {}),
      ...(info?.kind === 'source' && info.reliability === 'unverified' ? { unverified: true } : {}),
      ...(info?.kind === 'source' && isUserUploadPlatform(info.url) ? { userUpload: true } : {}),
      publisher: info?.publisher ?? null,
      url: info?.url ?? null,
      published: info?.published ?? null,
    };
  }
  return out;
}
