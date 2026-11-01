/**
 * Hand a task brief to DeepSeek, write the files it returns (PRD §12.1), and gate them on
 * tsc + eslint + the acceptance tests Claude wrote; failures go back to DeepSeek (max 2 retries).
 *
 *   pnpm deepseek:task <task-brief>.md \
 *     --test tests/tree-utils.test.ts [--test <file>]... [--allow <path>]... \
 *     --context lib/vault/vault.ts --context components/ui/input.tsx
 *
 * --test (required, repeatable): acceptance tests; DeepSeek may never write them, nor anything under tests/.
 * --allow (optional, repeatable): the only paths DeepSeek may write.
 * Run it on a branch. Last line is `DEEPSEEK-TASK: PASS (attempt N)` (exit 0) or `DEEPSEEK-TASK: FAIL ...` (exit 1).
 * Uses the active provider from 90_配置/模型.md (deepseek-flash). Never prints the API key.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateText } from 'ai';
import { getModel } from '@/lib/models/provider';
import {
  buildRetryPrompt,
  checkScope,
  lintable,
  parseArgs,
  parseFiles,
  refusalCheck,
  truncateTail,
  type CheckResult,
  type TaskFile,
} from './deepseek-task-lib';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on the environment
}

const MAX_RETRIES = 2;

const SYSTEM = `You are a senior TypeScript/React engineer writing code for a Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui (radix) + zod 4 project.
Follow the task brief exactly: the exported names and signatures are a contract. Write only the files the brief asks for.
Output every file in this exact format and nothing else outside it:

=== FILE: relative/path.ts ===
<complete file content>
=== END FILE ===`;

const root = process.cwd();

// Binaries directly, not `pnpm <script>`: pnpm's deps-status check breaks in worktrees.
function run(name: string, bin: string, args: string[]): CheckResult {
  const r = spawnSync(path.join(root, 'node_modules/.bin', bin), args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`.trim();
  return { name, ok: r.status === 0, output };
}

async function main() {
  const { brief, context, tests, allow } = parseArgs(process.argv.slice(2));

  const parts = [`# Task brief\n\n${await readFile(brief, 'utf8')}`];
  for (const f of context) parts.push(`# Context file: ${f}\n\n\`\`\`\n${await readFile(f, 'utf8')}\n\`\`\``);
  for (const f of tests) parts.push(`# Acceptance test (read-only, must pass): ${f}\n\n\`\`\`\n${await readFile(f, 'utf8')}\n\`\`\``);
  const basePrompt = parts.join('\n\n');

  const { providerId, provider, model } = await getModel();
  console.log(`→ ${providerId}/${provider.model}, brief ${brief}, ${context.length} context, ${tests.length} test files`);

  let prompt = basePrompt;
  let last: CheckResult[] = [];
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const t0 = Date.now();
    const r = await generateText({ model, system: SYSTEM, prompt });
    console.log(
      `[attempt ${attempt}] ${Date.now() - t0}ms, ${r.usage.inputTokens ?? '?'} in / ${r.usage.outputTokens ?? '?'} out tokens`,
    );

    const files = parseFiles(r.text);
    const checks: CheckResult[] = [];
    const written: TaskFile[] = [];
    if (files.length === 0) {
      checks.push({
        name: 'format',
        ok: false,
        output: `No \`=== FILE: path ===\` blocks found in your response. Raw output:\n${r.text.slice(0, 2000)}`,
      });
    } else {
      const { ok, refused } = checkScope(files, { root, tests, allow });
      for (const f of ok) {
        const full = path.resolve(root, f.path);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, f.content, 'utf8');
        written.push(f);
      }
      if (refused.length) checks.push(refusalCheck(refused));
      console.log(`  wrote: ${written.map((f) => f.path).join(', ') || '(none)'}${refused.length ? `; refused: ${refused.map((x) => x.path).join(', ')}` : ''}`);
      checks.push(run('tsc --noEmit', 'tsc', ['--noEmit']));
      const toLint = lintable(written.map((f) => f.path));
      if (toLint.length) checks.push(run('eslint', 'eslint', toLint));
      checks.push(run('vitest', 'vitest', ['run', ...tests]));
    }
    console.log(`  checks: ${checks.map((c) => `${c.name} ${c.ok ? 'ok' : 'FAIL'}`).join(', ')}`);

    if (checks.every((c) => c.ok)) {
      console.log(`DEEPSEEK-TASK: PASS (attempt ${attempt})`);
      return;
    }
    last = checks;
    prompt = buildRetryPrompt(basePrompt, written, checks);
  }

  console.log(`DEEPSEEK-TASK: FAIL after ${MAX_RETRIES} retries`);
  for (const c of last.filter((x) => !x.ok)) console.log(`\n--- ${c.name} ---\n${truncateTail(c.output)}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
