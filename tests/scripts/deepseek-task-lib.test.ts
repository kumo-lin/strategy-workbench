import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRetryPrompt,
  checkScope,
  lintable,
  parseArgs,
  parseFiles,
  refusalCheck,
  truncateTail,
} from '../../scripts/deepseek-task-lib';

describe('parseArgs', () => {
  it('collects repeatable flags', () => {
    const a = parseArgs(['b.md', '--test', 't1.ts', '--context', 'c.ts', '--test', 't2.ts', '--allow', 'lib/a.ts']);
    expect(a).toEqual({ brief: 'b.md', context: ['c.ts'], tests: ['t1.ts', 't2.ts'], allow: ['lib/a.ts'] });
  });
  it('requires at least one --test', () => {
    expect(() => parseArgs(['b.md', '--context', 'c.ts'])).toThrow(/--test/);
  });
  it('requires a brief, a flag value, and known flags', () => {
    expect(() => parseArgs(['--test', 't.ts'])).toThrow(/usage/);
    expect(() => parseArgs(['b.md', '--test'])).toThrow(/needs a value/);
    expect(() => parseArgs(['b.md', '--test', '--allow', 'x'])).toThrow(/needs a value/);
    expect(() => parseArgs(['b.md', '--nope', 'x'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['b.md', 'c.md', '--test', 't.ts'])).toThrow(/unexpected/);
  });
});

describe('parseFiles', () => {
  it('parses multiple files and strips a fence', () => {
    const text = [
      '=== FILE: a.ts ===',
      'export const a = 1;',
      '=== END FILE ===',
      '=== FILE: b.ts ===',
      '```ts',
      'export const b = 2;',
      '```',
      '=== END FILE ===',
    ].join('\n');
    expect(parseFiles(text)).toEqual([
      { path: 'a.ts', content: 'export const a = 1;\n' },
      { path: 'b.ts', content: 'export const b = 2;\n' },
    ]);
  });
  it('returns [] when nothing matches', () => {
    expect(parseFiles('no files here')).toEqual([]);
  });
});

describe('checkScope', () => {
  const root = path.resolve('/repo');
  const f = (p: string) => ({ path: p, content: 'x\n' });
  const scope = { root, tests: ['tests/x.test.ts'], allow: [] as string[] };

  it('accepts ordinary files', () => {
    const r = checkScope([f('lib/a.ts'), f('./components/b.tsx')], scope);
    expect(r.ok.map((x) => x.path)).toEqual(['lib/a.ts', './components/b.tsx']);
    expect(r.refused).toEqual([]);
  });
  it('refuses test files, tests/, .test.ts(x) and outside-repo paths', () => {
    const r = checkScope(
      [f('tests/x.test.ts'), f('tests/helpers/h.ts'), f('lib/a.test.ts'), f('lib/a.test.tsx'), f('../evil.ts'), f('/etc/passwd')],
      scope,
    );
    expect(r.ok).toEqual([]);
    expect(r.refused).toHaveLength(6);
    expect(r.refused[4].reason).toMatch(/outside the repo/);
    expect(r.refused[5].reason).toMatch(/outside the repo/);
  });
  it('refuses a test path spelled differently', () => {
    expect(checkScope([f('./tests/../tests/x.test.ts')], scope).refused).toHaveLength(1);
  });
  it('refuses a --test file that lives outside tests/', () => {
    const r = checkScope([f('lib/spec.ts')], { ...scope, tests: ['lib/spec.ts'] });
    expect(r.refused[0].reason).toMatch(/acceptance test/);
  });
  it('enforces --allow when given', () => {
    const r = checkScope([f('lib/a.ts'), f('lib/b.ts')], { ...scope, allow: ['lib/a.ts'] });
    expect(r.ok.map((x) => x.path)).toEqual(['lib/a.ts']);
    expect(r.refused[0].path).toBe('lib/b.ts');
    expect(r.refused[0].reason).toMatch(/not in the allowed/);
  });
  it('refusalCheck reports failure with a message per file', () => {
    const c = refusalCheck([{ path: 'lib/b.ts', reason: 'is bad' }]);
    expect(c).toMatchObject({ name: 'scope', ok: false });
    expect(c.output).toContain('lib/b.ts');
    expect(refusalCheck([]).ok).toBe(true);
  });
});

describe('truncateTail / lintable', () => {
  it('keeps the tail of long output', () => {
    const s = 'a'.repeat(100) + 'END';
    const t = truncateTail(s, 10);
    expect(t.endsWith('aaaaaaaEND')).toBe(true);
    expect(t).toContain('truncated 93');
    expect(truncateTail('short', 10)).toBe('short');
  });
  it('filters lintable files', () => {
    expect(lintable(['a.ts', 'b.tsx', 'c.md', 'd.json', 'e.mjs'])).toEqual(['a.ts', 'b.tsx', 'e.mjs']);
  });
});

describe('buildRetryPrompt', () => {
  it('includes base prompt, written files, only failing checks (truncated), and the instruction', () => {
    const p = buildRetryPrompt(
      'BASE',
      [{ path: 'lib/a.ts', content: 'code\n' }],
      [
        { name: 'tsc', ok: true, output: 'fine' },
        { name: 'vitest', ok: false, output: 'x'.repeat(5000) + 'FAILTAIL' },
      ],
    );
    expect(p.startsWith('BASE')).toBe(true);
    expect(p).toContain('## lib/a.ts');
    expect(p).toContain('## vitest');
    expect(p).not.toContain('## tsc');
    expect(p).toContain('FAILTAIL');
    expect(p).toContain('truncated');
    expect(p).toMatch(/complete corrected files/);
    expect(p).toMatch(/Do not modify the tests/);
  });
});
