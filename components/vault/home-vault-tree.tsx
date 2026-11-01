'use client';

import { useState } from 'react';
import type { VaultTreeNode } from '@/lib/vault/vault';
import { VaultTree } from './vault-tree';

/** Home page wrapper: local selection only (note pages come with M1). */
export function HomeVaultTree({ nodes }: { nodes: VaultTreeNode[] }) {
  const [selected, setSelected] = useState<string>();
  return <VaultTree nodes={nodes} selectedPath={selected} onSelect={setSelected} />;
}
