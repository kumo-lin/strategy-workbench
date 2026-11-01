/** D-64 T14: POST /api/workspace/selection writes 资料选择.json for the Workspace owner only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { readSelection } from '@/lib/research/selection';
import type { Vault } from '@/lib/vault';
import { POST } from '@/app/api/workspace/selection/route';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));

const WS = '20_项目/P/WS-A';
const body = { workspacePath: WS, excluded: ['10_资料库/资料甲.md'], starred: [], web: false };
const post = (b: unknown) => POST(new Request('http://x/api/workspace/selection', { method: 'POST', body: JSON.stringify(b) }));

let cleanup: () => Promise<void>;
beforeEach(async () => {
  const fx = await makeFixtureVault();
  mocked.vault = fx.vault;
  cleanup = fx.cleanup;
});
afterEach(async () => cleanup());

describe('POST /api/workspace/selection', () => {
  it('the owner saves it', async () => {
    mocked.role = ROLES.juniorA;
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await readSelection(mocked.vault, WS)).toEqual({ version: 1, excluded: body.excluded, starred: [], web: false });
  });
  it('anyone else gets 403', async () => {
    mocked.role = ROLES.juniorB;
    expect((await post(body)).status).toBe(403);
  });
  it('a bad body gets 400', async () => {
    mocked.role = ROLES.juniorA;
    expect((await post({ workspacePath: WS, excluded: 'x' })).status).toBe(400);
  });
});
