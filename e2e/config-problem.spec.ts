/**
 * 接手卡 C2：`90_配置/模型.md` 写坏时，配置页给一句中文说明，而不是整页 500。
 * 触发方式与真实场景一致：人正在改配置（或手写坏了 YAML），页面读它会抛。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_VAULT } from './support/env';
import { resetVault } from './support/vault';

const MODELS = '90_配置/模型.md';
const BROKEN = '---\nactive: [没有闭合\n---\n# 模型\n';
const FORBIDDEN = /\[\[|#\^|项目\.md|PDCA|工作循环/;

async function breakModels(): Promise<string> {
  const file = path.join(E2E_VAULT, MODELS);
  const original = await readFile(file, 'utf8');
  await writeFile(file, BROKEN, 'utf8');
  return original;
}

async function restoreModels(original: string): Promise<void> {
  await writeFile(path.join(E2E_VAULT, MODELS), original, 'utf8');
}

test.beforeEach(async () => {
  await resetVault('e2e-vault');
});

test('配置写坏：说清读不到与下一步，不出现工程词', async ({ page }) => {
  const original = await breakModels();
  try {
    await page.goto('/config');
    const box = page.getByTestId('config-problem');
    await expect(box).toBeVisible({ timeout: 120_000 });
    await expect(box).toContainText('配置暂时读不到。');
    await expect(box).toContainText('改好团队与模型配置后刷新。');
    await expect(page.locator('body')).not.toContainText('Application error');
    expect(await page.locator('body').innerText()).not.toMatch(FORBIDDEN);
  } finally {
    await restoreModels(original);
  }
});

test('配置正常：照常显示团队与模型', async ({ page }) => {
  await page.goto('/config');
  await expect(page.getByTestId('team-config')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('config-problem')).toHaveCount(0);
});
