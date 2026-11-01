/**
 * Vault maintenance for demo copies built out of snapshots (scripts/demo-snapshot.ts).
 *
 * The frozen S3-D48 snapshot points its sources at research plans; a copy that carries only part of it
 * therefore has frontmatter links to notes it does not have. `relinkUnresolved` sends those at one note
 * (the demo's clean vault uses its project note, by full path), and `vaultIntegrity` says which notes would fail
 * tests/demo-vault.test.ts.
 */
import { parseWikiLink, type Vault } from '@/lib/vault';

/** Repoint every derived_from / relates_to link that does not resolve to `fallback` (e.g. "[[项目]]"). */
export async function relinkUnresolved(vault: Vault, fallback: string): Promise<{ path: string; replaced: string[] }[]> {
  const rewritten: { path: string; replaced: string[] }[] = [];
  const files = (await vault.list('', { recursive: true })).filter((e) => e.kind === 'file' && e.name.endsWith('.md'));
  for (const file of files) {
    const n = await vault.read(file.path);
    const replaced: string[] = [];
    const relinkField = async (value: unknown): Promise<unknown> => {
      if (!Array.isArray(value)) return value;
      const links: string[] = [];
      for (const raw of value) {
        const link = String(raw);
        const r = await vault.resolveLink(parseWikiLink(link)!, file.path);
        if (r.ok) links.push(link);
        else {
          replaced.push(link);
          links.push(fallback);
        }
      }
      return [...new Set(links)];
    };
    const derived_from = await relinkField(n.data.derived_from);
    const relates_to = await relinkField(n.data.relates_to);
    if (replaced.length === 0) continue;
    await vault.write(file.path, { frontmatter: { ...n.data, derived_from, relates_to }, body: n.body }, { overwrite: true });
    rewritten.push({ path: file.path, replaced });
  }
  return rewritten;
}

/** Notes that would fail tests/demo-vault.test.ts: parse issues, unresolved derived_from / relates_to, bad [[x#^c]] citations. */
export async function vaultIntegrity(vault: Vault): Promise<{ path: string; problems: string[] }[]> {
  const broken: { path: string; problems: string[] }[] = [];
  const files = (await vault.list('', { recursive: true })).filter((e) => e.kind === 'file' && e.name.endsWith('.md'));
  for (const file of files) {
    const n = await vault.read(file.path);
    const problems: string[] = [...n.issues];
    for (const key of ['derived_from', 'relates_to'] as const) {
      const value = n.data[key];
      if (!Array.isArray(value)) continue;
      for (const raw of value) {
        const link = String(raw);
        if (!(await vault.resolveLink(parseWikiLink(link)!, file.path)).ok) problems.push(`link ${link}`);
      }
    }
    const bad = (await vault.checkCitations(n.body, { fromPath: file.path })).filter((c) => !c.ok).length;
    if (bad > 0) problems.push(`citations ${bad}`);
    if (problems.length > 0) broken.push({ path: file.path, problems });
  }
  return broken;
}
