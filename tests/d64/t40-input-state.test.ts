/** T40 P0: typing is raw state; display cleaning happens only on submit. */
import { Children, isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuleExplanation } from '@/components/research/rule-explanation';
import type { ExplanationContext } from '@/lib/research/explanation-types';

const state = vi.hoisted(() => ({ at: 0, values: [] as unknown[], setters: [vi.fn(), vi.fn(), vi.fn()] }));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => { const at = state.at++; return [state.values[at], state.setters[at]]; },
  // 复核 P3: the conversation keeps a ref to its list and scrolls on new turns; neither runs outside a render here
  useRef: () => ({ current: null }),
  useEffect: () => undefined,
}));
const context: ExplanationContext = { identity: 'v2', reportName: '报告 v2', state: 'ready', interviewProvenance: 'unknown', targets: [{ id: 'key-K3', token: 'K3', label: 'K3 跨设备', kind: 'key', verdict: '访谈支持', verdictLabel: '访谈支持', members: [], recordedGaps: ['缺少留存数据'], recordedNextSteps: [] }] };
type Props = { children?: ReactNode; 'data-testid'?: string; onChange?: (e: { target: { value: string } }) => void; onSubmit?: (e: { preventDefault: () => void }) => void };
function find(node: ReactNode, match: (props: Props) => boolean): Props | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Props>(child)) continue;
    if (match(child.props)) return child.props;
    const found = find(child.props.children, match);
    if (found) return found;
  }
}
beforeEach(() => { state.at = 0; state.values = ['key-K3', '', []]; state.setters.forEach((set) => set.mockClear()); });
describe('T40 question input state', () => {
  it.each(['K3 ', ' 能改成成立吗？\n', '跨设备 shuru ', '[[项目.md#^c1]] '])('preserves the complete change event: %j', (raw) => {
    const input = find(RuleExplanation({ context }), (p) => p['data-testid'] === 'explanation-question');
    expect(input?.onChange).toBeTypeOf('function');
    input!.onChange!({ target: { value: raw } });
    expect(state.setters[1]).toHaveBeenLastCalledWith(raw);
  });
  it('cleans the question echo only on submit, appends the turn and retains the rule-based refusal', () => {
    state.values[1] = ' K3 能改成成立吗？ ';
    const form = find(RuleExplanation({ context }), (p) => typeof p.onSubmit === 'function');
    const preventDefault = vi.fn();
    form!.onSubmit!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    // 复核 P3: a conversation — the turn is appended to the earlier ones, and the box is emptied for the next question
    const append = state.setters[2].mock.lastCall![0] as (ts: unknown[]) => unknown[];
    expect(append([])).toEqual([{ question: 'K3 能改成成立吗？', answer: expect.stringMatching(/^不能/) }]);
    expect(state.setters[1]).toHaveBeenLastCalledWith('');
  });
});
