import type { Metadata } from 'next';
import Link from 'next/link';
import { RoleSwitcher } from '@/components/shell/role-switcher';
import { roleJob, roleStyle } from '@/components/shell/role-style';
import { VaultLiveRefresh } from '@/components/shell/vault-live-refresh';
import { RolesProvider } from '@/components/shell/roles-context';
import { getCurrentRole, getRoles, getWindowRoleId } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import './globals.css';

const APP_NAME = 'AI 协作战略工作台';

export async function generateMetadata(): Promise<Metadata> {
  const role = await getCurrentRole();
  return { title: `[${role.name}] ${APP_NAME}`, description: '团队与 AI 协作研究，推导、证据和决定可追溯。' };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [roles, current, windowRole, projects] = await Promise.all([
    getRoles(), getCurrentRole(), getWindowRoleId(), getVault().list('20_项目').catch(() => []),
  ]);
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh antialiased">
        <div className="flex min-h-dvh flex-col md:flex-row">
          <aside className="bg-background flex shrink-0 flex-col border-b md:sticky md:top-0 md:h-dvh md:w-56 md:border-r md:border-b-0">
            <div className={`h-1.5 ${roleStyle(current.id).band}`} data-testid="role-band" data-role={current.id} aria-hidden="true" />
            <Link href="/" className="p-4 text-sm font-semibold">{APP_NAME}</Link>
            <nav data-testid="side-nav" aria-label="主导航" className="flex-1 space-y-2 px-4 py-3 text-sm">
              <Link href="/" data-testid="side-nav-home" className="block">首页</Link>
              <Link href="/inbox" data-testid="side-nav-inbox" className="block">待你处理</Link>
              <h2 className="text-muted-foreground pt-2 text-xs">项目</h2>
              {projects.filter((p) => p.kind === 'dir').map((p) => (
                <Link key={p.name} href={`/project/${encodeURIComponent(p.name)}`} data-testid={`side-nav-project-${p.name}`} className="block truncate">{p.name}</Link>
              ))}
              <Link href="/library" data-testid="side-nav-library" className="block pt-2">团队资料库</Link>
              <Link href="/config" data-testid="side-nav-config" className="block">方法与配置</Link>
            </nav>
            <section data-testid="current-identity" className="space-y-2 border-t p-4 text-sm">
              <p className="text-muted-foreground text-xs">当前身份</p>
              <p data-testid="role-nameplate" className={`rounded-md border px-2 py-1 ${roleStyle(current.id).chip}`}>{current.name} · {roleJob(current.kind)}</p>
              <RoleSwitcher roles={roles} current={current.id} locked={windowRole !== null} />
            </section>
          </aside>
          <VaultLiveRefresh />
          <RolesProvider roles={roles}>
            <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6">{children}</main>
          </RolesProvider>
        </div>
      </body>
    </html>
  );
}