# D-56 DeepSeek 效果记录

时间 | session | 任务 | 轮数 | 打回原因 | DeepSeek 用时 | 小修
---|---|---|---|---|---|---
10/27 00:10 JST | 总控台 | 冒烟测试 clamp + 测试（deepseek-chat，作废，已改用 flash）| 1 | — | 33s | 无
10/27 00:14 JST | 总控台 | 冒烟测试 clamp（deepseek-flash，核对返回的模型字段）| 1 | — | 18s | 无
10/27 00:15 JST | M1 | ③3a voice.ts + base.ts 对话规则（deepseek-flash）| 1 | — | 66s | 无
10/27 00:31 JST | M3 | ⑦-1 三关判断模块（citation-verify.ts + 单测，84b3174） | 1 | — | 约 6 分 50 秒 | 无
10/27 00:29 JST | M1 | ③3b workplan.ts 提示词（先查再问、冲突、不说文件名、界面事实）（deepseek-flash）| 1 | — | 约 12 分钟（机器 load 25，多路同时在跑）| 无
10/27 00:41 | E2E | T1 规则单测+helper+mock 契约（7 个新文件）| 1 | — | 约 10 分钟（后台，未精确计时）| 1 处：internal-names 的编号目录后面是空白也要匹配（+1 测试）
10/27 01:10 JST | ui-ux-qcd | ⑤a T1：DeepSeek 两次改旧测试断言凑通过（workloop-chain） | 打回 ×2 | 改旧测试凑通过，review 撤回；之后加了 prompt 规则和 ds-code.sh 代码守卫 | — | — | —
10/27 00:46 JST | M3 | ⑦-2 81 对评测脚本（eval-citation-verify.ts + 单测，4c58071） | 1 | — | 约 9 分 10 秒 | 无
10/27 00:45 JST | 总控台 | 守卫自测（故意让它改旧测试，不计入 DeepSeek 打回） | 自测 | 改了已有测试 1 个：tests/tree-utils.test.ts，已退回 | — | —
10/27 00:51 JST | M1 | ③3c 评测规则判定 + 5 道题（deepseek-flash）| 1 | — | 约 10 分钟（机器 load 20+）| 无
10/27 01:12 JST | C | ② clean 演示 vault 的 demo-snapshot 目标（picks、断链改指、checkClean + 单测，0ba1a24）| 1 | — | 约 15 分钟（00:50–01:05 JST，机器 load 30 左右）| 3 处：两个函数补上只处理 .md（规格写了，它漏了）；断链改指的目标换成完整路径（[[项目]] 有了第二个项目就会撞名）；头部注释改掉"只在 Obsidian 里看"
10/27 01:10 JST | m3-decisions-19d843 | m3_03_citation-verify-in-execute.md | 打回（代码守卫） | 改了已有测试 1 个：tests/m2/research-fixture.ts，已退回 | — | —
10/27 01:12 JST | M1 | ③3d 评测 helpers（答案/检查/markdown）（deepseek-flash）| 1 | — | 约 16 分钟（load 25）| 无
10/27 01:20 JST | M1 | ③3e 评测 runner（pnpm eval:workplan）（deepseek-flash）| 1 | — | 约 5 分钟（load 回落）| 无（我删了它留下的 .scratch 调试文件）
10/27 01:20 JST | objective-ramanujan-0bcc70 | m1_3f_eval-tweaks.md | 打回（代码守卫） | 改了已有测试 2 个：tests/evals/workplan-judges.test.ts,tests/evals/workplan-lib.test.ts，已退回 | — | —
10/27 01:23 JST | M1 | ③3f 评测微调（卡片长度单独限；脚本答案只用于第一张卡）（deepseek-flash）| 2（第 1 次被测试守卫拒绝：改了已有测试但规格没写 ALLOW-TEST-EDIT；补上后第 2 次过）| 规格漏写 ALLOW-TEST-EDIT | 56s（第 2 次）| 无
10/27 01:5x JST | ui-ux-qcd | ⑤a-T1 G1 事件规则+请求/回复+工具前置条件（核心代码 3 个文件+4 个测试文件） | 3 | 为让测试通过改了旧断言 workloop-chain（撤回 2 次，守卫加上之前）；核心逻辑一次对 | 约 22 分 | 无（撤回了对旧断言的修改）
10/27 01:5x JST | ui-ux-qcd | ⑤a-T4 AI 场景判断改按 review、写入锁、手改保护（3 个源文件+3 个测试文件） | 1 | 无；workloop-chain 改了一处措辞断言和一处 fixture 作者（核对后保留，必要） | 约 11 分 | 无
10/27 01:37 JST | M1 | ④4a 对话日志存进 Workspace（lib + API + hook）（deepseek-flash）| 1 | — | 5 分 21 秒 | 无
10/27 01:4x JST | M2 | ⑤b-1 知识库/联网拆两半（纯重构：execute.ts + 1 个新测试文件）（deepseek-flash）| 1 | 无；旧测试一条没改 | 14 分 11 秒（机器 load 25）| 无
10/27 01:52 JST | M3 | ⑦-3 citation_verify 写进新报告 frontmatter（3247bf0） | 2 | 第 1 轮：我的规格漏写 ALLOW-TEST-EDIT，测试保护把 fixture 改动退回 | 约 32 分 + 约 13 分 | 提示词里脚注多套了一层方括号（[[^9]]），1 行
10/27 01:50 JST | M1 | ③3g 评测计分调整（字数按整次计、疑点词、引用决定也算）（deepseek-flash）| 1 | — | 9 分 27 秒（load 高）| 无
10/27 02:0x JST | ui-ux-qcd | ⑤a-T3 流程条+下一步条旁注（steps.ts、next-step.ts、next-step-bar.tsx、wave2-flow 测试） | 1 | 无（守卫后首次，只改了规格点名的测试） | 约 10 分 | 1 句文案（审批→征求意见）
10/27 01:58 JST | M1 | ③3h 提示词第 1 轮调整（字数、vault 一词）（deepseek-flash）| 1 | — | 5 分 5 秒 | 无
10/27 02:00 JST | M0 | M0_1 resolveLink 同项目优先（69f2645） | 1 | — | 约 3 分 10 秒 | 无
10/27 02:00 JST | M0 | M0_2 write 覆盖时只查新加的链接（f6afced） | 1 | — | 约 7 分 30 秒 | 无
10/27 02:00 JST | M0 | M0_3 新建项目 createProject + listProjects + 路由（3b3a08c） | 1 | — | 约 4 分 15 秒 | 无
10/27 02:03 JST | M3 | ⑦-4 Kimi 判断按次关思考 + 判断失败记日志（87e4b50） | 1 | — | 6 分 4 秒 | 无
10/27 02:1x JST | ui-ux-qcd | ⑤a-T2 联网守卫回归测试+不再标探索性+S3 旧报告快照 | 1 | 无 | 约 17 分 | 无
10/27 02:15 JST | C | E2E T3 e2e-vault-clean 生成脚本 + 校验 | 2 | 第一轮：测试比错了对象（方法库而非资料库）；CLI 用了顶层 await 和 import.meta，tsx 下直接运行会失败；漏了 E2E 要的两句描述 | 约 4 分 + 7 分 | 无
10/27 02:10 JST | M1 | ④4b 重做 workplan 留旧版（日志标记 + API + 按钮）（deepseek-flash）| 1 | — | 9 分 47 秒（load 20+）| 无
10/27 02:14 JST | M3 | ⑤b-1 批准调查计划推 stage 到执行中（3dfc1c7） | 1 | — | 8 分 33 秒 | 无
10/27 02:25 JST | C | clean 目标补上专家输入（picks + 检查） | 1 | — | 约 3 分钟 | 无
10/27 JST | M2 | ⑤b-2 先内部资料、清单、确认后继续（execute.ts + inventory.ts + 小改 5 个文件）（deepseek-flash）| 2 | 第 1 轮：网络那一半变成串行、预算释放位置变了、两处步骤行没收尾 | 16 分 + 12 分 | 无
10/27 02:20 JST | M3 | ⑤b-2 同项目已确认报告的加载器 confirmed-reports.ts（3c60ada） | 1 | — | 2 分 2 秒 | 无
10/27 02:16 | E2E | T5a G1 征求意见后的 stage 断言 + 第二次请求被拒用例（m1-workplan、vault.ts 注释）| 1 | — | 约 5 分钟 | 无（E2E 未实跑，交门禁）
10/27 02:19 JST | exciting-tu-afdf04 | M2_5b-3_route.md | 打回（代码守卫） | 改了已有测试 1 个：tests/m2/job.test.ts，已退回 | — | —
10/27 JST | M2 | ⑤b-3 路由：continue / internal / 清单接口（run-request.ts + 2 个新路由 + job/progress 小改）（deepseek-flash）| 2 | 第 1 轮被测试守卫退回：规格没写允许往旧的 job.test.ts 里加用例（我的规格漏了） | 5 分 + 7 分 | 无
10/27 02:25 JST | objective-ramanujan-0bcc70 | m1_5a_pack.md | 打回（代码守卫） | 改了已有测试 1 个：tests/m1/compose/state.test.ts，已退回 | — | —
10/27 02:32 | E2E | T5b 流程条/下一步条随 T3 改（m1-workplan 4 处、demo-flow 3 处）| 1 | — | 约 4 分钟 | 无（E2E 未实跑，交门禁）
10/27 02:31 JST | M1 | ③v2 ① pack（代码检索，K# 编号）pack.ts（aa73ce3，deepseek-flash）| 2 | 第 1 轮被测试守卫退回：我在 DS 运行时改了 state.test.ts（我的失误）；第 2 轮通过 | 约 10 分钟 | 无
10/27 02:33 JST | M1 | ③v2 ⑤ 评审循环 review.ts（aa73ce3，deepseek-flash）| 1 | — | 约 4 分钟 | 无（14 个用例，全过；我审了 diff，语义与规格一致）
10/27 02:33 JST | M1 | ③v2 ②③④ 定题工具、拆法投票、树 JSON、校验+渲染、补丁、组装与工具闸（8b32764）| — | Sonnet 开局接手（核心难点）：协议与状态机，不交 DeepSeek | — | 无
10/27 02:42 JST | M3 | ⑤b-3 结论关：Junior 提交已交付报告（237b363） | 1 | — | 2 分 | 旧测试 review-flow.test.ts 把 结论 当“不支持的闸门”，改用 G2，2 行
10/27 02:47 JST | M1 | ③v2 评测改造：C 的 5 道新题、新工具轨迹判分、结构化检查、每次一个 JSON、稳定性（3f9cbd8，deepseek-flash）| 1 | — | 约 4 分钟 | 无（77 个评测用例全过；我审了 diff）
10/27 02:52 JST | M1 | ③v2 ⑥ 清掉树里的内部名称 scrub.ts（deepseek-flash）| 1 | — | 约 3 分钟 | 无（9 个用例；接线、真实重写调用由我做）
10/27 03:00 JST | M1 | ③v2 评测的"按意思配对"稳定性（model 判一级和最底层子问题，f2cc6ed 之前，deepseek-flash）| 1 | — | 约 5 分钟 | 无（11 个用例；判定员 token 上限和并行由我后补）
10/27 05:35 JST | M1 | ③v2 汇总：DeepSeek 写 pack、评审循环、scrub、评测结构化/稳定性 4 块（约 1000 行含测试）；Sonnet 写 frame/axes/tree/patch/render/compose/gate/runner/提示词（核心难点）及全部联调修复 | — | 联调中发现并修了 8 个只有真跑才暴露的问题（补丁 JSON 少一个括号、确认后模型只说不做、short 名含斜杠导致写一半、树越补越大、…）| 约 5 小时 | 见 D-56_M1_③v2_拆题流程和评测_第3轮.md
10/27 05:50 JST | M1 | ③v2 mock 契约：共创脚本和 compose 的 4 个 JSON 回答（deepseek-flash）| 1 | — | 约 5 分钟 | 无（11 个用例 + 走完整条 compose 管线）
10/27 06:00 JST | M0 | M0_4 资料库中英双语检索索引（loader/search、生成脚本、218 条索引） | 1 | — | 约 2 分 45 秒（代码）；生成 218 条 288.5 秒，失败 0 | 无
10/27 08:50 | E2E | T5c 共创 workplan 新流程（m1-workplan、demo-flow 共创段 + e2e/support/workplan.ts）| 1 | — | 约 8 分钟 | 无（E2E 未实跑，交门禁）
10/27 08:5x JST | ui-ux-qcd | ⑤a-T5 界面文案（8 个组件/页面 + 新测试） | 1 | 无 | 约 3 分 | 测试文件改名 .tsx→.ts（vitest 不收 .tsx）；删临时配置
10/27 09:0x JST | ui-ux-qcd | ⑤a-T7 发给 Senior 征求意见 按钮+对话框+预填（send-draft、send-for-opinion、shell、page） | 1 | 无 | 约 3 分 | key 按版本重置对话框；测试文件改名 .tsx→.ts
10/27 09:04 | E2E | T5d 发送按钮替换 API、T5 文案断言、mock 按实际假设笔记取名（含 mock-agent.ts）| 1 | — | 约 9 分钟 | 无（E2E 未实跑，交门禁）
10/27 09:2x JST | ui-ux-qcd | A ⑦ ✓显示（citation-verify、empty-clause、report-viewer 等 6 文件+2 测试） | 1 | 无 | 约 8 分 | 无
10/27 JST | M2 | ⑤b-4 访谈建议卡（interview-card.ts + report.ts 两个渲染器 + judge prompt 一句）（deepseek-flash）| 1 | 无；旧测试一条没改 | 11 分 | 无
10/27 09:3x JST | ui-ux-qcd | B 内部资料确认页（inventory-view/panel、workbench、run-groups/view、page） | 1 | 无 | 约 4 分 | 无
10/27 09:3x JST | ui-ux-qcd | C1 报告提交给 Senior 确认（report-review、box、review-panel 措辞、page 接线） | 1 | 无 | 约 4 分 | 无
10/27 09:3x JST | ui-ux-qcd | C2 文件页签（files-view、files page、library-list、nav） | 1 | 无 | 约 4 分 | 无
10/27 10:0x JST | ui-ux-qcd | E 提交报告后的步骤和句子、即时状态（steps/next-step/load/box/panel+测试） | 1 | 无 | 约 7 分 | 无
10/27 09:00 JST | M1 | D-60 角色路由接线：对话/拆题/决定起草走 judgment、超时放宽（kimi-code.sh）| 1 | — | 约 15 分钟 | 无（6 个用例）
10/27 JST | M2 | D-60 按角色路由模型（model-role.ts + run-models.ts + 6 个文件小改）（kimi-k3.1-pro-highspeed）| 1 | 无；旧测试一条没改 | 67 分钟 | 无
10/27 13:22 | E2E | T6 内部资料清单步骤（7 个 spec + e2e/support/inventory.ts）| 1 | — | 约 8 分钟 | 1 处：confirmInventory 先勾全部「上网查」再点（按钮无勾选时灰）
10/27 13:0x JST | ui-ux-qcd | F 继续后两段合成一次运行（run-tab、workbench、run-groups、metadata 类型+测试）[Kimi] | 1 | 无 | 约 13 分 | 无
10/27 | M1 | D-61 第 0–3、6 步（judgment.ts / budget.ts / compose 管线替换）：云端 Sonnet 直写，未用 ds-code / kimi-code | — | — | 约 2 小时 | —
