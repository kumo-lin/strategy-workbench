/** D-64 T01: the confirm prompt of frame_topic counts the six D-61 slots in both halves. */
import { describe, expect, it } from 'vitest';
import { nextStep } from '@/lib/harness/tools/frame-topic';

describe('frame_topic confirm prompt', () => {
  it('says 6 项 in both halves, never 4 项', () => {
    const text = nextStep('confirm', '');
    expect(text).toContain('6 项都填满了');
    expect(text).toContain('复述这 6 项');
    expect(text).not.toContain('4 项');
  });
});
