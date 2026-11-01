/**
 * Create a project by hand (D-56 ⑤c): `20_项目/<名字>/项目.md` and its 日志.md in the existing format.
 * Senior only, and a name that already exists is refused (macOS file systems are case-insensitive).
 */
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import { localDate } from '@/lib/local-date';
import { VaultError, type Vault } from '@/lib/vault';

const PROJECTS_DIR = '20_项目';
const MAX_NAME = 40;
/** Characters a folder name may not contain (Windows rules plus Obsidian's link syntax). */
const BAD_CHARS = ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']'];

export interface CreateProjectInput {
  vault: Vault;
  /** From the cookie (getCurrentRole), never from the request body. */
  actor: Role;
  /** Folder name, e.g. `企业AI助手`; trimmed. */
  name: string;
  /** The top-level question; becomes the note title. */
  coreQuestion: string;
  /** Optional: which decision the answer supports. */
  supportsDecision?: string;
  /** Test seam. */
  now?: Date;
}

export interface CreateProjectResult {
  /** Trimmed name. */
  name: string;
  /** `20_项目/<name>` */
  projectPath: string;
  /** `20_项目/<name>/项目.md` */
  notePath: string;
  /** `20_项目/<name>/日志.md` */
  logPath: string;
}

export class ProjectCreateError extends Error {
  name = 'ProjectCreateError';

  constructor(
    readonly code: 'invalid_name' | 'exists',
    message: string,
  ) {
    super(message);
  }
}

/** The trimmed folder name, or `ProjectCreateError('invalid_name')`. */
export function validateProjectName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ProjectCreateError('invalid_name', '项目名不能为空');
  if (name.length > MAX_NAME) throw new ProjectCreateError('invalid_name', `项目名最多 ${MAX_NAME} 个字`);
  if (BAD_CHARS.some((c) => name.includes(c)) || /[\r\n]/.test(name)) {
    throw new ProjectCreateError('invalid_name', '项目名不能包含 / \\ : * ? " < > | # ^ [ ] 或换行');
  }
  if (name.startsWith('.')) throw new ProjectCreateError('invalid_name', '项目名不能以 . 开头');
  return name;
}

/** Entries directly under `20_项目`; none when the folder does not exist yet. */
async function projectEntries(vault: Vault) {
  try {
    return await vault.list(PROJECTS_DIR);
  } catch (e) {
    if (e instanceof VaultError && e.code === 'not_found') return [];
    throw e;
  }
}

function projectBody(coreQuestion: string, supportsDecision: string | undefined): string {
  return `# ${coreQuestion}

## 顶层问题和它支撑的决策

**问题**：${coreQuestion}
**支撑的决策**：${supportsDecision ?? '待定'}

## 议题树

| 枝 | 要回答 | 周 | Workspace | 假设（草稿） |
|---|---|---|---|---|
`;
}

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const { vault, actor, now = new Date() } = input;
  if (actor.kind !== 'senior') throw new ApprovalDenied('只有 Senior 能新建项目');

  const name = validateProjectName(input.name);
  const coreQuestion = input.coreQuestion.trim();
  const supportsDecision = input.supportsDecision?.trim() || undefined;

  const lower = name.toLowerCase();
  if ((await projectEntries(vault)).some((e) => e.name.toLowerCase() === lower)) {
    throw new ProjectCreateError('exists', `已经有一个叫「${name}」的项目了`);
  }

  const projectPath = `${PROJECTS_DIR}/${name}`;
  const notePath = `${projectPath}/项目.md`;
  const logPath = `${projectPath}/日志.md`;
  const idBase = now.getTime().toString(36);
  const date = localDate(now);

  await vault.write(notePath, {
    frontmatter: {
      id: `proj-${idBase}`,
      type: 'project',
      status: '进行中',
      created: date,
      updated: date,
      author: actor.name,
      derived_from: ['[[团队]]'],
      relates_to: ['[[团队]]'],
      owner: actor.name,
      sponsor: '待定',
      core_question: coreQuestion,
      roadmap: [],
      dependencies: [],
    },
    body: projectBody(coreQuestion, supportsDecision),
  });

  // Full path: every project has a 项目.md, so `[[项目]]` would be ambiguous.
  const projectLink = `[[${notePath.replace(/\.md$/, '')}|项目]]`;
  await vault.write(logPath, {
    frontmatter: {
      id: `proj-log-${idBase}`,
      type: 'log',
      status: '进行中',
      created: date,
      updated: date,
      author: actor.name,
      derived_from: [projectLink],
      relates_to: [projectLink],
    },
    body: `# ${name} 日志\n`,
  });
  await vault.appendLog(logPath, {
    time: now.toISOString(),
    actor: actor.name,
    action: 'event:project.create',
    change: `新建项目「${name}」`,
    reason: `${actor.name} 点了"新建项目"`,
  });

  return { name, projectPath, notePath, logPath };
}
