/**
 * 复核 F：视角三层一起对齐 v6 2.14 —— M1 假设的视角标注、团队视角清单（m1-qira 叠加层和 E2E fixture，不碰冻结快照）、
 * 没写人时的默认访谈对象；配置页按 v6 写方法库、角色和每个模型角色“用在哪里”。（DeepSeek 01:30 曾按“半对齐更难看懂”
 * 收窄；整页一起对齐以后，这个前提不再成立。）
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_WHO } from '@/lib/research/interview-card';

describe('F 访谈对象与团队视角（v6 2.14）', () => {
  it('carries the four v6 perspectives as names a person can be asked of', () => {
    expect(DEFAULT_WHO['用户']).toBe('多设备重度用户');
    expect(DEFAULT_WHO['竞争']).toBe('熟悉竞品的行业分析师');
    expect(DEFAULT_WHO['经济性']).toBe('负责投入产出的业务负责人');
    expect(DEFAULT_WHO['中国市场']).toBe('中国市场的一线销售或渠道负责人');
    for (const who of [DEFAULT_WHO['用户'], DEFAULT_WHO['竞争'], DEFAULT_WHO['经济性'], DEFAULT_WHO['中国市场']]) {
      expect(who).not.toContain('企业 IT');
    }
  });

  it('keeps the old keys untouched (the enterprise study still uses them)', () => {
    expect(DEFAULT_WHO['买方']).toBe('企业 IT / 采购负责人');
    expect(DEFAULT_WHO['监管与合规']).toBe('合规负责人');
  });

  it('复核 F: the M1 plan looks from the team perspectives, so nobody is pointed at the enterprise buyer', async () => {
    const { M1_CLAIM_PERSPECTIVE, M1_PLAN } = await import('@/lib/testing/scripts/m1');
    const { loadConfigView } = await import('@/lib/config/config-view');
    const { createVault } = await import('@/lib/vault');
    const team = (await loadConfigView(createVault('tests/fixtures/e2e-vault-m1'))).current;
    expect(team.perspectives).toEqual(['用户', '竞争', '经济性', '中国市场', '监管']);
    for (const c of M1_PLAN.claims) for (const p of M1_CLAIM_PERSPECTIVE[c.id] ?? ['用户']) expect(team.perspectives, c.id).toContain(p);
    for (const p of team.perspectives) expect(DEFAULT_WHO[p], p).not.toContain('企业 IT');
    expect(team.methods).not.toMatch(/workplan|comment|storyline/);
    expect(team.roles).toContain('项目负责人');
  });

  it('复核 F: the config page says what each model role is used for (v6 2.14)', async () => {
    const { loadConfigView } = await import('@/lib/config/config-view');
    const { createVault } = await import('@/lib/vault');
    const v = await loadConfigView(createVault('tests/fixtures/e2e-vault-m1'));
    expect(v.models.map((m) => [m.role, m.use])).toEqual([
      ['判断', '研究计划、证据够不够、结论、推荐'],
      ['执行', '检索、抽证据、按判断写正文'],
      ['独立复核', '引用的第三道核验'],
    ]);
  });
});
