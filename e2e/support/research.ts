/**
 * D-64 T55: start an investigation by the API (for setups and rule specs). One call runs it to the end: the library
 * first, then the web for the gaps by itself (T22, D2); there is no stop to ask whether the library is enough.
 */
import { expect } from '@playwright/test';
import { apiPost, type RoleWindow } from './roles';

export async function runToDelivery(who: RoleWindow, body: { workspacePath: string; researchDir: string; mode?: 'small' | 'full' }): Promise<string> {
  const res = await apiPost(who, '/api/research/execute', body);
  expect(res.ok(), await res.text()).toBe(true);
  const text = await res.text();
  expect(text).toContain('"delivered":true');
  return text;
}
