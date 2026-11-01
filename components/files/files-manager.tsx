'use client';

/**
 * D-64 T37 (ui-3): the five groups of files. Everything is read by default; a file unticked is not read by the AI,
 * ★ is read first, and the web switch lets the investigation search the web. Each change is saved to 资料选择.json
 * (only the Workspace owner). ＋ 上传文件 puts interview notes (.md / .txt) into the project.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { Selection } from '@/lib/research/selection';
import type { GroupFile } from '@/lib/workplan/files-view';
import { cn } from '@/lib/utils';

export const FILE_GROUPS = [
  { key: 'outputs', label: '项目产出' },
  { key: 'background', label: '项目背景' },
  { key: 'company', label: '公司资料' },
  { key: 'public', label: '公开数据源' },
  { key: 'assets', label: '公司资产' },
] as const;
export type FileGroupKey = (typeof FILE_GROUPS)[number]['key'];

/** Two selections say the same thing (a server render is a new object each time). */
export function sameSelection(a: Selection, b: Selection): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((p, i) => p === y[i]);
  return a.web === b.web && same(a.excluded, b.excluded) && same(a.starred, b.starred);
}

/**
 * The chat's 同意 hands its selection to the list on this page, which saves it like a click (in order with the
 * clicks): a star clicked right after 同意 used to save the list from before it, and TechRadar came back.
 */
export const SELECTION_AGREED = 'sw-selection-agreed';
export type AgreedSelection = { selection: Selection; handled: boolean; done: (ok: boolean) => void };

export const postSelection = (workspacePath: string, next: Selection) =>
  fetch('/api/workspace/selection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspacePath, excluded: next.excluded, starred: next.starred, web: next.web }) })
    .then((res) => res.ok)
    .catch(() => false);

export function FilesManager({ groups, selection, canEdit, workspacePath }: { groups: Record<FileGroupKey, GroupFile[]>; selection: Selection; canEdit: boolean; workspacePath: string }): JSX.Element {
  const router = useRouter();
  const [sel, setSel] = useState(selection);
  const [seen, setSeen] = useState(selection);
  // what 同意 put on the list: the server render that follows it must not undo a star clicked since
  const [agreed, setAgreed] = useState<Selection | null>(null);
  if (!sameSelection(seen, selection)) {
    // a newer server render (the chat's 同意, another window): it is what 资料选择.json says now, and the next toggle builds on it
    setSeen(selection);
    if (!agreed || !sameSelection(agreed, selection)) setSel(selection);
    setAgreed(null);
  }
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  // one save at a time, in the order they were made: the last one is what 资料选择.json keeps
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const save = (next: Selection): Promise<boolean> => {
    const before = sel;
    setSel(next);
    setError(null);
    const saved = queue.current.then(() => postSelection(workspacePath, next));
    queue.current = saved;
    return saved.then((ok) => {
      if (!ok) {
        setSel(before);
        setError('没有保存，请重试');
      }
      return ok;
    });
  };
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  useEffect(() => {
    const onAgreed = (e: Event) => {
      const a = (e as CustomEvent<AgreedSelection>).detail;
      a.handled = true;
      setAgreed(a.selection);
      void latestSave.current(a.selection).then(a.done);
    };
    window.addEventListener(SELECTION_AGREED, onAgreed);
    return () => window.removeEventListener(SELECTION_AGREED, onAgreed);
  }, []);
  const toggle = (list: 'excluded' | 'starred', path: string) => save({ ...sel, [list]: sel[list].includes(path) ? sel[list].filter((p) => p !== path) : [...sel[list], path] });
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const body = { workspacePath, simulated, files: await Promise.all([...files].map(async (f) => ({ filename: f.name, content: await f.text() }))) };
    const res = await fetch('/api/research/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) setError(res?.status === 415 ? '只能上传 .md 或 .txt' : '没有上传成功，请重试');
    else router.refresh();
    if (upload.current) upload.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="text-muted-foreground">默认全选 · 取消勾选的 AI 不读 · ★ 为优先阅读</p>
        <label className="ml-auto inline-flex items-center gap-2">
          <Switch data-testid="web-toggle" checked={sel.web} disabled={!canEdit} onCheckedChange={(web) => void save({ ...sel, web })} />
          联网
        </label>
        {canEdit ? (
          <span className="inline-flex items-center gap-2">
            <label className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <input type="checkbox" checked={simulated} onChange={(e) => setSimulated(e.target.checked)} /> 模拟访谈
            </label>
            <input ref={upload} type="file" accept=".md,.txt" multiple hidden onChange={(e) => void onFiles(e.target.files)} data-testid="upload-input" />
            <Button type="button" size="sm" variant="outline" data-testid="upload-file" onClick={() => upload.current?.click()}>
              ＋ 上传文件
            </Button>
          </span>
        ) : null}
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {FILE_GROUPS.map((g) => (
        <section key={g.key} data-testid="files-group" data-group={g.key} className="space-y-1">
          <h3 className="text-sm font-medium">
            {g.label} <span className="text-muted-foreground font-normal">（{groups[g.key].length}）</span>
          </h3>
          {groups[g.key].length ? (
            <ul className="divide-y rounded-lg border">
              {groups[g.key].map((f) => {
                const checked = Boolean(f.fixed) || !sel.excluded.includes(f.path);
                const starred = sel.starred.includes(f.path);
                return (
                  <li key={f.path} data-testid="file-row" data-path={f.path} data-checked={String(checked)} data-starred={String(starred)} className={cn('flex items-center gap-2 p-2 text-sm', !checked && 'text-muted-foreground')}>
                    {f.fixed ? (
                      <>
                        <input type="checkbox" data-testid="file-check" data-fixed="true" aria-label={`AI 始终读 ${f.name}`} title={f.fixed} checked disabled />
                        <span className="text-muted-foreground w-[1em] text-center text-xs" title={f.fixed} aria-hidden="true">
                          ·
                        </span>
                      </>
                    ) : (
                      <>
                        <input type="checkbox" data-testid="file-check" aria-label={`AI 读 ${f.name}`} checked={checked} disabled={!canEdit} onChange={() => void toggle('excluded', f.path)} />
                        <button type="button" data-testid="file-star" aria-label={starred ? `取消优先：${f.name}` : `优先读：${f.name}`} aria-pressed={starred} disabled={!canEdit} onClick={() => void toggle('starred', f.path)} className={starred ? 'text-amber-500' : 'text-muted-foreground'}>
                          {starred ? '★' : '☆'}
                        </button>
                      </>
                    )}
                    <a href={f.href} className="font-medium hover:underline">
                      {f.name}
                    </a>
                    {f.simulated ? <span className="text-xs text-amber-700 dark:text-amber-400">（模拟）</span> : null}
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                      {f.kind}
                      {f.confirmedBy ? ` · ${f.confirmedBy}${f.confirmedAt ? ` ${f.confirmedAt}` : ''}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground rounded-lg border border-dashed p-2 text-xs">没有</p>
          )}
        </section>
      ))}
    </div>
  );
}
