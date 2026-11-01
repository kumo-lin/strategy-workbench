/** Pure helpers for scripts/deepseek-task.ts: arg parsing, response parsing, scope check, retry prompt. */
import path from 'node:path';

export const USAGE =
  'usage: deepseek-task <brief.md> --test <file>... [--allow <path>...] [--context <file>...]';

export type TaskArgs = { brief: string; context: string[]; tests: string[]; allow: string[] };
export type TaskFile = { path: string; content: string };
export type Refusal = { path: string; reason: string };
export type CheckResult = { name: string; ok: boolean; output: string };

const FLAGS = { '--context': 'context', '--test': 'tests', '--allow': 'allow' } as const;

/** argv without node/script. Throws on a missing brief, a flag without value, an unknown flag, or no --test. */
export function parseArgs(argv: string[]): TaskArgs {
  const out: TaskArgs = { brief: '', context: [], tests: [], allow: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value\n${USAGE}`);
      out[FLAGS[a as keyof typeof FLAGS]].push(v);
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag ${a}\n${USAGE}`);
    } else if (!out.brief) {
      out.brief = a;
    } else {
      throw new Error(`unexpected argument ${a}\n${USAGE}`);
    }
  }
  if (!out.brief) throw new Error(USAGE);
  if (out.tests.length === 0) throw new Error(`at least one --test <file> is required\n${USAGE}`);
  return out;
}

export function parseFiles(text: string): TaskFile[] {
  const out: TaskFile[] = [];
  const re = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
  for (const m of text.matchAll(re)) {
    let content = m[2];
    // tolerate a markdown fence wrapped around the content
    const fenced = /^```[a-z]*\n([\s\S]*?)\n```\s*$/.exec(content);
    if (fenced) content = fenced[1];
    out.push({ path: m[1].trim(), content: content.endsWith('\n') ? content : `${content}\n` });
  }
  return out;
}

export type Scope = { root: string; tests: string[]; allow: string[] };

/** Split returned files into writable ones and refusals (tests, outside repo, outside --allow). */
export function checkScope(files: TaskFile[], scope: Scope): { ok: TaskFile[]; refused: Refusal[] } {
  const rel = (p: string) => path.relative(scope.root, path.resolve(scope.root, p));
  const tests = new Set(scope.tests.map(rel));
  const allow = new Set(scope.allow.map(rel));
  const ok: TaskFile[] = [];
  const refused: Refusal[] = [];
  for (const f of files) {
    const r = rel(f.path);
    let reason: string | null = null;
    if (r === '' || r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) reason = 'is outside the repo';
    else if (tests.has(r)) reason = 'is an acceptance test file; tests are read-only';
    else if (r.split(path.sep)[0] === 'tests') reason = 'is under tests/; tests are read-only';
    else if (/\.test\.tsx?$/.test(r)) reason = 'is a .test.ts(x) file; tests are read-only';
    else if (allow.size > 0 && !allow.has(r)) reason = `is not in the allowed paths (${[...allow].join(', ')})`;
    if (reason) refused.push({ path: f.path, reason });
    else ok.push(f);
  }
  return { ok, refused };
}

/** Keep the last `max` chars (the tail of a check log holds the errors). */
export function truncateTail(s: string, max = 4000): string {
  return s.length <= max ? s : `[...truncated ${s.length - max} chars]\n${s.slice(-max)}`;
}

const LINTABLE = /\.[cm]?[jt]sx?$/;
export const lintable = (paths: string[]) => paths.filter((p) => LINTABLE.test(p));

export function refusalCheck(refused: Refusal[]): CheckResult {
  return {
    name: 'scope',
    ok: refused.length === 0,
    output: refused.map((r) => `refused to write ${r.path}: it ${r.reason}`).join('\n'),
  };
}

/** Original prompt + what was written + failing check outputs + the fix instruction. */
export function buildRetryPrompt(basePrompt: string, written: TaskFile[], checks: CheckResult[]): string {
  const parts = [basePrompt];
  parts.push(
    `# Your previous attempt (files as currently on disk)\n\n` +
      (written.length
        ? written.map((f) => `## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
        : '(no files were written)'),
  );
  parts.push(
    `# Failing checks\n\n` +
      checks
        .filter((c) => !c.ok)
        .map((c) => `## ${c.name}\n\n\`\`\`\n${truncateTail(c.output)}\n\`\`\``)
        .join('\n\n'),
  );
  parts.push(
    'Fix the failures above. Return the complete corrected files, in the same `=== FILE: path ===` format. ' +
      'Do not modify the tests, and do not write any test file; change only the implementation files the brief asks for.',
  );
  return parts.join('\n\n');
}
