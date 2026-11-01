import type { VaultEntry, VaultTreeNode } from '@/lib/vault/vault';

/** 文件去掉末尾的 .md；文件夹原样返回 name。 */
export function displayName(node: VaultEntry): string {
  return node.kind === 'file' ? node.name.replace(/\.md$/, '') : node.name;
}

/** 子树里的文件数（文件节点本身返回 1）。 */
export function countNotes(node: VaultTreeNode): number {
  if (node.kind === 'file') return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countNotes(child), 0);
}

/**
 * 按 displayName 过滤，不区分大小写，query 先 trim。
 * - query 为空：原样返回同一个数组（引用相等）。
 * - 文件夹名匹配：保留这个文件夹和它全部的子节点（原对象）。
 * - 否则：只保留匹配的文件，以及通往它们的祖先文件夹（新对象，children 只含匹配分支）。
 * - 不能修改输入。没有匹配返回 []。
 */
export function filterTree(nodes: VaultTreeNode[], query: string): VaultTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const out: VaultTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (displayName(node).toLowerCase().includes(q)) out.push(node);
      continue;
    }
    if (displayName(node).toLowerCase().includes(q)) {
      // The folder itself matches: keep it with every child (original object).
      out.push(node);
      continue;
    }
    const children = filterTree(node.children ?? [], q);
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}

/** 'a/b/c.md' → ['a', 'a/b']；顶层路径返回 []。 */
export function ancestorPaths(path: string): string[] {
  const segments = path.split('/');
  segments.pop();
  const out: string[] = [];
  for (let i = 1; i <= segments.length; i += 1) {
    out.push(segments.slice(0, i).join('/'));
  }
  return out;
}
