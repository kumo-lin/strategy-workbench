/** D-64 T43 (ui-6): 方法与配置 — read-only. Switching the team or the model is an edit of 90_配置/, nothing else. */
import Link from 'next/link';
import type { JSX } from 'react';
import { loadConfigView } from '@/lib/config/config-view';
import { readModelsConfigSafe } from '@/lib/config/models-safe';
import { ConfigProblem } from '@/components/config/config-problem';
import { getVault } from '@/lib/vault';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  if (!(await readModelsConfigSafe(getVault())).ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">团队与模型配置</h1>
        <p className="text-muted-foreground text-sm">换团队、换模型只改这里；工作规则和流程不变</p>
        <ConfigProblem />
      </div>
    );
  }
  const v = await loadConfigView(getVault(), team);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">团队与模型配置</h1>
      <p className="text-muted-foreground text-sm">换团队、换模型只改这里；工作规则和流程不变</p>
      <section className="bg-card space-y-3 rounded-lg border p-4" data-testid="team-config" data-team={v.current.team}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">{v.current.team}</h2>
          <span className="text-muted-foreground text-xs">{v.current.active ? '现用' : '演示用，未生效'}</span>
          <nav className="ml-auto flex gap-1 text-sm" aria-label="换团队">
            {v.teams.map((t) => (
              <Link key={t} href={`/config?team=${encodeURIComponent(t)}`} aria-current={t === v.current.team ? 'page' : undefined} className={cn('rounded-md border px-2 py-0.5', t === v.current.team ? 'bg-accent' : 'text-muted-foreground')}>
                {t}
              </Link>
            ))}
          </nav>
        </div>
        <dl className="space-y-2">
          <Row label="方法库">{v.current.methods || '—'}</Row>
          <Row label="研究计划必须覆盖的视角">{v.current.perspectives.join('、') || '—'}</Row>
          <Row label="角色">{v.current.roles || '—'}</Row>
          <Row label="资料来源">{v.current.sources || '—'}</Row>
        </dl>
      </section>
      <section className="bg-card space-y-2 rounded-lg border p-4" data-testid="model-roles">
        <h2 className="font-medium">模型（按角色）</h2>
        <dl className="space-y-2">
          {v.models.map((m) => (
            <Row key={m.role} label={m.role}>
              <span className="text-muted-foreground">{m.use}：</span>
              {m.label}
              {m.model ? <span className="text-muted-foreground">（{m.model}）</span> : null}
            </Row>
          ))}
        </dl>
        <p className="text-muted-foreground text-xs">换模型：改一行配置，代码不改。两层 Harness 由系统执行，不靠模型自觉；换完用固定的测试题重跑一遍，再决定是否上线。</p>
      </section>
      <section className="bg-card space-y-2 rounded-lg border p-4" data-testid="fixed-rules">
        <h2 className="font-medium">不随团队变的工作规则</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {v.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
