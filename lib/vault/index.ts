/**
 * Server-only entry point for the vault. Import from here, not from the files.
 *
 *   import { getVault } from '@/lib/vault';
 *   const vault = getVault();            // VAULT_DIR or ./demo-vault
 */
import path from 'node:path';
import { createVault, type Vault } from './vault';

export * from './vault';
export * from './links';
export * from './blocks';
export { parseMarkdown, serializeMarkdown } from './frontmatter';
export { watchVault, subscribeVaultChanges, type VaultChange } from './watch';

export function vaultRoot(): string {
  return path.resolve(process.env.VAULT_DIR ?? path.join(process.cwd(), 'demo-vault'));
}

let cached: Vault | null = null;

export function getVault(): Vault {
  const root = vaultRoot();
  if (!cached || cached.root !== root) cached = createVault(root);
  return cached;
}
