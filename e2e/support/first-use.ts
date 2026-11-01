/**
 * Helpers the first-use spec uses to judge what a first-time user actually sees: no internal names
 * in the visible text, and an oriented page (who I am, which step, what is next, who is waiting).
 * Locators here are text and roles, never test ids.
 */
import { expect, type Page } from '@playwright/test';
import { findInternals } from '../../lib/testing/internal-names';

/** The page must contain no internal names in its visible text (file names, tool names, ids, folder paths). */
export async function expectNoInternals(page: Page, allow?: RegExp[]): Promise<void> {
  await expect
    .poll(async () => findInternals(await page.locator('body').innerText(), allow), { message: 'internal names visible on the page' })
    .toEqual([]);
}

export type Orientation = {
  who: string | RegExp; // e.g. 'Junior A': visible somewhere on the page (the name plate)
  step: string | RegExp; // e.g. /第 4 步/: visible somewhere
} & ({ next: string | RegExp; waitingFor?: never } | { waitingFor: string | RegExp; next?: never });

/** The four questions: who am I, which step, what do I do next, who waits for whom. Locators are what a user sees: text and roles, never test ids. */
export async function expectOriented(page: Page, o: Orientation): Promise<void> {
  await expect(page.getByText(o.who).first(), `who am I: ${String(o.who)}`).toBeVisible();
  await expect(page.getByText(o.step).first(), `which step: ${String(o.step)}`).toBeVisible();
  if (o.waitingFor !== undefined) {
    await expect(page.getByText(o.waitingFor).first(), `who is waited for: ${String(o.waitingFor)}`).toBeVisible();
    await expect(
      page.getByText(/等待|在等/).first(),
      'dead end: no visible next action and nobody is named as being waited for',
    ).toBeVisible();
    return;
  }
  const action = page.getByRole('button', { name: o.next }).or(page.getByRole('link', { name: o.next })).first();
  await expect(action, 'dead end: no visible next action and nobody is named as being waited for').toBeVisible();
  await expect(action, `next action is disabled: ${String(o.next)}`).toBeEnabled();
}
