/** The first-use spec may only do what a first-time user could do through the UI; these checks hold its source to that. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFirstUseSource, checkMockSource } from '@/lib/testing/first-use-rules';

const clean = `import { expect, test } from '@playwright/test';
import { readVaultFile } from '../support/vault';

test('a first run', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page.getByTestId('flow-bar')).toContainText('第 1 步');
  expect(await readVaultFile('20_项目/P/workspace.md')).toContain('拆题中');
});`;

describe('checkFirstUseSource', () => {
  it('accepts a spec that only uses the page', () => {
    expect(checkFirstUseSource(clean)).toEqual([]);
  });

  it('reports each shortcut with its line number', () => {
    const src = [
      'test("x", async ({ page }) => {',
      "  await apiPost(junior, '/x', {});",
      '  await page.evaluate(() => 1);',
      "  await writeFile(p, 'x');",
      "  await page.goto('/workspace');",
      "  await page.getByTestId('submit').click();",
      "  await fetch('http://x');",
      '});',
    ].join('\n');
    const found = checkFirstUseSource(src);
    expect(found).toHaveLength(6);
    expect(found.map((v) => /^line (\d+)/.exec(v)![1])).toEqual(['2', '3', '4', '5', '6', '7']);
  });

  it('allows only a goto to the root', () => {
    expect(checkFirstUseSource("await page.goto('/');")).toEqual([]);
    expect(checkFirstUseSource('await page.goto("/");')).toEqual([]);
    expect(checkFirstUseSource('await page.goto(url);')[0]).toMatch(/^line 1: /);
  });

  it('ignores comments and keeps line numbers after a block comment', () => {
    const src = [
      '// await page.goto("/workspace");',
      '/*',
      "  await apiPost(junior, '/x', {});",
      "  await fetch('http://x');",
      '*/',
      "await page.goto('/workspace');",
    ].join('\n');
    const found = checkFirstUseSource(src);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^line 6: /);
  });

  const spec = path.join(process.cwd(), 'e2e', 'first-use.spec.ts');
  it.skipIf(!existsSync(spec))('the first-use spec itself follows the rules', () => {
    expect(checkFirstUseSource(readFileSync(spec, 'utf8'))).toEqual([]);
  });
});

describe('checkMockSource', () => {
  it('flags branching on the words the user typed', () => {
    expect(checkMockSource("if (t.lastUser.includes('共创')) x();")).toHaveLength(1);
    expect(checkMockSource('t.lastUser.startsWith(')).toHaveLength(1);
  });

  it('accepts reading the user text and a comment about the old checks', () => {
    expect(checkMockSource('const text = t.lastUser;')).toEqual([]);
    expect(checkMockSource('// t.lastUser.includes was removed')).toEqual([]);
  });

  it.todo('lib/testing/mock-agent.ts has no lastUser keyword checks (turned on when the mock moves to the task contract)');
});
