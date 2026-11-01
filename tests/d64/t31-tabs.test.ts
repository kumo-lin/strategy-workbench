/** D-64 T31: a Workspace has two tabs, 工作台 and 文件管理; the comparison page and the plain baseline run are gone (D3). */
import { existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { noteSchema } from '@/lib/notes/schema';

const nav = vi.hoisted(() => ({ path: '/workspace/p/w' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));
const html = () => renderToString(createElement(WorkspaceNav, { basePath: '/workspace/p/w' })).replace(/<!-- -->/g, '');

describe('T31 two tabs', () => {
  it('工作台 and 文件管理, nothing else', () => {
    const out = html();
    expect([...out.matchAll(/data-testid="(ws-tab-[a-z]+)"/g)].map((m) => m[1])).toEqual(['ws-tab-work', 'ws-tab-files']);
    expect(out).toContain('工作台');
    expect(out).toContain('文件管理');
    for (const old of ['对比', '工作循环', '征求意见', '>调查<']) expect(out).not.toContain(old);
  });

  it('工作台 is the current tab on the research and review pages too; 文件管理 on files', () => {
    for (const [p, tab] of [
      ['/workspace/p/w', 'work'],
      ['/workspace/p/w/research/R1', 'work'],
      ['/workspace/p/w/review', 'work'],
      ['/workspace/p/w/files', 'files'],
    ] as const) {
      nav.path = p;
      expect(html()).toMatch(new RegExp(`data-testid="ws-tab-${tab}"[^>]*aria-current="page"|aria-current="page"[^>]*data-testid="ws-tab-${tab}"`));
    }
  });

  it('the comparison page, its components, the baseline code and its API are gone', () => {
    for (const p of ['app/workspace/[project]/[workspace]/compare', 'components/compare', 'lib/baseline', 'app/api/baseline']) expect(existsSync(p), p).toBe(false);
  });

  it('an older report written by the plain run (mode: baseline) still reads', () => {
    const r = noteSchema.safeParse({
      id: 'b',
      type: 'report',
      status: '进行中',
      created: '2026-10-20',
      updated: '2026-10-20',
      author: 'AI',
      derived_from: ['[[x]]'],
      relates_to: ['[[y]]'],
      version: 1,
      research_plan: null,
      exploratory: false,
      mode: 'baseline',
    });
    expect(r.success).toBe(true);
  });
});
