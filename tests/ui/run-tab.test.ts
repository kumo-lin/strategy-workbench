import { describe, expect, it } from 'vitest';
import { groupRun } from '@/components/research/run-groups';
import { lastResultOf, latestRun } from '@/components/research/run-tab';
import type { ResearchUIMessage } from '@/lib/research/progress';

type TestMessage = { id: string; role: string; metadata?: unknown; parts: unknown[] };

const message = (id: string, role: string, parts: unknown[] = [], metadata?: unknown): TestMessage => ({ id, role, parts, ...(metadata === undefined ? {} : { metadata }) });
const result = (data: Record<string, unknown>) => ({ type: 'data-result', id: 'result', data });
const step = (id: string, n: number, status: 'running' | 'done' | 'skipped' | 'waiting' | 'failed') => ({
  type: 'data-step' as const,
  id,
  data: { kind: 'step' as const, id, step: n, title: `步骤 ${n}`, status },
});
const tool = (id: string, name: string, input: unknown) => ({ type: `tool-${name}`, toolCallId: id, state: 'output-available', input, output: {} });

describe('latestRun', () => {
  const start = message('start', 'user');
  const first = message('a1', 'assistant', [step('s1', 1, 'done'), step('s2', 2, 'done'), result({ awaiting: 'confirm' })]);
  const answer = message('continue', 'user', [], { continuation: true });
  const second = message('a2', 'assistant', [step('s3', 3, 'done'), result({ delivered: true })]);

  it('keeps both stages when the answer is marked as a continuation', () => {
    expect(latestRun([start, first, answer, second])).toEqual([start, first, answer, second]);
  });

  it('documents the old boundary when the answer is not marked', () => {
    const unmarked = message('continue', 'user');
    expect(latestRun([start, first, unmarked, second])).toEqual([unmarked, second]);
  });

  it('starts a new run at a later non-continuation user message', () => {
    const followUp = message('follow-up', 'user');
    expect(latestRun([start, first, followUp, second])).toEqual([followUp, second]);
  });

  it('ignores any number of continuation answers when finding the run start', () => {
    const anotherAnswer = message('continue-2', 'user', [], { continuation: true });
    const third = message('a3', 'assistant');
    expect(latestRun([start, first, answer, second, anotherAnswer, third])).toEqual([start, first, answer, second, anotherAnswer, third]);
  });

  it('returns everything without a user message, and an empty list unchanged', () => {
    expect(latestRun([first, second])).toEqual([first, second]);
    expect(latestRun([])).toEqual([]);
  });
});

describe('the merged run', () => {
  it('keeps vault steps and tools, and supersedes a waiting step once later steps exist', () => {
    const first = message('a1', 'assistant', [
      step('s1', 1, 'done'),
      step('s2:ctx', 2, 'done'),
      tool('vault-search', 'vault_search', { dir: '00_团队知识' }),
      tool('decision-read', 'vault_read', { path: '20_项目/P/决策/D.md', why: '沿 relates_to 找到已确认的决定「D」' }),
      step('s2:confirm', 2, 'waiting'),
      result({ awaiting: 'confirm' }),
    ]);
    const second = message('a2', 'assistant', [
      ...Array.from({ length: 7 }, (_, i) => step(`s${i + 3}`, i + 3, 'done')),
      result({ delivered: true }),
    ]);
    const { groups } = groupRun([message('start', 'user'), first, message('continue', 'user', [], { continuation: true }), second] as unknown as ResearchUIMessage[]);

    expect(groups[0].status).toBe('done');
    expect(groups[1].status).toBe('done');
    expect(groups[1].tools.map((t) => t.name)).toEqual(['vault_search', 'vault_read']);
    expect(groups[1].decisionReads).toBe(1);
    expect(groups.map((g) => g.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'done']);
  });
});

describe('lastResultOf', () => {
  it('returns the data of the last result, or null when there is none', () => {
    const first = result({ awaiting: 'confirm' });
    const last = result({ delivered: true, reportName: '报告 v2' });
    expect(lastResultOf([first, { type: 'data-step', data: {} }, last])).toEqual(last.data);
    expect(lastResultOf([{ type: 'data-step', data: {} }])).toBeNull();
  });
});
