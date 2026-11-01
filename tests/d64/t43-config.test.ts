/** D-64 T43 (ui-6): /config, read-only — the team's configuration (战略部 or 市场部), the models by role, the fixed rules. */
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadConfigView } from '@/lib/config/config-view';
import { createVault, type Vault } from '@/lib/vault';

const vault = createVault(path.resolve('demo-vault'));
const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));
mocked.vault = vault;

const render = async (team?: string) => {
  const { default: Page } = await import('@/app/config/page');
  return renderToString((await Page({ searchParams: Promise.resolve(team ? { team } : {}) })) as never).replace(/<!-- -->/g, '');
};

describe('T43 config page', () => {
  it('the data comes from 90_配置: the active team, its perspectives, roles, methods, sources; the models by role', async () => {
    const v = await loadConfigView(vault);
    expect(v.teams).toEqual(['战略部', '市场部']);
    expect(v.current).toMatchObject({ team: '战略部', active: true, perspectives: ['买方', '竞争对手', '我方自身的布局', '监管', '技术供给'] });
    expect(v.current.roles).toContain('Senior');
    expect(v.current.methods).toContain('假设驱动调查');
    expect(v.current.sources).toContain('官方统计');
    expect(v.models.map((m) => m.role)).toEqual(['判断', '执行', '独立复核']);
    expect(v.models.every((m) => m.label.length > 0)).toBe(true);
    const mk = await loadConfigView(vault, '市场部');
    expect(mk.current).toMatchObject({ team: '市场部', active: false });
    expect(mk.current.perspectives).toContain('目标用户');
    expect(mk.current.roles).toContain('CMO');
  });

  it('the page: every text and testid of ui-6; switching to 市场部 shows its column', async () => {
    const out = await render();
    for (const t of ['团队与模型配置', '换团队、换模型只改这里；工作规则和流程不变', '方法库', '研究计划必须覆盖的视角', '角色', '资料来源', '模型（按角色）', '判断', '执行', '独立复核', '不随团队变的工作规则']) expect(out, t).toContain(t);
    for (const id of ['team-config', 'model-roles', 'fixed-rules']) expect(out).toContain(`data-testid="${id}"`);
    expect(out).toMatch(/data-testid="team-config"[^>]*data-team="战略部"|data-team="战略部"[^>]*data-testid="team-config"/);
    const mk = await render('市场部');
    expect(mk).toMatch(/data-team="市场部"/);
    expect(mk).toContain('目标用户');
  });

  it('read-only: no form, no button that writes', async () => {
    const out = await render();
    expect(out).not.toMatch(/<form|<textarea|type="submit"/);
  });
});
