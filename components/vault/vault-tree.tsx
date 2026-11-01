'use client';

import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';
import { Input } from '@/components/ui/input';
import type { VaultTreeNode } from '@/lib/vault/vault';
import { cn } from '@/lib/utils';
import { ancestorPaths, countNotes, displayName, filterTree } from './tree-utils';

export interface VaultTreeProps {
  nodes: VaultTreeNode[];
  /** 初始展开到第几层，默认 2（第 0、1 层的文件夹展开）。 */
  defaultExpandedDepth?: number;
  /** 高亮的文件路径；它的祖先文件夹要自动展开。 */
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

const ROW_CLASS =
  'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

function initialExpanded(nodes: VaultTreeNode[], depth: number): Set<string> {
  const expanded = new Set<string>();
  const walk = (list: VaultTreeNode[], level: number) => {
    for (const node of list) {
      if (node.kind !== 'dir') continue;
      if (level < depth) expanded.add(node.path);
      if (node.children?.length) walk(node.children, level + 1);
    }
  };
  walk(nodes, 0);
  return expanded;
}

export function VaultTree({
  nodes,
  defaultExpandedDepth = 2,
  selectedPath,
  onSelect,
}: VaultTreeProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(nodes, defaultExpandedDepth));

  // The selected note's ancestors are always expanded.
  const forcedOpen = useMemo(
    () => new Set(selectedPath ? ancestorPaths(selectedPath) : []),
    [selectedPath],
  );

  const searching = query.trim().length > 0;
  const filtered = useMemo(() => filterTree(nodes, query), [nodes, query]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNodes = (list: VaultTreeNode[], depth: number): JSX.Element[] =>
    list.map((node) => {
      const indent = depth * 14 + 8;

      if (node.kind === 'dir') {
        const open = searching || expanded.has(node.path) || forcedOpen.has(node.path);
        const children = node.children ?? [];
        return (
          <div key={node.path}>
            <button
              type="button"
              data-testid="vault-tree-dir"
              data-path={node.path}
              aria-expanded={open}
              onClick={() => toggle(node.path)}
              style={{ paddingLeft: indent }}
              className={ROW_CLASS}
            >
              <ChevronRight
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-90',
                )}
              />
              {open ? (
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{displayName(node)}</span>
              <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
                {countNotes(node)}
              </span>
            </button>
            {open && children.length > 0 ? (
              <div className="flex flex-col">{renderNodes(children, depth + 1)}</div>
            ) : null}
          </div>
        );
      }

      const selected = node.path === selectedPath;
      return (
        <button
          key={node.path}
          type="button"
          data-testid="vault-tree-file"
          data-path={node.path}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect?.(node.path)}
          style={{ paddingLeft: indent }}
          className={cn(ROW_CLASS, selected && 'bg-accent hover:bg-accent')}
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{displayName(node)}</span>
        </button>
      );
    });

  return (
    <div className="flex w-full flex-col gap-1">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="筛选笔记…"
        aria-label="筛选笔记"
      />
      {searching && filtered.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">没有匹配的笔记</p>
      ) : (
        <div className="flex flex-col">{renderNodes(filtered, 0)}</div>
      )}
    </div>
  );
}
