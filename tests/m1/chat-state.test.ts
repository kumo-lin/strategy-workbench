/** Acceptance tests for task M1-1.1 chat components (pure helpers). Written before the code. */
import { describe, expect, it } from 'vitest';
import {
  askUserInputOf,
  buildAskUserAnswer,
  describeAnswer,
  formatJson,
  toggleSelection,
  toolLabel,
  toolNameOf,
  toolStatusOf,
  toolSummary,
} from '@/components/chat/chat-state';
import { STATUS_META } from '@/components/ui/status-badge';
import { NOTE_STATUSES } from '@/lib/notes/schema';

describe('toolNameOf', () => {
  it('reads static tool parts', () => {
    expect(toolNameOf({ type: 'tool-ask_user' })).toBe('ask_user');
    expect(toolNameOf({ type: 'tool-vault_read' })).toBe('vault_read');
  });
  it('reads dynamic tool parts', () => {
    expect(toolNameOf({ type: 'dynamic-tool', toolName: 'web_search' })).toBe('web_search');
  });
  it('returns null for non-tool parts', () => {
    expect(toolNameOf({ type: 'text' })).toBeNull();
    expect(toolNameOf({ type: 'reasoning' })).toBeNull();
    expect(toolNameOf({ type: 'step-start' })).toBeNull();
  });
});

describe('toolStatusOf', () => {
  it('maps the AI SDK part states', () => {
    expect(toolStatusOf({ state: 'input-streaming' })).toBe('running');
    expect(toolStatusOf({ state: 'input-available' })).toBe('running');
    expect(toolStatusOf({ state: 'output-available' })).toBe('done');
    expect(toolStatusOf({ state: 'output-error' })).toBe('error');
    expect(toolStatusOf({ state: 'output-denied' })).toBe('error');
  });
});

describe('toolLabel', () => {
  it('has a Chinese label for every harness tool and falls back to the raw name', () => {
    for (const n of ['ask_user', 'vault_list', 'vault_read', 'vault_search', 'write_draft', 'web_search', 'web_fetch', 'ingest_source', 'check_citations', 'submit_for_review', 'frame_topic', 'compose_workplan']) {
      expect(toolLabel(n)).not.toBe(n);
    }
    expect(toolLabel('mystery_tool')).toBe('mystery_tool');
  });
});

describe('toolSummary', () => {
  it('shows the most telling argument per tool', () => {
    expect(toolSummary('vault_read', { path: '10_资料库/资料甲.md' })).toBe('10_资料库/资料甲.md');
    expect(toolSummary('vault_search', { query: 'IT 可管理性' })).toBe('IT 可管理性');
    expect(toolSummary('vault_list', { dir: '10_资料库' })).toBe('10_资料库');
    expect(toolSummary('vault_list', { dir: '' })).toBe('/');
    expect(toolSummary('ask_user', { question: '这个 workplan 要支撑什么决策？' })).toBe('这个 workplan 要支撑什么决策？');
    expect(toolSummary('write_draft', { note_type: 'workplan', body: 'x' })).toBe('workplan');
  });
  it('falls back to the first short string value, truncated, and tolerates junk', () => {
    expect(toolSummary('other', { a: 1, b: 'hello' })).toBe('hello');
    expect(toolSummary('other', { b: 'x'.repeat(200) }).length).toBeLessThanOrEqual(81);
    expect(toolSummary('other', undefined)).toBe('');
    expect(toolSummary('vault_read', 'not an object')).toBe('');
  });
});

describe('formatJson', () => {
  it('pretty-prints, truncates long output and never throws', () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatJson(undefined)).toBe('');
    expect(formatJson('plain')).toBe('plain');
    const long = formatJson({ s: 'x'.repeat(10_000) }, 100);
    expect(long.length).toBeLessThanOrEqual(101 + 20);
    expect(long).toContain('…');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => formatJson(cyclic)).not.toThrow();
  });
});

describe('askUserInputOf', () => {
  it('parses a complete input', () => {
    expect(
      askUserInputOf({ question: 'Q?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], multiSelect: true }),
    ).toEqual({ question: 'Q?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], multiSelect: true });
  });
  it('defaults and tolerates a partially streamed input', () => {
    expect(askUserInputOf({ question: 'Q?' })).toEqual({ question: 'Q?', options: [], multiSelect: false });
    expect(askUserInputOf({ question: 'Q?', options: [{ id: 'a', label: 'A' }, { id: 'b' }] })?.options).toEqual([{ id: 'a', label: 'A' }]);
    expect(askUserInputOf({})).toBeNull();
    expect(askUserInputOf(undefined)).toBeNull();
    expect(askUserInputOf('x')).toBeNull();
  });
});

describe('toggleSelection', () => {
  it('single select replaces; clicking the selected one clears it', () => {
    expect(toggleSelection([], 'a', false)).toEqual(['a']);
    expect(toggleSelection(['a'], 'b', false)).toEqual(['b']);
    expect(toggleSelection(['a'], 'a', false)).toEqual([]);
  });
  it('multi select toggles and keeps order of clicking; does not mutate', () => {
    const start = ['a'];
    expect(toggleSelection(start, 'b', true)).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(start).toEqual(['a']);
  });
});

describe('buildAskUserAnswer', () => {
  it('is null until there is something to send', () => {
    expect(buildAskUserAnswer({ selected: [], text: '' })).toBeNull();
    expect(buildAskUserAnswer({ selected: [], text: '   ' })).toBeNull();
  });
  it('matches the ask_user output schema', () => {
    expect(buildAskUserAnswer({ selected: ['a'], text: '' })).toEqual({ selected: ['a'] });
    expect(buildAskUserAnswer({ selected: [], text: '  自己的想法 ' })).toEqual({ selected: [], text: '自己的想法' });
    expect(buildAskUserAnswer({ selected: ['a', 'b'], text: '补充' })).toEqual({ selected: ['a', 'b'], text: '补充' });
  });
});

describe('describeAnswer', () => {
  const options = [
    { id: 'a', label: '选项 A' },
    { id: 'b', label: '选项 B' },
  ];
  it('renders picked labels and free text', () => {
    expect(describeAnswer(options, { selected: ['a', 'b'] })).toBe('选项 A、选项 B');
    expect(describeAnswer(options, { selected: [], text: '我自己的' })).toBe('我自己的');
    expect(describeAnswer(options, { selected: ['b'], text: '补充' })).toBe('选项 B；补充');
  });
  it('keeps unknown ids visible instead of dropping them', () => {
    expect(describeAnswer(options, { selected: ['zzz'] })).toBe('zzz');
  });
});

describe('STATUS_META', () => {
  it('covers every note status with a label', () => {
    for (const s of NOTE_STATUSES) {
      expect(STATUS_META[s].label.length).toBeGreaterThan(0);
    }
    expect(Object.keys(STATUS_META).sort()).toEqual([...NOTE_STATUSES].sort());
  });
});

describe('speakerOf (who sent a user message)', () => {
  it('reads metadata.actor and ignores anything else', async () => {
    const { speakerOf } = await import('@/components/chat/chat-timeline');
    expect(speakerOf({ actor: 'Junior A' })).toBe('Junior A');
    expect(speakerOf({ actor: '  ' })).toBeNull();
    expect(speakerOf({ phase: 'workplan' })).toBeNull();
    expect(speakerOf(undefined)).toBeNull();
  });
});
