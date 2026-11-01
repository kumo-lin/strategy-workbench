/**
 * D-64 复核 C3b-1: 资料选择只接受整份资料。
 *
 * 根本问题：`资料选择.json` 里的块级路径（`x.md#^c1`）能存下来，但 `selectionView` 按整份文件路径比较，
 * 永远匹配不上 —— 排除看起来生效、实际 AI 仍可读整份资料（假能力）；而且一条坏记录会让整个选择文件
 * 退回“全可读”（fail-open 放大）。
 *
 * 这张卡把边界收紧到能表达的东西上：选择只接受整份资料路径；手改坏的一条只丢该条，其余排除仍然生效。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { DEFAULT_SELECTION, readSelection, SELECTION_FILE, selectionSchema } from '@/lib/research/selection';
import type { Vault } from '@/lib/vault';
import { POST } from '@/app/api/workspace/selection/route';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));

const WS = '20_项目/P/WS-A';
const A = '10_资料库/资料甲.md';
const B = '10_资料库/资料乙.md';
const post = (b: unknown) => POST(new Request('http://x/api/workspace/selection', { method: 'POST', body: JSON.stringify(b) }));

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault());
  mocked.vault = vault;
  mocked.role = ROLES.juniorA;
});
afterEach(async () => cleanup());

/** Hand-edit the selection file the way a person would (not through the writer). */
async function writeRawSelection(value: unknown): Promise<void> {
  const dir = path.join(vault.root, WS);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, SELECTION_FILE), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('C3b-1 资料选择只接受整份资料', () => {
  it('1. a block-level or parameterised path is not a selection entry', () => {
    const base = { version: 1 as const, excluded: [], starred: [], web: true };
    for (const bad of [`${A}#^c1`, `${A}#^comment`, `${A}?v=2`]) {
      const excluded = selectionSchema.safeParse({ ...base, excluded: [bad] });
      const starred = selectionSchema.safeParse({ ...base, starred: [bad] });
      expect(excluded.success, `excluded: ${bad}`).toBe(false);
      expect(starred.success, `starred: ${bad}`).toBe(false);
      if (!excluded.success) expect(excluded.error.issues.map((i) => i.message).join(';')).toContain('整份');
    }
  });

  it('2. a hand-edited block path is dropped and the other exclusions still hold', async () => {
    await writeRawSelection({ version: 1, excluded: [`${A}#^c1`, B], starred: [], web: false });
    expect(await readSelection(vault, WS)).toEqual({ version: 1, excluded: [B], starred: [], web: false });
  });

  it('3. the same for starred entries', async () => {
    await writeRawSelection({ version: 1, excluded: [], starred: [`${A}#^c1`, B], web: true });
    expect(await readSelection(vault, WS)).toEqual({ version: 1, excluded: [], starred: [B], web: true });
  });

  it('4. a broken file still falls back to the default (web on, everything readable)', async () => {
    await writeRawSelection({ version: 1, excluded: 'not-an-array', starred: [], web: false });
    expect(await readSelection(vault, WS)).toEqual(DEFAULT_SELECTION);
  });

  it('5. the API refuses a block path with 400 and writes nothing', async () => {
    const res = await post({ workspacePath: WS, excluded: [`${A}#^c1`], starred: [], web: false });
    expect(res.status).toBe(400);
    expect(await readSelection(vault, WS)).toEqual(DEFAULT_SELECTION);
  });

  it('6. whole-note paths still round-trip', async () => {
    expect((await post({ workspacePath: WS, excluded: [A], starred: [B], web: false })).status).toBe(200);
    expect(await readSelection(vault, WS)).toEqual({ version: 1, excluded: [A], starred: [B], web: false });
    expect(JSON.parse(await readFile(path.join(vault.root, WS, SELECTION_FILE), 'utf8'))).toEqual({
      version: 1,
      excluded: [A],
      starred: [B],
      web: false,
    });
  });
});
