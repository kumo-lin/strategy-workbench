/** Notes carry the machine's calendar day, not the UTC day (JST 00:00–09:00 used to land on yesterday). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localDate } from '@/lib/local-date';
import { requestReview } from '@/lib/workplan/review-flow';
import { makeM1Vault, ROLES, WS } from './helpers';

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

// 2026-10-24 16:30 UTC = 2026-10-25 01:30 in Tokyo, still 2026-10-24 09:30 in Los Angeles.
const EARLY_JST = new Date('2026-10-24T16:30:00Z');

describe('localDate', () => {
  it('follows the machine time zone', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(localDate(EARLY_JST)).toBe('2026-10-25');
    process.env.TZ = 'America/Los_Angeles';
    expect(localDate(EARLY_JST)).toBe('2026-10-24');
  });
  it('pads month and day, and rolls over at local midnight', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(localDate(new Date('2026-01-04T15:00:00Z'))).toBe('2026-01-05');
    expect(localDate(new Date('2026-01-05T14:59:59Z'))).toBe('2026-01-05');
    expect(localDate(new Date('2026-01-05T15:00:00Z'))).toBe('2026-01-06');
  });
});

describe('review file name', () => {
  let cleanup: () => Promise<void>;
  beforeEach(() => undefined);
  afterEach(async () => cleanup?.());

  it('submitted at 01:30 JST on the 25th is G1 2026-10-25, not the 24th', async () => {
    process.env.TZ = 'Asia/Tokyo';
    const m = await makeM1Vault();
    cleanup = m.cleanup;
    const { reviewPath } = await requestReview({
      vault: m.vault,
      actor: ROLES.juniorA,
      workspacePath: WS,
      gate: 'G1',
      subject: `${WS}/workplan v1.md`,
      summary: 's',
      focus: [],
      now: EARLY_JST,
    });
    expect(reviewPath).toBe(`${WS}/review/G1 2026-10-25.md`);
  });
});
