/**
 * Smoke test for the model layer against the real provider.
 *
 *   pnpm smoke:model                     # active provider, plain request
 *   MODEL_PROVIDER=deepseek-pro pnpm smoke:model
 *   pnpm smoke:model --tools             # + one harness tool round trip (on a temp copy of the vault)
 *
 * Reads keys from the environment (.env.local is loaded if present). Never prints keys.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateText, stepCountIs } from 'ai';
import { buildToolContext, buildToolsForPhase } from '@/lib/harness';
import { getModel } from '@/lib/models/provider';
import { createVault, getVault } from '@/lib/vault';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: rely on the environment
}

async function main() {
  const { providerId, provider, model } = await getModel();
  console.log(`provider=${providerId} model=${provider.model} base=${provider.base_url}`);

  const t0 = Date.now();
  const plain = await generateText({ model, prompt: '用一句中文回答：1+1 等于几？' });
  console.log(`plain (${Date.now() - t0}ms): ${plain.text.trim()}`);

  if (!process.argv.includes('--tools')) return;

  const tmp = await mkdtemp(path.join(tmpdir(), 'sw-smoke-'));
  try {
    await cp(getVault().root, tmp, { recursive: true });
    const vault = createVault(tmp);
    const ctx = await buildToolContext({
      vault,
      role: { id: 'junior-a', name: 'Junior A', kind: 'junior' },
      workspacePath: '20_项目/个人AI战略/WS-A 买方',
      track: 'workspace',
    });
    const t1 = Date.now();
    const r = await generateText({
      model,
      tools: buildToolsForPhase(ctx),
      stopWhen: stepCountIs(4),
      prompt: '用 vault_search 在资料库里检索关键词"采购"，然后用一句话告诉我找到了哪条资料。',
    });
    const calls = r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    console.log(`tools (${Date.now() - t1}ms) phase=${ctx.phase} offered=[${Object.keys(buildToolsForPhase(ctx)).join(',')}]`);
    console.log(`tool calls: ${calls.join(', ') || '(none)'}`);
    console.log(`answer: ${r.text.trim()}`);
    console.log('log rows:', (await vault.readLog(ctx.logPath)).map((l) => `${l.action} ${l.change}`));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
