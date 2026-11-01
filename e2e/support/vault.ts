/**
 * The e2e vault is a throw-away copy of tests/fixtures/e2e-vault (plus optional overlays), restored
 * in place: the directory itself stays, so the server's file watcher keeps working across restores.
 */
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { E2E_VAULT, FIXTURES } from './env';

/** Fixture folders under tests/fixtures/, applied in order on top of an empty vault. */
export type Snapshot = 'e2e-vault' | 'e2e-vault-g1' | 'e2e-vault-g1-plan' | 'e2e-vault-segment3' | 'e2e-vault-demo' | 'e2e-vault-m1' | 'e2e-vault-m1-interviews';

const LAYERS: Record<Snapshot, string[]> = {
  'e2e-vault': ['e2e-vault'],
  'e2e-vault-m1': ['e2e-vault-m1'],
  'e2e-vault-m1-interviews': ['e2e-vault-m1', 'e2e-vault-m1-interviews'],
  // The old data shape of WS-A's G1 step: workplan v1 approved, hypothesis H1 in the vault, and the workspace note still says
  // stage: 执行中 (written before G1 stopped moving the stage; new runs keep 拆题中). The fixture is not rewritten on purpose.
  'e2e-vault-g1': ['e2e-vault', 'e2e-vault-g1'],
  // ... and an unapproved plan v1 for the investigation 「IT 可管理性」 (the grill is covered by the M2 spec).
  'e2e-vault-g1-plan': ['e2e-vault', 'e2e-vault-g1', 'e2e-vault-g1-plan'],
  // ... plus WS-B as the demo's segment 3 finds it (D-34/D-36): workplan v1 approved, a draft plan 「员工自带AI的程度」 owned by
  // Junior B that covers only 买方 (the other perspectives skipped with a reason, 监管 neither), and the team's perspective list.
  'e2e-vault-segment3': ['e2e-vault', 'e2e-vault-g1', 'e2e-vault-g1-plan', 'e2e-vault-segment3'],
  // The demo order of D-44, from step 0: WS-A is still 拆题中 (steps 1–7 are done live), WS-B's draft plan as in segment3 (WS-B's own
  // workplan already approved, no WS-A layers), and a 项目.md that has the issue tree and says Senior confirmed it (the project page).
  'e2e-vault-demo': ['e2e-vault', 'e2e-vault-segment3', 'e2e-vault-demo'],
};

export async function resetVault(snapshot: Snapshot = 'e2e-vault'): Promise<void> {
  await mkdir(E2E_VAULT, { recursive: true });
  for (const name of await readdir(E2E_VAULT)) await rm(path.join(E2E_VAULT, name), { recursive: true, force: true });
  for (const layer of LAYERS[snapshot]) await cp(path.join(FIXTURES, layer), E2E_VAULT, { recursive: true });
}

export async function readVaultFile(rel: string): Promise<string> {
  return readFile(path.join(E2E_VAULT, rel), 'utf8');
}

export async function vaultFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(path.join(E2E_VAULT, dir))).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}
