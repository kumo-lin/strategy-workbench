/**
 * A tiny self-contained vault written to a temp dir per test, so tests never
 * depend on demo-vault content (which milestone C rewrites).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVault, type Vault } from '@/lib/vault';

const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') =>
  `---
id: ${id}
type: ${type}
status: ${status}
created: "2026-10-24"
updated: "2026-10-24"
author: ${author}
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}
---
`;

export const FIXTURE: Record<string, string> = {
  '90_配置/团队.md': `${common('config-team', 'config', 'team: 战略部')}\n# 团队\n`,
  '90_配置/角色.md': `${common(
    'config-roles',
    'config',
    `roles:
  - { id: senior, name: Senior, kind: senior }
  - { id: junior-a, name: Junior A, kind: junior }
  - { id: junior-b, name: Junior B, kind: junior }`,
  )}\n# 角色\n`,
  '90_配置/模型.md': `${common(
    'config-models',
    'config',
    `active: alpha
providers:
  alpha: { label: Alpha, base_url: "https://alpha.example.com/v1", api_key_env: ALPHA_KEY, model: alpha-1 }
  beta: { label: Beta, base_url: "https://beta.example.com/v1", api_key_env: BETA_KEY, model: beta-1 }
web_tools: { base_url: "https://alpha.example.com", api_key_env: ALPHA_KEY }`,
  )}\n# 模型\n`,
  '10_资料库/资料甲.md': `${common(
    'src-a',
    'source',
    `url: "https://example.com/a"
publisher: 示例机构
published: "2026-09-01"
retrieved: "2026-10-24"
origin: 网络
grade: B
graded_by: AI
authority: 3
link_checked: true`,
    'AI',
    '推断',
  )}
# 资料甲

## 论断

- 「IT 可管理性是企业采购 AI PC 的首要考量。」— 位置：p.3 ^c1
- 「预算主要来自 IT 部门。」— 位置：p.5 ^c2

一段跨两行的
段落论断。 ^c3

\`\`\`
代码里的 ^c9 不算
\`\`\`
`,
  '20_项目/P/项目.md': `${common(
    'proj-p',
    'project',
    `owner: Senior
sponsor: VP
core_question: 问题？
roadmap: [{ week: W2, topic: 买单 }]
dependencies: []`,
  )}\n# 项目\n`,
  '20_项目/P/WS-A/workspace.md': `${common(
    'ws-a',
    'workspace',
    `week: W2
owner: Junior A
reviewer: Senior
stage: 拆题中
flags: []
depends_on: []`,
  )}\n# WS-A\n`,
  '20_项目/P/WS-A/workplan v1.md': `${common(
    'ws-a-wp-v1',
    'workplan',
    `version: 1
approved_by: null
approved_at: null
changes: []`,
    'Junior A',
    '进行中',
  )}\n# workplan v1\n`,
  '20_项目/P/WS-A/日志.md': `${common('ws-a-log', 'log', '', 'AI', '进行中')}\n# 日志\n`,
  '20_项目/P/WS-B/workspace.md': `${common(
    'ws-b',
    'workspace',
    `week: W2
owner: Junior B
reviewer: Senior
stage: 执行中
flags: []
depends_on: []`,
  )}\n# WS-B\n`,
  '20_项目/P/WS-B/日志.md': `${common('ws-b-log', 'log', '', 'AI', '进行中')}\n# 日志\n`,
  '.obsidian/app.json': '{}',
};

export async function makeFixtureVault(extra: Record<string, string> = {}): Promise<{ vault: Vault; root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'sw-vault-'));
  for (const [rel, text] of Object.entries({ ...FIXTURE, ...extra })) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
  return { vault: createVault(root), root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export const ROLES = {
  senior: { id: 'senior', name: 'Senior', kind: 'senior' as const },
  juniorA: { id: 'junior-a', name: 'Junior A', kind: 'junior' as const },
  juniorB: { id: 'junior-b', name: 'Junior B', kind: 'junior' as const },
};
