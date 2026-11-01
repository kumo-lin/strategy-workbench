/**
 * CONTRACT-CHANGE-M3-1 B (D-39 用词对照表): the verdict 需要修正 is now 需要修改, in the stored value too. An older note
 * or a model that still writes the old word is read as the new one; the demo vault and its snapshots were migrated
 * (only that value, no other field).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hypothesisSchema, normalizeVerdict, VERDICTS, verdictSchema } from '@/lib/notes/schema';
import { judgmentSchema } from '@/lib/research/schemas';

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : f.endsWith('.md') ? [path.join(dir, f)] : []));

describe('需要修正 → 需要修改', () => {
  it('the five verdicts (D63 adds 访谈支持)', () => {
    expect(VERDICTS).toEqual(['成立', '不成立', '需要修改', '访谈支持', '证据不足']);
  });

  it('the old word is read as the new one: a stored verdict, a hypothesis note, a judgment from the model', () => {
    expect(normalizeVerdict('需要修正')).toBe('需要修改');
    expect(verdictSchema.parse('需要修正')).toBe('需要修改');
    expect(verdictSchema.safeParse('部分成立').success).toBe(false);
    const hyp = hypothesisSchema.safeParse({ id: 'h', type: 'hypothesis', status: '推断', created: '2026-10-25', updated: '2026-10-25', author: 'AI', derived_from: [], relates_to: [], workspace: '[[w]]', statement: 's', verdict_proposed: '需要修正', verdict: null, evidence: [], counter_evidence: [] });
    expect(hyp.success && hyp.data.verdict_proposed).toBe('需要修改');
    expect(judgmentSchema.parse({ verdict: '需要修正', reasoning: 'r' }).verdict).toBe('需要修改');
  });

  it('no frontmatter value in demo-vault (and its snapshots) still says 需要修正', () => {
    const left = walk('demo-vault').flatMap((f) => {
      const text = readFileSync(f, 'utf8');
      const fm = text.startsWith('---\n') ? text.split('\n---\n')[0] : '';
      return fm.split('\n').filter((l) => /^\s*(?:verdict_proposed|verdict|C\d+):\s*需要修正\s*$/.test(l)).map((l) => `${f}: ${l.trim()}`);
    });
    expect(left).toEqual([]);
  });
});
