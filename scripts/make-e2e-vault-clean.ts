/**
 * Builds tests/fixtures/e2e-vault-clean, the vault the first-use E2E starts from (D-56, E2E T3).
 *
 *   pnpm exec tsx scripts/make-e2e-vault-clean.ts
 *
 * Two projects, every Workspace blank (stage 拆题中), 23 notes. Bodies come from the S3-D48 and clean
 * snapshots or from the e2e-vault fixture, so they stay byte-identical; only the edits and the three
 * new 渠道与服务 notes are written here.
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createVault, parseMarkdown } from '@/lib/vault';
import { relinkUnresolved } from './demo-snapshot-relink';

const P1 = '20_项目/个人AI战略';
const P2 = '20_项目/渠道与服务';
const P1_PROJECT_LINK = '[[20_项目/个人AI战略/项目|项目]]';
const P2_PROJECT_LINK = '[[20_项目/渠道与服务/项目|项目]]';

const METHOD_FILES = ['comment意图解读.md', 'so what提炼.md', 'storyline.md', 'workplan共创.md', '假设驱动调查.md'];
export const LIBRARY_FILES = [
  'Dell 2026-08 IT负责人谈AI PC硬件安全.md',
  'Investing.com 2026-01 摩根士丹利CIO调查AI未抬高IT预算.md',
  'Windows Report 2026-04 IT可卸载Copilot.md',
  'CIO.com 2026-01 BlackFog影子AI调查.md',
  'Gartner 2026-02 内存涨价压低出货.md',
];

const P2_PROJECT = `---
id: proj-channel-services
type: project
status: 已确认
created: "2026-10-27"
updated: "2026-10-27"
author: Senior
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
owner: Senior
sponsor: 商用业务 VP
core_question: 联想的机队服务明年怎么卖给中型企业客户？
roadmap:
  - week: W1
    topic: 中型客户怎么买机队服务
    workspaces: ["[[20_项目/渠道与服务/WS-C 中型客户/workspace|WS-C 中型客户]]"]
dependencies: []
---

# 渠道与服务

**问题**：联想的机队服务（部署、管理、设备即服务）明年怎么卖给 500–5000 人的中型企业客户？

**范围**：只看已经在用联想商用机的中型客户；大客户直销和消费者不在范围内。
`;

const WS_C_WORKSPACE = `---
id: ws-c
type: workspace
status: 进行中
created: "2026-10-27"
updated: "2026-10-27"
author: Senior
derived_from: ["[[20_项目/渠道与服务/项目|项目]]"]
relates_to: ["[[20_项目/渠道与服务/项目|项目]]"]
week: W1
owner: Junior B
assigned_by: Senior
reviewer: Senior
stage: 拆题中
flags: []
depends_on: []
---

# WS-C 中型客户

中型客户怎么买机队服务、谁拍板。
`;

/** Replace exactly `count` occurrences of `from` with `to`, or throw. */
function replaceExact(text: string, from: string, to: string, count: number): string {
  const found = text.split(from).length - 1;
  if (found !== count) throw new Error(`expected ${count}× "${from}", found ${found}`);
  return text.split(from).join(to);
}

async function copyIn(outDir: string, fromRoot: string, rels: string[]): Promise<void> {
  for (const rel of rels) {
    const dest = path.join(outDir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(path.join(fromRoot, rel), dest, { force: true });
  }
}

async function writeNote(outDir: string, rel: string, text: string): Promise<void> {
  const dest = path.join(outDir, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, text, 'utf8');
}

/** Two notes are named 项目, so `[[项目]]` is ambiguous: point it at the full path, frontmatter only. */
async function rewriteBareProjectLinks(outDir: string): Promise<void> {
  const vault = createVault(outDir);
  const files = (await vault.list('', { recursive: true })).filter((e) => e.kind === 'file');
  for (const file of files) {
    const full = path.join(outDir, file.path);
    const text = await readFile(full, 'utf8');
    const { body } = parseMarkdown(text);
    const frontmatter = text.slice(0, text.length - body.length);
    const target = file.path.startsWith(`${P2}/`) ? P2_PROJECT_LINK : P1_PROJECT_LINK;
    const rewritten = frontmatter.split('[[项目]]').join(target);
    if (rewritten !== frontmatter) await writeFile(full, rewritten + body, 'utf8');
  }
}

export async function buildE2eVaultClean(outDir: string): Promise<void> {
  const root = process.cwd();
  const S3 = path.join(root, 'demo-vault/.snapshots/S3-D48');
  const CLEAN = path.join(root, 'demo-vault/.snapshots/clean');
  const E2E = path.join(root, 'tests/fixtures/e2e-vault');

  await rm(outDir, { recursive: true, force: true });

  await copyIn(outDir, E2E, ['90_配置/团队.md', '90_配置/模型.md', '90_配置/角色.md']);
  await copyIn(outDir, S3, METHOD_FILES.map((n) => `00_团队知识/方法库/${n}`));
  await copyIn(outDir, CLEAN, ['00_团队知识/高层方针/2026财年商用PC业务方针（模拟）.md']);
  await copyIn(outDir, S3, LIBRARY_FILES.map((n) => `10_资料库/${n}`));

  // P1: the clean project, plus the meeting and the blank WS-A; WS-B comes from the e2e fixture.
  await copyIn(outDir, CLEAN, [`${P1}/项目.md`, `${P1}/会议/2026-10-16 高层周会（模拟）.md`, `${P1}/WS-A 买方/workspace.md`, `${P1}/WS-A 买方/日志.md`]);
  await copyIn(outDir, E2E, [`${P1}/WS-B 用户/workspace.md`, `${P1}/WS-B 用户/日志.md`]);

  const p1ProjectPath = path.join(outDir, `${P1}/项目.md`);
  let p1Project = await readFile(p1ProjectPath, 'utf8');
  p1Project = replaceExact(
    p1Project,
    'workspaces: ["[[20_项目/个人AI战略/WS-A 买方/workspace|WS-A 买方]]"]',
    'workspaces: ["[[20_项目/个人AI战略/WS-A 买方/workspace|WS-A 买方]]", "[[20_项目/个人AI战略/WS-B 用户/workspace|WS-B 用户]]"]',
    1,
  );
  p1Project = replaceExact(
    p1Project,
    '| W2 | [[20_项目/个人AI战略/WS-A 买方/workspace\\|WS-A 买方]] |',
    '| W2 | [[20_项目/个人AI战略/WS-A 买方/workspace\\|WS-A 买方]]；[[20_项目/个人AI战略/WS-B 用户/workspace\\|WS-B 用户]] |',
    1,
  );
  await writeFile(p1ProjectPath, p1Project, 'utf8');

  const meetingPath = path.join(outDir, `${P1}/会议/2026-10-16 高层周会（模拟）.md`);
  const meeting = replaceExact(
    await readFile(meetingPath, 'utf8'),
    'relates_to: ["[[20_项目/个人AI战略/WS-A 买方/workspace|WS-A 买方]]"]',
    'relates_to: ["[[20_项目/个人AI战略/WS-A 买方/workspace|WS-A 买方]]", "[[20_项目/个人AI战略/WS-B 用户/workspace|WS-B 用户]]"]',
    1,
  );
  await writeFile(meetingPath, meeting, 'utf8');

  // The E2E session's wording for the two workspaces (the clean demo vault keeps its own text).
  const wsAPath = path.join(outDir, `${P1}/WS-A 买方/workspace.md`);
  await writeFile(
    wsAPath,
    replaceExact(
      await readFile(wsAPath, 'utf8'),
      'IT 和 CIO 为什么买、预算从哪来。',
      '买方采购逻辑：企业买单的首要条件。',
      1,
    ),
    'utf8',
  );
  const wsBPath = path.join(outDir, `${P1}/WS-B 用户/workspace.md`);
  await writeFile(
    wsBPath,
    replaceExact(
      await readFile(wsBPath, 'utf8'),
      '员工这一侧的使用价值和采用障碍。',
      '员工实际在用什么 AI。',
      1,
    ),
    'utf8',
  );

  // P2: the new project and blank WS-C; the log is the WS-B log with its ids and links swapped.
  await writeNote(outDir, `${P2}/项目.md`, P2_PROJECT);
  await writeNote(outDir, `${P2}/WS-C 中型客户/workspace.md`, WS_C_WORKSPACE);
  let wsCLog = await readFile(path.join(E2E, `${P1}/WS-B 用户/日志.md`), 'utf8');
  wsCLog = replaceExact(wsCLog, 'id: ws-b-log', 'id: ws-c-log', 1);
  wsCLog = replaceExact(wsCLog, `[[${P1}/WS-B 用户/workspace|WS-B 用户]]`, `[[${P2}/WS-C 中型客户/workspace|WS-C 中型客户]]`, 2);
  wsCLog = replaceExact(wsCLog, '# WS-B 日志', '# WS-C 日志', 1);
  wsCLog = replaceExact(wsCLog, 'created: "2026-10-24"', 'created: "2026-10-27"', 1);
  wsCLog = replaceExact(wsCLog, 'updated: "2026-10-24"', 'updated: "2026-10-27"', 1);
  await writeNote(outDir, `${P2}/WS-C 中型客户/日志.md`, wsCLog);

  for (const dir of [
    `${P1}/WS-A 买方/review`,
    `${P1}/WS-A 买方/调查`,
    `${P1}/WS-B 用户/review`,
    `${P1}/WS-B 用户/调查`,
    `${P1}/假设`,
    `${P1}/决策`,
    `${P2}/WS-C 中型客户/review`,
    `${P2}/WS-C 中型客户/调查`,
    `${P2}/假设`,
    `${P2}/决策`,
  ]) {
    await writeNote(outDir, `${dir}/.gitkeep`, '');
  }

  await rewriteBareProjectLinks(outDir);
  // The method notes' [[项目]] now points at the P1 project; nothing else should be unresolved.
  await relinkUnresolved(createVault(outDir), P1_PROJECT_LINK);
}

// tsx compiles scripts as CommonJS, so no top-level await or import.meta here (see scripts/demo-snapshot.ts).
if (process.argv[1]?.endsWith('make-e2e-vault-clean.ts')) {
  const outDir = path.join(process.cwd(), 'tests/fixtures/e2e-vault-clean');
  void buildE2eVaultClean(outDir).then(() => console.log(`已生成 ${path.relative(process.cwd(), outDir)}`));
}
