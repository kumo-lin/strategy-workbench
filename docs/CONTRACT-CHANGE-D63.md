# 契约变更请求 D63（D-64 执行）

> 2026-10-27。依据：D-64 执行手册（不在本仓库里）第 3 节（决定 D6：用这一份变更请求一次性修改冻结的 `lib/notes/schema.ts` 和 `docs/CONTRACTS.md`，只改第 3 节列出的内容）。
> 本文逐条抄录手册第 3 节，每条写明影响的文件和读旧数据怎么兼容。各条由哪张卡落地写在“卡”一列。

## 1. 笔记类型和字段

| 改动 | 内容 | 影响的文件 | 读旧数据 | 卡 |
|---|---|---|---|---|
| 新增 type `contract` | 决策契约，路径 `20_项目/<项目>/决策契约.md`。字段见 1.1。`approved_by`、`approved_at` 只能由人的事件写 | `lib/notes/schema.ts`（`NOTE_TYPES`、按 type 的 schema） | 新类型，旧 vault 里没有，不涉及 | T10 |
| `project` 增加 `issue_tree`，`roadmap`、`dependencies` 改为可选 | 结构见 1.2 | `lib/notes/schema.ts` | 旧项目带 `roadmap`、`dependencies`、没有 `issue_tree`，照样通过；界面没有 `issue_tree` 时退回旧显示，不报错 | T10、T34 |
| `workspace` 的 `week` 改为可选，增加 `item` | `item` 是议题树里的子课题编号，例如 `M1`。界面不再显示周 | `lib/notes/schema.ts` | 旧 workspace 带 `week`，照样通过 | T10 |
| `VERDICTS` 增加 `访谈支持` | 顺序：`成立`、`不成立`、`需要修改`、`访谈支持`、`证据不足`。规则见第 3 节 | `lib/notes/schema.ts`（`VERDICTS`）、`lib/research/schemas.ts`（引用它）、`lib/research/evidence.ts` | 只加值，旧数据都在原集合里 | T10、T11 |
| `meeting` 增加 `kind` | `'会议' \| '访谈'`，缺省按 `'会议'` 读。访谈记录是 `kind: 访谈` 的 meeting，路径 `20_项目/<项目>/访谈/<名字>.md`，`simulated` 照实标 | `lib/notes/schema.ts` | 缺 `kind` 读为 `会议` | T10 |
| `decision` 增加 `scope` | 适用边界。schema 里是可选（读旧决定不报错）；`proposeDecision` 写入时由代码检查必须非空 | `lib/notes/schema.ts`、`lib/decisions/propose.ts` | 旧决定没有 `scope`，照样通过 | T10、T17 |
| `report`、`decision` 增加 `published_by`、`published_at` | 发布为公司资产，只能由人的事件写 | `lib/notes/schema.ts`、`lib/harness/guards.ts` | 可选字段，旧数据没有即“未发布” | T10、T18 |
| `source` 增加 `fetched_in` | 可选，记录“哪次调查时联网获取”（调查目录的路径） | `lib/notes/schema.ts` | 可选 | T10、T22 |
| `research_plan` 的 claim 增加 `key`、`if_bad` | `key`：`'K1' \| 'K2' \| 'K3' \| 'K4'`，可选，表示这个假设属于哪个关键问题；`if_bad`：结果不理想会改变什么决定 | `lib/notes/schema.ts`（`researchClaimSchema` 定义在这里，手册写的 `lib/research/schemas.ts` 只是引用） | 可选，旧计划没有 | T10 |
| `HUMAN_ONLY_FIELDS` 增加 | `published_by`、`published_at`。contract 的 `approved_by`、`approved_at` 已经在列 | `lib/harness/guards.ts` | 不涉及读 | T10 |
| `MODEL_ROLES` 增加 `review` | `模型.md` 的 `roles` 可以写 `review: kimi` | `lib/config/models.ts`、`lib/research/citation-verify.ts`（`secondJudgeModel`） | 没配 `review` 时保持现有行为 | T10、T13 |

### 1.1 决策契约的字段，和 frame 槽位的对应

D-61 的 frame 有 6 个槽位（`SLOT_KEYS`）：`question`、`decision`、`scope`、`success`、`known`、`bar`。**槽位不改。** `draft_contract` 工具把槽位整理成契约的结构化字段：

| 契约字段 | 类型 | 来自哪个槽位 | 例子（M1 课题） |
|---|---|---|---|
| `question` | string | question（改写后） | 联想应在个人 AI 中占据什么战略位置？2027 年应优先投入哪些方向？ |
| `original_question` | string，可空 | 用户最初输入的题目 | 个人 AI 市场将如何演进，对联想意味着什么？ |
| `decision` | string | decision | 战略定位、优先机会、资源配置 |
| `decision_owner` | string | decision（谁做决定） | 智能设备业务群 · 个人 AI 战略与产品管理层 |
| `horizon` | string | scope | 2027 行动；展望 2028–2030 |
| `geography` | string | scope | 全球；中国单独分析 |
| `product_scope` | string | scope | PC、手机、平板、可穿戴及连接它们的个人 AI 服务 |
| `out_of_scope` | string[] | scope | 企业级 AI 基础设施、基础模型研发 |
| `success` | string | success | 能决定 2027 年的投入方向 |
| `known` | string[] | known | 联想 2026 年 1 月已发布 Qira |
| `bar` | string | bar | 关键判断至少 2 个独立来源 |

### 1.2 议题树（`project.issue_tree`）

```ts
issue_tree: {
  question: string;                       // 要回答的问题
  lines: {
    id: string;                           // 'A' | 'B'
    title: string;                        // '市场如何演进'
    question: string;                     // '什么决定竞争成败？'
    owner: string | null;                 // 角色 id，例如 'junior-a'
    items: {
      id: string;                         // 'M1'
      title: string;                      // '哪些用户会持续使用'
      workspace: string | null;           // Workspace 文件夹名，未开展为 null
      waits_for: string[];                // 例如 L2: ['M1']，画面显示“等 M1 的决定”
    }[];
  }[];
}
```

子课题的状态（未开始、深挖中、等 M1 的决定、已完成）由代码按 Workspace 的 stage 和 `waits_for` 推出，不存。

## 2. 新的 JSON 侧车文件

| 文件 | 位置 | 内容 | 读旧数据 | 卡 |
|---|---|---|---|---|
| `资料选择.json` | Workspace 目录 | `{ version: 1, excluded: string[], starred: string[], web: boolean }`，路径是 vault 内路径，`web` 缺省为 `true` | 文件不存在 = 全选、无星标、可联网 | T14 |
| `.judgment.json` 增加字段 | 报告旁 | `reasons: { title: string; basis: { text: string; kind: '事实' \| '推断' \| '访谈支持'; source: string; refs: string[] }[] }[]`（最多 3 条，`source` 是来源的显示名，例如“Pew 2026”或“访谈-重度用户”）；`gaps: { question: string; missing: string; how: string }[]`；`recommendations: { title: string; how: string }[]`（取代旧的单数 `recommendation`） | 读旧文件时把旧的 `recommendation` 转成一条；没有 `reasons` 的旧报告按旧渲染器显示（含冻结的 v10、v7） | T23 |
| `citation_verify.items[]` 增加 | 报告 frontmatter | `can: string`（能支持什么）、`cannot: string`（不能支持什么） | 可选，旧报告没有时弹窗不显示这两栏 | T24 |
| `访谈命中.json` | 调查目录 | `{ interview: string; claims: string[]; reason: string }[]` | 新文件 | T25 |

影响的文件：`lib/research/selection.ts`（新）、`lib/research/report.ts`、`lib/research/schemas.ts`、`lib/research/citation-verify.ts`、`lib/research/interview-followup.ts`（新）。

## 3. 判断等级的规则（代码执行，`lib/research/evidence.ts`）

对单个假设（claim），按顺序判断，前面的成立就停：

1. 有未被驳倒的强反证（A/B 级、核心）→ `不成立`（现有规则，不改）。
2. 公开资料满足现有“成立”条件（至少 2 个独立来源、最好的支持是 A/B 级、没有未驳倒的反证）→ `成立`。
3. 公开资料不够“成立”，但至少有 1 条访谈（真实或模拟）支持，且没有未驳倒的反证 → `访谈支持`。
4. 其他 → `证据不足`。

- 模型提议“成立”但只满足第 3 条：代码降为 `访谈支持`，note 写“访谈样本少，只能提到访谈支持”。
- `需要修改` 的现有规则不变。

**关键问题的判断**（一个 K 下有 1 到 3 个假设），用于报告的缺口表、v1 和 v2 的变化表、画面显示：
- 取这个 K 下各假设中最好的一个；
- 好坏顺序：`成立` > `需要修改` > `访谈支持` > `证据不足` > `不成立`；
- 显示时 `需要修改` 写作“部分支持”。

读旧数据：旧报告里没有 `访谈支持`，按原值显示。卡：T11。

## 4. 停止规则（`stopReason`）

- `StopInput.lastRoundNewEvidence: number | null` 改为 `newEvidenceByRound: number[]`。
- 最后两轮都是 0 才返回 `no_new_evidence`。
- 其他条件不变。
- 调用点在 `lib/research/run.ts`（第 651 行附近）。

影响的文件：`lib/research/evidence.ts`、`lib/research/run.ts`。不涉及存储的数据。卡：T12。

## 5. 七步解题法和各阶段的检查项

harness 仍是 4 个阶段，七步映射如下。“检查”由代码执行，不满足就打回或拒绝写入。

| 七步 | 阶段 | 检查（代码） |
|---|---|---|
| 1 定义问题 | `workplan`（framing） | 6 个槽位齐全；`compose_workplan` 只有在 `决策契约.md` 的 status 为“已确认”时才放出 |
| 2 拆解问题 | `workplan`（compose） | 每个子问题以“？”结尾（不是问句从警告升为错误）；每个假设 `falsifier` 非空；大题的叶子上限从 8 改为 12 |
| 3 排优先级 | `workplan`（compose） | 标出 1 到 4 个关键问题（`knockout: true`），每个有 `ifBad` |
| 4 制定工作计划 | `research_plan`（调查计划） | 调查计划里出现的每个关键问题，下面有 2 到 3 个竞争假设，每个都有条件、证据、去哪里查；分析师批准后才进入执行 |
| 5 调查分析 | `research_execute` | 第一步必须是读取任务背景（T20）；内部资料不够自动联网（T22）；连续两轮没有新证据就停 |
| 6 综合结论 | `research_execute` | 报告按固定结构渲染（T23）；判断等级按第 3 节 |
| 7 提出建议 | `conclusion` | 每条建议至少引用一条报告里的判断；决定必须有适用边界 |

影响的文件：`lib/workplan/compose/gate.ts`、`tree.ts`、`render.ts`、`lib/research/plan-checks.ts`、`lib/harness/tools/task-context.ts`（新）、`lib/research/execute.ts`、`lib/decisions/*`。卡：T20、T21、T22、T23、T17。

## 5a. 实施时补的接口（D-64 T33、T37）

手册 T33、T37 要求新阶段 `project_framing`、`files_chat`，落到冻结的接口上是下面几处，都是加法，旧调用不变：

| 接口 | 改动 | 兼容 |
|---|---|---|
| `PHASES`、`PHASE_TOOLS`（`lib/harness/phases.ts`） | 加 `project_framing`，工具只有 `read_task_context`、`ask_user`、`frame_topic`、`draft_contract`、`draft_issue_tree`；`TOOL_NAMES` 加后两个 | 旧阶段的工具表不变 |
| `POST /api/agent` 请求体（`lib/harness/agent-request.ts`） | `track` 加 `project`；这时 `workspacePath` 填项目目录 `20_项目/<项目>` | 旧的 `workspace`、`research` 不变 |
| `PHASES`、`PHASE_TOOLS`（T37） | 加 `files_chat`，工具只有 `read_task_context`、`vault_search`、`set_selection`；`set_selection` 只提议，人在卡片上同意才写 `资料选择.json` | 旧阶段不变 |
| `POST /api/agent`（T37） | `track` 再加 `files`（文件管理页的对话） | 同上 |
| `ToolContext`（`lib/harness/context.ts`） | 新函数 `buildProjectContext`：还没有 Workspace，项目目录代替它（日志写项目的 `日志.md`，定题状态写项目下的 `拆题/`） | `buildToolContext` 对旧 track 不变 |

## 6. 不改的

- `demo-vault/` 主 vault 和 `.snapshots/` 下已有的快照（D5）。
- 除上面列出的以外的 schema 字段。要改，先问用户（手册 2.4）。
