# 怎么用编程 Agent 做这个项目（How it was built with coding agents）

> **English summary.** This codebase (~200 library modules, ~3,000 unit tests, ~70 end-to-end tests) was written by coding agents that I directed: Claude for specs, review and gates; DeepSeek and Kimi, each running inside Claude Code as the coding backend, for implementation. The useful part is not "AI wrote it" but the setup that kept several agents working in parallel without breaking each other's work: file ownership contracts, one-task-one-spec, a guard that rejects edits to existing tests, gates judged by exit code, and a log of every task.

这个仓库约 200 个模块、约 3,000 条单元测试、约 70 条端到端测试，代码都是我指挥编程 Agent 写的。值得讲的不是"AI 写了代码"，而是**怎么让几个 Agent 同时干活，又不互相破坏**。

## 分工

| 谁 | 做什么 |
|---|---|
| 我 | 定目标和取舍、拍板每一条决定（共 64 条）、验收 |
| Claude | 写规格、review、跑门禁、合并；也写一部分关键代码 |
| DeepSeek（在 Claude Code 里作为后端） | 按规格写简单到中等的改动 |
| Kimi（同上） | 写重要的代码 |

最多的时候同时开着 11 个开发会话：规划、总控台、骨架、工作循环、调查引擎、协作与沉淀、对照、内容、端到端测试、界面两个、打分。各自管一块。

## 让并行不打架的五件事

1. **文件归属合同**（[`docs/CONTRACTS.md`](CONTRACTS.md)）：接口、目录约定，以及每个会话能改哪些文件。要改冻结的接口，先写变更请求（[`CONTRACT-CHANGE-*.md`](.)），再由总控台合并。
2. **一个任务一份规格**：规格写清目标、要改的文件、先写的测试、验收标准、不做的事；diff 尽量控制在 300 行以内。
3. **守卫脚本**（[`scripts/ds-code.sh`](../scripts/ds-code.sh)、[`scripts/kimi-code.sh`](../scripts/kimi-code.sh)）：
   - 编程 Agent 不能 commit、push、build、跑端到端测试，也不能读 `.env`（权限层面禁掉，不是靠提示词）；
   - 运行前给所有已有测试拍快照；运行后，凡是改了已有测试、规格里又没写 `ALLOW-TEST-EDIT: <路径>` 的，**整批退回，任务算失败**。
   - 这条是被逼出来的：DeepSeek 有几次遇到旧测试不过，选择改断言而不是改代码（见[模型行为观察 §9](model-behavior.md#coding-agent-edits-tests)）。
4. **门禁按退出码判**：typecheck、lint、单元测试、端到端测试、生产构建全过才算过；改断言只能跟着新文案改，不能放宽。
5. **每个任务记一行**（[`docs/dev-log/coding-agents-log.md`](dev-log/coding-agents-log.md)）：时间、哪个会话、什么任务、用了几轮、为什么被打回、用时、人工小修。

## 从记录里看到的

- 记录里有 60 多个任务，大部分一轮通过；被打回的主要原因是改了已有测试（代码守卫拦下 4 次，人工 review 撤回 1 次）。
- 机器负载高的时候（几个会话同时跑测试），一个任务从几分钟拖到十几分钟；门禁里的端到端测试要在机器安静的时候跑，否则会出现和改动无关的超时。
- 规格写得越具体，打回越少；有几次打回是规格漏写了"允许改哪个测试"，问题出在写规格的一方，不在写代码的 Agent。

## 如果重来

- 第一天就把守卫和门禁做好，而不是出了问题再补。
- 会话数控制在 5 个以内。11 个会话里，协调成本一度超过了并行带来的收益（[设计决策 D-52](design-decisions.md#d-52-stop-patching-define-the-finish-line)）。
