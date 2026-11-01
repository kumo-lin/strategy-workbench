import { expect, type Page } from '@playwright/test';

/** Pick an option on the pending question card (matched by its question) and send the answer. */
export async function answerQuestion(page: Page, question: string, option: string): Promise<void> {
  const card = page.getByTestId('question-card').filter({ hasText: question });
  await expect(card).toHaveAttribute('data-state', 'input-available');
  await card.getByRole('button', { name: option }).click();
  await card.getByRole('button', { name: '发送回答' }).click();
  await expect(card).toHaveAttribute('data-state', 'output-available');
}

/**
 * A name for a new investigation that is new on THIS server, also when a serial group is retried (or repeated):
 * a finished research run can be re-attached for 10 minutes by investigation name, so reusing the name would
 * bring the last attempt's run back into a page that is supposed to be blank.
 */
export const attemptName = (base: string, retry: number): string => (retry === 0 ? base : `${base} ${retry + 1}`);

/** Unfold the 要查的问题 of the n-th hypothesis card on the plan page (folded by default; open stays open until the page reloads). */
export async function openSubQuestions(page: Page, leaf = 0): Promise<void> {
  const details = page.getByTestId('plan-leaf').nth(leaf).getByTestId('plan-sub-questions');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
}

/**
 * D-64 复核 A: what a reader sees is in their own words — no wiki syntax, internal file names or ids, English engineering
 * terms, tool names or model ids (those belong to 方法与配置 and the log). Each hit is reported with its context.
 * Not in the list: the faint "（Q1）" tags of the report's appendix, which point at its own "Q1 …" sections.
 */
export const ENGINEERING_WORDS = /\[\[|#\^|项目\.md|C\d+-Q\d+|· c\d+\b|\bvault\b|workplan|\bcomment\b|\bgrill\b|storyline|read_task_context|set_selection|draft_contract|draft_issue_tree|write_draft|deepseek-|kimi-k/i;

/** `except`: lines a page may show on purpose (the config page lists model ids). */
export async function expectReaderWords(page: Page, except?: RegExp): Promise<void> {
  const text = await page.locator('main').innerText();
  const hits = text.split('\n').filter((l) => ENGINEERING_WORDS.test(l) && !except?.test(l)).map((l) => l.trim().slice(0, 120));
  expect(hits, 'engineering words on the page').toEqual([]);
}

/**
 * 复核 D: the page does not scroll sideways, and is not taller than the window on the research steps (their columns
 * scroll inside). Green tests with a broken screen came from asserting only that elements exist.
 */
export async function expectFitsWindow(page: Page, opts: { height?: boolean } = {}): Promise<void> {
  const m = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
  expect(m.w, 'no horizontal scroll').toBeLessThanOrEqual(m.iw);
  if (!opts.height || m.h <= m.ih + 2) return;
  // name what sticks out: the outermost elements that end below the window
  const culprits = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().bottom > innerHeight + 2 && (e.parentElement?.getBoundingClientRect().bottom ?? 0) <= innerHeight + 2)
      .slice(0, 5)
      .map((e) => {
        const chain: string[] = [];
        for (let p = e.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) {
          const cs = getComputedStyle(p);
          chain.push(`${p.tagName.toLowerCase()}[${p.getAttribute('data-testid') ?? p.getAttribute('data-slot') ?? ''}] pos=${cs.position} ov=${cs.overflowY} h=${Math.round(p.getBoundingClientRect().height)}`);
        }
        return `${e.tagName.toLowerCase()}[${e.getAttribute('data-testid') ?? ''}] .${String(e.className).slice(0, 60)} bottom=${Math.round(e.getBoundingClientRect().bottom)} < ${chain.join(' < ')}`;
      }),
  );
  expect(m.h, `no page-level scroll on a research step; sticking out: ${culprits.join(' | ')}`).toBeLessThanOrEqual(m.ih + 2);
}
