# 接口契约（M0 → M1 / M2 / C）

> 写给并行开发的 M1（工作循环）、M2（Deep Research）、C（内容）三个 session。
> 规格的唯一依据是 PRD（不在本仓库里）。本文只规定**代码层面的接口、目录约定和文件归属**。本文和 PRD 冲突时，停下来问开发总控台，不要自己改。
> 版本：M0（2026-10-24）。

---

## 0. 一页看懂

| 你是 | 从这里开始 | 你的文件 | 不能动 |
|---|---|---|---|
| **M1 工作循环** | `components/chat/`（对话面板、工具卡片、提问卡片）→ Workspace 页 → G1 审批路由 → comment 意图解读 | §5.2 | §5.1 的冻结文件 |
| **M2 Deep Research** | `lib/harness/prompts/research-*.ts` → `ingest_source` → 调查页 → 计划批准路由 → 自检和报告 | §5.3 | §5.1 的冻结文件 |
| **C 内容** | `demo-vault/` 里的所有笔记 | §5.4 | 所有代码 |

三条硬规则：
1. **只改分给你的文件**（§5）。要改冻结文件，先写变更请求（§6）。
2. **不加依赖**。确实需要，写进报告，由总控台统一加（避免 `pnpm-lock.yaml` 冲突）。
3. **开发时不要写真 vault**：`pnpm dev:scratch` 会把 `demo-vault/` 复制到 `.scratch/vault`（已 gitignore）再启动。`demo-vault/` 只有 C 改。

完成标准：`pnpm typecheck && pnpm lint && pnpm test` 全部通过。

---

## 1. 命令和环境

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动，读写 `demo-vault/` |
| `pnpm dev:scratch` | 复制一份 vault 到 `.scratch/vault` 再启动（M1/M2 开发用这个） |
| `pnpm test` / `pnpm typecheck` / `pnpm lint` | vitest / tsc / eslint |
| `pnpm deepseek:task <任务书.md> --test <验收测试>... [--allow <可写路径>...] [--context <文件>...]` | 把任务书交给 DeepSeek，返回的文件写进当前分支，再跑 tsc / eslint / 验收测试，不过则带报错让它重试（最多 2 次）；末行 `DEEPSEEK-TASK: PASS (attempt N)` 或 `FAIL`（PRD §12.1） |

- 环境变量：见 `.env.example`。`.env.local` 由用户填；worktree 里用 `ln -s <主 checkout>/.env.local .env.local` 链过去，不要复制、不要打印。
- `VAULT_DIR`：vault 根目录，默认 `./demo-vault`。`MODEL_PROVIDER`：临时覆盖 `模型.md` 的 `active`。
- 技术栈：Next.js 16.1（App Router）、React 19.2、TypeScript 5、Tailwind 4、shadcn/ui（radix-ui）、lucide-react、zustand、zod 4、AI SDK v6（`ai`、`@ai-sdk/openai`、`@ai-sdk/react`）、vitest、playwright。

---

## 2. vault

### 2.1 目录（PRD §9.1）

```
demo-vault/
  00_团队知识/{方法库,专家输入}/
  10_资料库/<资料名>.md
  20_项目/<项目名>/
      项目.md
      假设/<WS代号>-H<n> <短述>.md
      决策/<决策名>.md
      会议/<YYYY-MM-DD> <会议名>.md
      <Workspace 名>/
          workspace.md
          workplan v<N>.md          每个版本一个文件，旧版本不改
          调查/<调查名>/计划 v<N>.md、报告 v<N>.md
          review/<关卡> <YYYY-MM-DD>.md
          日志.md                   每个 Workspace 必须有
  90_配置/{角色,节奏,团队,模型}.md
```

- 现有种子：项目 `个人AI战略`，Workspace `WS-A 买方`（owner Junior A）、`WS-B 用户`（owner Junior B）。
- **workplan 用 `workplan v<N>.md`**，不是 PRD §9.1 写的单个 `workplan.md`（理由：§8 引用 `[[workplan v3]]`，且"每个版本都留"）。
- 以 `.` 开头的文件和文件夹、`*.tmp` 对所有 vault 方法不可见。空文件夹用 `.gitkeep` 占位。

### 2.2 笔记格式

markdown + YAML frontmatter。schema 在 `lib/notes/schema.ts`（`noteSchema`，按 `type` 区分）。

**公共字段**（每条笔记都有）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 小写 ascii slug | 例：`ws-a-h1` |
| `type` | `source` `project` `workspace` `hypothesis` `workplan` `research_plan` `report` `decision` `meeting` `review` `log` `knowledge` `config` | 团队知识用 `knowledge`，配置用 `config` |
| `status` | `进行中` `推断` `已确认` `已否决` `探索性` | AI 只能写进行中、推断、探索性；已确认、已否决只能由人的审批事件设 |
| `created` / `updated` | `YYYY-MM-DD` 或 ISO datetime 字符串 | YAML 里加引号；读取时不会被转成 Date |
| `author` | 角色名（`90_配置/角色.md` 的 `name`）或 `AI` | |
| `derived_from` / `relates_to` | `"[[双链]]"` 列表 | **写入时都不能为空，且每个链接都必须能解析**（§9.3） |

各类型的专有字段：直接看 `lib/notes/schema.ts`，每个字段都有注释。几个要点：

- 人才能设的字段：`approved_by`、`approved_at`、`approved_by_owner`、`verdict`、`decided_by`。AI 写的笔记里这些一律是 `null`。
- `research_plan.claims[].sub_questions[].id` 形如 `C1-Q2`，`web_search` / `web_fetch` 必须带上它（只查计划里的子问题）。
- `review.gate` 多了一个 `结论`（PRD §9.2 只列了 G1/G2/G3，但 §6.4 有结论审批）。
- `source.authority`：DeepSeek Search 返回的整数（实测 1–5，常见 3），预置资料为 `null`。

### 2.3 链接约定

- 写法：`[[笔记]]`（按文件名）、`[[目录/笔记]]`（按 vault 相对路径，不带 `.md`）、`[[笔记#^c3]]`（块）、`[[x|显示名]]`（别名）。
- **文件名在整个 vault 里不唯一时必须写完整路径**。`workspace`、`日志`、`workplan v1`、`计划 v1`、`报告 v1` 在每个 Workspace 都有，所以一律写成 `[[20_项目/个人AI战略/WS-A 买方/workplan v1|workplan v1]]`。写入工具遇到有歧义的链接会拒绝（`ambiguous`）。
- `资料库`、`假设`、`决策`、`会议` 的文件名要全 vault 唯一，可以直接短链。

### 2.4 资料笔记里的论断和引用（§6.3.1 步骤 4、§9.7）

资料笔记的正文里，每条论断一行，行尾打块标记：

```markdown
## 论断
- 「原文那一句。」— 位置：p.12 ^c1
- 「另一句。」— 位置：第 3 节 ^c2
```

- 块标记规则（`lib/vault/blocks.ts`）：列表项或引用行 → 那一行；普通段落 → 整段；单独一行的 `^id` → 上面那段。代码块里的不算。同一笔记内块 id 不能重复。
- 报告里引用：`论断……（B 级，网络 · AI 定级）[[资料名#^c1]]`。
- **要让自检核对原文，就把原文用引号放在链接前面**：`“原文那一句” [[资料名#^c1]]`。`check_citations` 会检查块存在，以及引号里的话是否出现在块里（忽略空白和标点）。

### 2.5 comment 和 workplan 修改（M1 和 C 的约定）

- Senior 的 comment 写在 `review/<关卡> <日期>.md` 的正文里，每条一行，行尾 `^m1`、`^m2`……
- `workplan.changes[]` 每项 `{ comment: "[[…/review/G1 2026-10-24#^m1]]", intent: "理解到的意图", change: "改了什么" }`。

### 2.6 日志（§9.2 log）

`日志.md` 是 `type: log` 的笔记，正文是一张只追加的表：`| 时间 | 执行者 | 动作 | 改了什么 | 为什么 |`。

- 动作的写法：`tool:<工具名>`（AI 工具调用，由 harness 自动写）、`event:<事件类型>`（人的审批事件，由 `applyApprovalEvent` 写）、其他自定义如 `write:workplan v2`。
- 只能通过 `vault.appendLog` 写，`vault.readLog` 读。

---

## 3. 服务端库（冻结）

全部只在服务端用（API route、server component、server action）。

### 3.1 vault —— `@/lib/vault`

```ts
import { getVault } from '@/lib/vault';
const vault = getVault();                     // VAULT_DIR 或 ./demo-vault
```

| 方法 | 说明 |
|---|---|
| `list(dir?, { recursive? })` | 文件夹在前，只列 `.md` |
| `tree(dir?)` | 嵌套树，首页用 |
| `exists(path)` / `read(path)` | `read` 返回 `{ path, title, data, note, issues, body }`；`note` 是校验过的 frontmatter，不合法时为 `null`，原因在 `issues` |
| `readTyped(path, type)` | 不是这个类型就抛 `VaultError('validation')` |
| `search({ query?, where?, types?, dir?, limit? })` | 关键词（空格分隔，全部命中，不区分大小写）+ frontmatter 过滤（值相等；数组字段包含；数组值表示任一） |
| `resolveLink(link, fromPath?)` | → `{ ok, path }` 或 `{ ok: false, error: 'not_found' \| 'ambiguous' }` |
| `write(path, { frontmatter, body }, { overwrite?, checkLinks? })` | 校验 schema → 检查 `derived_from`/`relates_to` 非空且能解析 → 先写临时文件再改名。默认不覆盖 |
| `appendLog(logPath, entry)` / `readLog(logPath)` | §2.6 |
| `getBlocks(path)` | `Map<id, { id, text, line }>` |
| `checkCitation(link, { quote? })` / `checkCitations(text)` | 结果里 `error` 为 `note_not_found` \| `ambiguous` \| `block_not_found` \| `quote_mismatch` |

错误统一是 `VaultError`，`code` 为 `invalid_path` `not_found` `exists` `validation` `links_missing` `links_unresolved`。

文件变化：`subscribeVaultChanges(root, cb)`（进程内共享一个 watcher）；浏览器端已有 `GET /api/vault/events`（SSE）和 `<VaultLiveRefresh />`（layout 里已挂），任何 vault 文件变化都会 `router.refresh()`。

### 3.2 配置和模型 —— `@/lib/config/*`、`@/lib/models/provider`

- `90_配置/模型.md`：`active` + `providers.<id> = { label, base_url, api_key_env, model }` + `web_tools`。所有 provider 走 OpenAI 兼容的 Chat Completions（`createOpenAI(...).chat(model)`）。
- `getModel()` → `{ providerId, provider, model }`，每次调用都重读配置，改配置不用重启。
- 现有 provider：`deepseek`（`deepseek-flash`，默认）、`deepseek-pro`（`deepseek-v4-pro`）、`openrouter`（等 key）。DeepSeek 只认 `deepseek-flash` 和 `deepseek-v4-pro` 两个名字。
- `90_配置/角色.md`：`roles: [{ id, name, kind: senior|junior }]`。当前角色：服务端 `getCurrentRole()`（`@/lib/session/role`，读 cookie `sw-role`）。

### 3.3 DeepSeek Search / Fetch —— `@/lib/deepseek`

`getWebToolsClient()` → `{ search({ query, count, need_content }), fetch({ url }) }`。返回类型 `SearchResult`（`url` `title` `site_name` `site_icon` `date` `summary` `snippet` `rerank_score` `authority` `content`）和 `FetchResponse`（`title` `content`），已对照线上接口核过。

---

## 4. harness（冻结）—— `@/lib/harness`

### 4.1 阶段和工具

```ts
type Phase = 'workplan' | 'research_plan' | 'research_execute' | 'conclusion';
```

| 工具 | workplan | research_plan | research_execute | conclusion | 实现 | 归属 |
|---|---|---|---|---|---|---|
| `ask_user` | ✓ | ✓ | ✓ | ✓ | 客户端工具 | M0（卡片 UI：M1） |
| `vault_list` / `vault_read` / `vault_search` | ✓ | ✓ | ✓ | ✓ | ✓ | M0 |
| `write_draft` | workplan、hypothesis | research_plan | report | report | ✓ | M0 |
| `web_search` / `web_fetch` | | | ✓ | | ✓（最小实现） | **M2** |
| `ingest_source` | | | ✓ | | 待做 | **M2** |
| `check_citations` | | | ✓ | ✓ | ✓ | M0 |
| `submit_for_review` | ✓ | | | ✓ | 待做 | **M1** |
| `propose_decision` / `propose_knowledge` | | | | ✓ | 待做 | M3（以后） |

- 表来自 PRD §10.2（`PHASE_TOOLS`、`WRITE_DRAFT_SCOPE`，在 `lib/harness/phases.ts`，测试逐项比对）。
- **只有 `implemented: true` 的工具会传给模型**（`toolNamesForPhase`）。实现了就把自己文件里的 `implemented` 改成 `true`。
- conclusion 阶段的 `write_draft` 只能写 report：PRD 写的"骨架、成稿"不是 §9.2 的笔记类型；演示里结论阶段的产出就是定稿的报告（§6.2 第 6 步）。

**阶段由服务端算，模型和客户端都改不了**：

```ts
resolvePhase({ track: 'workspace', stage })  // 拆题中 / workplan待审 / 执行中 → workplan；结论待审及以后 → conclusion
resolvePhase({ track: 'research', plan })    // 最新一版计划已批准 → research_execute，否则 research_plan
```

`track` 是界面告诉服务端"人在哪个界面上"（工作循环还是某个调查），不是模型选的。计划"已批准"= `status: 已确认` 且 `approved_by_owner`、`approved_at` 都有值，三者缺一不可。

### 4.2 工具接口

```ts
interface ToolSpec<P extends z.ZodObject, R> {
  name: ToolName;
  description: string;
  parameters: P;                                   // 模型看到的参数；registry 自动加一个可选的 why
  execute?: (args: z.infer<P>, ctx: ToolContext) => Promise<R>;   // 没有 = 客户端工具
  summarize?: (args, result) => string;            // 日志"改了什么"那一列
  owner: 'M0' | 'M1' | 'M2' | 'M3';
  implemented: boolean;
}
```

- `ToolContext`（`lib/harness/types.ts`）：`phase` `vault` `role` `projectPath` `workspacePath` `workspace` `logPath` `research?{ dir, planPath, plan }` `exploratory` `now` `webTools()` `abortSignal`。由 `buildToolContext({ vault, role, workspacePath, track, researchDir? })` 构建。
- **每次调用都写日志**：`executeTool(name, args, ctx)` 统一做三件事：再查一遍阶段（不在当前阶段就抛 `ToolNotAllowedError`）、校验参数、把结果写进 `日志.md`（成功、失败都写）。工具自己不要写日志。
- `ask_user` 没有服务端 execute：模型调用后，这一轮停下，界面显示卡片；用户回答后用 `addToolOutput({ tool: 'ask_user', toolCallId, output: { selected: [...ids], text? } })` 传回（输出格式见 `askUserOutputSchema`）。`runAgent` 会把提问写进日志。
- `write_draft` 的系统规则（不靠 prompt）：类型必须在本阶段范围内；文件只能落在该类型的目录（§2.1）；`author` 强制为 `AI`；人才能设的字段一律清空；已批准或人确认过的笔记不能覆盖（要写新版本）；G1 之前写的计划和报告自动 `exploratory: true`、状态 `探索性`。

### 4.3 审批事件（只有人的审批事件能改阶段）

```ts
type ApprovalEvent =
  | { type: 'review.request' | 'review.approve' | 'review.reject'; actor: Role; workspace; gate; subject }
  | { type: 'research_plan.approve'; actor: Role; workspace; plan }
  | { type: 'decision.confirm' | 'decision.reject'; actor: Role; decision }
  | { type: 'verdict.set'; actor: Role; hypothesis; verdict };

await applyApprovalEvent(vault, event, { logPath, reason });   // 不允许就抛 ApprovalDenied
```

| 事件 | 谁能做 | 效果 |
|---|---|---|
| `review.request` G1 / 结论 | Workspace 的 owner | 拆题中→workplan待审 / 执行中→结论待审 |
| `review.approve` G1 | Workspace 的 reviewer（senior） | →执行中，清掉 `返工中`；workplan 写上 `approved_by` `approved_at`、`status: 已确认` |
| `review.approve` 结论 | reviewer | 结论待审→撰写中 |
| `review.reject` | reviewer | 退回上一阶段，加 `返工中` |
| `research_plan.approve` | Workspace 的 owner | 计划 `已确认` + `approved_by_owner` + `approved_at` → 调查工具解锁 |
| `decision.confirm` / `reject` | senior | `推断` → `已确认` / `已否决`，写 `decided_by` |
| `verdict.set` | 任何人类角色 | 写 `hypothesis.verdict` |

- 纯函数 `planApprovalEvent(event, state, now)` 可以单独测。G2/G3 的转换也定义了（完整形态）。
- 事件只能从人点的按钮触发（M1/M2 的 API route 里调用 `applyApprovalEvent`）。**不要做成 AI 工具。**
- 建 review 笔记、记 comment 这些附带动作，由 M1/M2 在自己的 route 里、`applyApprovalEvent` 前后完成。

### 4.4 agent 接口 —— `POST /api/agent`

请求体（`lib/harness/agent-request.ts`）：

```ts
{ messages: UIMessage[]; workspacePath: '20_项目/<项目>/<Workspace>'; track: 'workspace' | 'research'; researchDir?: string }
```

服务端：读 cookie 得到角色 → `buildToolContext` 算阶段 → 系统提示 = `basePrompt`（§7 的通用规则）+ 阶段 prompt → `runAgent`（只带本阶段的工具，最多 12 步）→ UI message stream。助手消息的 `metadata.phase` 是本轮的阶段。

客户端用法（M1/M2）：

```tsx
const { messages, sendMessage, addToolOutput } = useChat({
  transport: new DefaultChatTransport({ api: '/api/agent', body: { workspacePath, track: 'research', researchDir } }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,   // 回答 ask_user 后自动继续
});
```

工具卡片直接渲染 `message.parts` 里 `type: 'tool-<名字>'` 的部分（`state`、`input`、`output`、`errorText`）。

阶段 prompt 放在 `lib/harness/prompts/<阶段>.ts`，签名 `(ctx: ToolContext) => Promise<string>`。context 组装（方法库 skill、相关决定、workplan、最近日志，§10.2）在这些函数里做。

已用真实 DeepSeek 端到端验证过：vault_search → vault_read → ask_user 停下 → 回答后继续。

---

## 5. 文件归属

### 5.1 冻结（M0）—— 不要改，改动走 §6

```
lib/notes/**  lib/vault/**  lib/config/**  lib/models/**  lib/deepseek/**  lib/session/**
lib/harness/{index,phases,types,registry,events,guards,context,runner,agent-request}.ts
lib/harness/prompts/{index,base}.ts
lib/harness/tools/{ask-user,vault-tools,write-draft,check-citations}.ts
app/layout.tsx  app/globals.css  app/actions.ts  app/page.tsx
app/api/agent/**  app/api/vault/**
components/shell/**  components/vault/**
tests/{vault,harness,models,runner,demo-vault,tree-utils}.test.ts  tests/helpers/**
scripts/**  docs/CONTRACTS.md
package.json  pnpm-lock.yaml  pnpm-workspace.yaml  tsconfig.json  eslint.config.mjs  vitest.config.mts  next.config.ts  components.json
```

`components/ui/**`：**只能新增文件，不改已有的**。要的组件已经有了就直接用。

`THIRD_PARTY_NOTICES`：只能在文件末尾追加自己的一段。M1 要复制的对话组件（question-card、tool-card、chat-timeline）已经登记了，不用再加。

### 5.2 M1 工作循环

```
app/workspace/**                       Workspace 页（建议 /workspace/[project]/[workspace]），除 research/ 子目录
app/api/workspace/**                   G1 / 结论的 review request、通过、打回；comment
components/chat/**                     对话面板、工具卡片、提问卡片、时间线（M2 直接用，要改提给 M1）
components/workspace/**
lib/workplan/**                        版本、comment 意图、changes
lib/harness/prompts/{workplan,conclusion}.ts
lib/harness/tools/review-tools.ts      submit_for_review（同文件里的 propose_* 留给 M3，别删）
tests/m1/**  e2e/m1/**
```

- 中文路径段在 URL 里会被编码，`params` 要 `decodeURIComponent`。
- Workspace 页的布局（`app/workspace/[project]/[workspace]/layout.tsx`）归 M1，里面放一个"调查"标签页，链接到 `./research`。

### 5.3 M2 Deep Research

```
app/workspace/[project]/[workspace]/research/**   调查列表、某次调查（计划 / 报告 / 版本切换）
app/api/research/**                               计划批准（调用 research_plan.approve）等
components/research/**
lib/research/**                                   计划、入库、定级、停止规则、报告格式、自检
lib/harness/prompts/{research-plan,research-execute}.ts
lib/harness/tools/web-tools.ts                    web_search / web_fetch / ingest_source
tests/m2/**  e2e/m2/**
```

- 新调查的目录：`<Workspace>/调查/<调查名>/`，第一版计划由 `write_draft`（research_plan 阶段）写成 `计划 v1.md`。
- 入库的资料写进 `10_资料库/`，要符合 `sourceSchema`（`origin: 网络`、`graded_by: AI`、`authority` 用搜索结果的值），正文按 §2.4 打 `^cN`。`ingest_source` 可以直接用 `vault.write`（M2 的工具，不受 `write_draft` 的范围限制）。

### 5.4 C 内容

```
demo-vault/**        除了 90_配置/模型.md 的 providers 键名和 90_配置/角色.md 的 id（代码依赖它们）
```

- `pnpm test` 里的 `tests/demo-vault.test.ts` 会检查每条笔记：schema 合法、`derived_from`/`relates_to` 非空且能解析、正文里的每个 `[[x#^cN]]` 都存在。改完跑一遍。
- 现有的种子笔记都是占位，标了"M0 占位"，可以整篇替换或删掉（删的时候注意别的笔记有没有链到它）。
- 顶层四个文件夹（`00_团队知识`、`10_资料库`、`20_项目`、`90_配置`）不能改名。

### 5.5 测试怎么写

- 用 `makeFixtureVault(extra?)`（`tests/helpers/fixture-vault.ts`）在临时目录建一个小 vault，不要依赖 `demo-vault/` 的内容。需要更多笔记就通过 `extra` 传进去，或者放在 `tests/fixtures/<m1|m2>/`。
- 模型用 `MockLanguageModelV3`（`ai/test`），写法见 `tests/runner.test.ts`。

---

## 6. 改冻结文件：变更请求

1. 在共享笔记目录写 `CONTRACT-CHANGE-<你的 session>-<序号>.md`：要改哪个文件、改成什么、为什么、对另外两个 session 的影响。
2. 给开发总控台发消息。
3. 批准之前，在自己的文件里绕过去（比如包一层），不要直接改。

---

## 7. M0 和 PRD 不一致、或需要拍板的地方

| # | 位置 | 情况 | M0 的处理 |
|---|---|---|---|
| 1 | §9.1 vs §8 | §9.1 写 `workplan.md`，§8 引用 `[[workplan v3]]`、且要求"每个版本都留" | 用 `workplan v<N>.md` |
| 2 | §9.2 `review.gate` | 只列 G1/G2/G3，但 §6.4 有"结论审批" | 加了 `结论` |
| 3 | §10.2 结论阶段 `write_draft` | "骨架、成稿"不是 §9.2 的笔记类型 | 演示里映射成 `report`；S3 做 G2/G3 时再加类型 |
| 4 | §6.3.1 第 8 步 vs §10.2 | AI 要给每个论点提判断（`hypothesis.verdict_proposed`），但执行阶段的 `write_draft` 只能写报告 | **待拍板**。目前判断只能写在报告里；`verdict_proposed` 没有写入途径 |
| 5 | §10.2 关卡 / §6.6 | "只有人的审批事件能改阶段"，但 PRD 没说 Workspace 的 stage 怎么对应到 4 个工具阶段，也没说"Junior 发起 review request"算不算审批事件 | stage + 界面所在的 track 算出阶段（§4.1）；`review.request` 算人的事件 |
| 6 | §9.4 | 状态只定义了"内容"的取值；资料、配置、日志、review 用什么没说 | 所有笔记共用同一组状态；AI 定级的资料是 `推断` |
| 7 | §6.6 | 结论通过之后、`骨架待审` 之前没有阶段名 | 结论通过 → `撰写中` |
| 8 | §9.2 团队知识 / 配置 | 没给 `type` 的英文值 | `knowledge` / `config` |
| 9 | §4 / §6.9 | AI 不能直接写团队知识，但 `propose_knowledge` 的提议存在哪里没说 | 留给 M3 |
| 10 | §12.1 | 分工表把"vault 工具"放在 DeepSeek 一栏 | M0 由 Claude 写（总控台笔记说用户已同意挪栏） |

---

变更请求 D63（D-64 执行，To-Be 契约）：见 [docs/CONTRACT-CHANGE-D63.md](CONTRACT-CHANGE-D63.md)。
