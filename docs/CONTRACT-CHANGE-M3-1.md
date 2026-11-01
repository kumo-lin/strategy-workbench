# CONTRACT-CHANGE-M3-1：计划的问题树字段和判断词（D-39）

- 提出：M3，2026-10-25。
- 批准：开发总控台，2026-10-25。A 的依据是用户确认的问题树样稿；B 的依据是用户确认的用词对照表。
- 改的冻结文件只有一个：`lib/notes/schema.ts`。

## A. 问题树字段（P0，已实现）

**只加字段，不删、不改。旧计划照旧能解析。**

| 位置 | 字段 | 说明 |
|---|---|---|
| `researchClaimSchema` | `question?: string` | 这个假设回答的最底层子问题，必须是问句。claim 原来的 `statement` 继续存假设本身 |
| `researchClaimSchema` | `parent?: 'Q<n>' \| null` | 往下拆过的一级子问题的 id；不写或写 null，表示这个假设直接挂在一级子问题上 |
| `researchClaimSchema` | `conditions` 的每一项 | 原来只能是字符串，现在也可以写成 `{text, evidence_needed?, where?}`（对应计划里的三列表）。读取时一律用 `conditionText`（在 `lib/research/question-tree.ts`） |
| `researchPlanSchema` | `question_tree?: {id: 'Q<n>', question}[]` | 往下拆过的一级子问题；没往下拆的子问题，问句就写在它那个假设的 `question` 上 |
| `researchPlanSchema` | `mece_check?: string` | AI 写的自检：为什么不重叠、合起来没有漏、少了哪一个就答不了；人批准计划时看 |

存储里的 id **不改**：claim 还是 `C1`，要查的问题还是 `C1-Q1`。读者看到的 `Q2-1`、`H2-1`、`Q2-1.1` 由 claims 的顺序推出来，见 `questionTreeOf`、`hypothesisLabel`、`subQuestionLabel`。

**对其他 session 的影响**
- `ResearchPlanNote['claims'][number]['conditions']` 的类型变成了联合类型。读条件文字的地方要用 `conditionText`；编辑器里改文字要用 `withConditionText`，这样 `evidence_needed`、`where` 不会丢。
- 计划编辑器存盘（`savePlanVersion`）时，会把 `question`、`parent`、`question_tree`、`mece_check` 原样带过去。
- 有 `question` 的计划才走问题树。写计划时会跑 `treeChecks`（`checkPlanDraft`），批准时也会跑（`/api/research/approve`）。旧计划不跑。

## B. 判断词改存储值（P2，已实现）

依据是用户确认过的《D-39 用词对照表》：表里写明"schema 枚举、数字检查正则三处一起改"。

- `VERDICTS` 里的"需要修正"改成"需要修改"。
- 读的时候把"需要修正"当成"需要修改"（preprocess），这样旧笔记照旧能读。
- 迁移 demo-vault 和快照里已有的数据，只改这一个值，不碰别的字段。
- 测试一起改。
