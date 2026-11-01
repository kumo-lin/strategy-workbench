/** Evidence factory shared by the unit tests. */
import type { Evidence } from '@/lib/research/evidence';

let n = 1000;
export function ev(over: Partial<Evidence> = {}): Evidence {
  n++;
  return {
    ref: `[[s${n}#^c1]]`,
    path: `10_资料库/s${n}.md`,
    block: 'c1',
    text: '「x」— 位置：p',
    quote: 'x',
    sourceName: `s${n}`,
    publisher: `Pub${n}`,
    url: `https://pub${n}-site.com/a`,
    grade: 'B',
    origin: '网络',
    gradedBy: 'AI',
    published: '2026-01-01',
    claimId: 'C1',
    subQuestionId: 'C1-Q1',
    round: 'web1',
    stance: 'supports',
    reason: '',
    core: false,
    partial: false,
    ...over,
  };
}
