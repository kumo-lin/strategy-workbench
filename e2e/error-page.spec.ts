/**
 * 接手卡 C1：页面读取失败时给中文说明和下一步，而不是框架默认的英文错误页。
 * 触发方式与真实场景一致：资料正在保存（或手改坏）时 frontmatter 不是合法 YAML，页面读它会抛错。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE_URL, E2E_VAULT } from './support/env';
import { resetVault } from './support/vault';

const PROJECT = '个人AI战略';
const NOTE = `20_项目/${PROJECT}/项目.md`;
const BROKEN = '---\ntype: project\nissue_tree: [没有闭合\n---\n# 个人AI战略\n';
const FORBIDDEN = /\[\[|#\^|项目\.md|PDCA|工作循环/;

async function breakNote(): Promise<string> {
  const file = path.join(E2E_VAULT, NOTE);
  const original = await readFile(file, 'utf8');
  await writeFile(file, BROKEN, 'utf8');
  return original;
}

async function restoreNote(original: string): Promise<void> {
  await writeFile(path.join(E2E_VAULT, NOTE), original, 'utf8');
}

test.beforeEach(async () => {
  await resetVault('e2e-vault');
});

test('读取失败：中文说明 + 重试/回首页，且不出现工程词', async ({ page }) => {
  const original = await breakNote();
  try {
    await page.goto(`/project/${encodeURIComponent(PROJECT)}`);
    const box = page.getByTestId('error-page');
    await expect(box).toBeVisible({ timeout: 120_000 });
    await expect(box).toContainText('这一步没读出来。');
    await expect(box).toContainText('刷新重试；还不行就检查文件管理里的资料。');
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
    await expect(page.getByRole('link', { name: '回首页' })).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('Application error');
    expect(text).not.toMatch(FORBIDDEN);
  } finally {
    await restoreNote(original);
  }
});

test('修好之后点「重试」回到原页面', async ({ page }) => {
  const original = await breakNote();
  try {
    await page.goto(`/project/${encodeURIComponent(PROJECT)}`);
    await expect(page.getByTestId('error-page')).toBeVisible({ timeout: 120_000 });
    await restoreNote(original);
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByTestId('error-page')).toBeHidden({ timeout: 120_000 });
    await expect(page.locator('body')).toContainText(PROJECT);
  } finally {
    await restoreNote(original);
  }
});

test('「回首页」能离开错误页', async ({ page }) => {
  const original = await breakNote();
  try {
    await page.goto(`/project/${encodeURIComponent(PROJECT)}`);
    await expect(page.getByTestId('error-page')).toBeVisible({ timeout: 120_000 });
    await restoreNote(original);
    await page.getByRole('link', { name: '回首页' }).click();
    await expect(page).toHaveURL(new RegExp(`^${BASE_URL}/$`));
  } finally {
    await restoreNote(original);
  }
});
