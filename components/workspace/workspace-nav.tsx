'use client';

import { FolderOpen, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { cn } from '@/lib/utils';

export function WorkspaceNav({ basePath }: { basePath: string }): JSX.Element {
  const pathname = usePathname();
  // pathname is percent-encoded like basePath
  // D-64 T31: two tabs. 工作台 holds the steps (研究计划 … 存入项目文件): the research and review pages are part of it.
  const files = `${basePath}/files`;
  const items = [
    { href: basePath, label: '工作台', icon: MessagesSquare, testid: 'ws-tab-work', active: !pathname.startsWith(files) },
    { href: files, label: '文件管理', icon: FolderOpen, testid: 'ws-tab-files', active: pathname.startsWith(files) },
  ];
  return (
    <nav className="bg-muted ml-auto flex items-center gap-0.5 rounded-lg p-0.5" aria-label="Workspace">
      {items.map(({ href, label, icon: Icon, testid, active }) => (
        <Link
          key={href}
          href={href}
          data-testid={testid}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm',
            active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden="true" /> {label}
        </Link>
      ))}
    </nav>
  );
}
