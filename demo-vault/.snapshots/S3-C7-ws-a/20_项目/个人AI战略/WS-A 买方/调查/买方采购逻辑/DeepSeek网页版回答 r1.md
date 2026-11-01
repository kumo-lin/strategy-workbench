---
id: web-baseline-deepseek-r1
type: report
status: 推断
created: "2026-10-25"
updated: "2026-10-25"
author: AI
derived_from:
  - "[[20_项目/个人AI战略/WS-A 买方/workspace|workspace]]"
relates_to:
  - "[[20_项目/个人AI战略/WS-A 买方/workspace|workspace]]"
version: 1
research_plan: null
mode: web_baseline
exploratory: false
web_baseline_run:
  tool: DeepSeek 网页版（chat.deepseek.com）
  settings: 深度思考 + 智能搜索
  run: 1
  conversation: 新对话
  run_at: "2026-10-25"
  question: 企业员工用的个人 AI（AI PC 上、IT 能管理的个人 agent）未来 2–3 年会怎么演变？对联想明年的战略意味着什么？（课题英文原文：Evolvement and future outlook of the Personal AI market and implications to Lenovo strategy going forward）
  searched_pages: 84
  inline_citations: 13
  cited_urls: 7
---

# DeepSeek 网页版回答 r1

"现状"参照：团队成员今天直接用 DeepSeek 网页版回答这道题时会拿到什么。它不是严格的对照：模型版本未必和我们用的相同，每次跑的结果也不一样。严格的、量化的比较看通用 deep research（对照组）报告。

- 设置：深度思考、智能搜索都打开；新对话。
- 题目（原样发送）：企业员工用的个人 AI（AI PC 上、IT 能管理的个人 agent）未来 2–3 年会怎么演变？对联想明年的战略意味着什么？（课题英文原文：Evolvement and future outlook of the Personal AI market and implications to Lenovo strategy going forward）
- 网页版显示搜过 84 个网页；回答正文里有 13 处引用，指向 7 个网址。
- 下面"回答原文"一节是网页版的输出，文字一字未改；只把标题降了一级，好放进这一节。正文里的 [n](网址) 就是网页上的引用角标和它链接的网址。
- "搜索来源"一节里，第 11、51、57 条的网址太长，去掉了末尾的查询参数或编码过的标题；回答正文里的引用网址都是原样。

## 引用核对

逐条打开回答正文里的 13 处引用，看链接打不打得开；打得开的，看原文支不支持引用所在的那句话（引用放在段尾时，看这一段里应当出自它的那句）。口径和通用 deep research（对照组）那组数字相同：一处引用算一次，同一个网址被引多次就分别算。

| 结果 | 处数 |
|---|---|
| 打不开 | 5 |
| 对得上 | 6 |
| 对不上 | 2 |

| # | 引用 | 所在的句子（摘要） | 结果 | 依据 |
|---|---|---|---|---|
| 1 | [1] 新华财经 2026-10-23 | 杨元庆：未来 80% 词元在终端和边缘生成；端—边—云分布推理 | 对得上 | 原文："杨元庆预测，未来80%的词元将在终端和边缘侧生成。"并有"发挥'端—边—云'全栈技术与产品组合优势" |
| 2 | [28] 证券时报 3647883 | 同上一句 | 打不开 | 本机打开超时（浏览器和命令行都一样）。从同一篇稿件的中国日报网转载看，它是 2026-02 的业绩沟通会报道，里面没有 80% 词元这句 |
| 3 | [3] Nasdaq（HP） | 推理负载分布到设备、本地和云；员工模型访问支出从 2000 万美元升到 2–3 亿美元；笔记本本地跑 200 亿参数模型 | 打不开 | 浏览器打开显示 Access Denied |
| 4 | [40] ServiceNow 新闻稿 2026-10-15 | 紧挨引用的那句："Microsoft Agent 365、Okta 的 Cross-App Access 以及 Cloud Security Alliance 的 AIGF 框架，都在把非人类 AI 身份纳入……" | 对不上 | 新闻稿里讲的是 AI Passport，前面几句对得上；但 Microsoft、Okta、Cloud Security Alliance、AIGF 在原文里一次都没出现 |
| 5 | [10] 至顶网 2025-12-29（Futurum） | Win10 换机红利 2025 年见顶，2026 年企业 AI PC 放缓，2027 年回到正常周期；要看到生产力、安全、TCO、ROI 改善才大规模推进 | 对得上 | 原文转述 Futurum 报告，这几点都有 |
| 6 | [13] 富途（高盛） | AI PC 出货占比 2025 年 36%、2026 年 59%、2027 年 72%、2028 年 82% | 对得上 | 原文："AI PC在全球PC出货量中的占比将由2025年的36%快速升至2026年的59%、2027年的72%和2028年的82%。" |
| 7 | [28] 证券时报 3647883 | 联想全球 AI PC 份额第一（25.1%），天禧 AI 端侧个人超级智能体先发 | 打不开 | 同 #2。转载稿里只有中国市场份额（39.1%、47.1%），没有全球 25.1% |
| 8 | [1] 新华财经 2026-10-23 | "一体多端"把天禧 AI 作为"一体"；天禧 AI 在 AI PC 上周活率 42%，AI PC 销量同比增长超过 100% | 对不上 | 这篇原文里没有"天禧"、没有 42%、没有销量翻倍；原文写的是"通过个人超级智能体Qira整合跨设备AI体验" |
| 9 | [28] 证券时报 3647883 | 同上一句 | 打不开 | 同 #2。转载稿里有"平均用户周活率分别达到42%和61%"和"AI PC第三财季销量同比大增超过100%" |
| 10 | [3] Nasdaq（HP） | token 成本：员工模型访问支出从 2000 万美元级升到 2–3 亿美元级 | 打不开 | 同 #3 |
| 11 | [1] 新华财经 2026-10-23 | 联想内部每月消耗一万亿词元；Token Hub 在统一算力平台上分配工作负载 | 对得上 | 原文："目前联想内部每月消耗的词元已达一万亿个"；"发展Token Hub，在统一算力平台上将不同工作负载分配给不同模型" |
| 12 | [20] Lenovo StoryHub 2026-09-03 | ThinkCentre X Ultra 最多四台集群互联，运行更大模型 | 对得上 | 原文："connects up to four systems in a unified platform, expanding available compute and memory resources to run larger AI models" |
| 13 | [40] ServiceNow 新闻稿 2026-10-15 | AI Passport 把授权变成运行时强制：越界时限制、重定向或终止，留有完整记录 | 对得上 | 原文："graduated responses can be enforced — redirecting, restricting, or reconnecting"；"kill switch capabilities at machine speed"；"keeps the full audit record" |

另外，回答里有不少带数字的说法根本没有引用，比如"Gartner 预测到 2026 年底 40% 的企业应用将包含 AI Agent"，以及天禧生态 3200 多个应用、ISV/SI 数量同比增长 96%、超过 1000 个行业场景方案。这些读者没法核对。

## 回答原文

企业员工使用的个人 AI，未来 2–3 年的核心变化不在于“PC 里多了一个聊天框”，而在于 **PC 从员工操作的终端，变成员工与一组本地持续运行的 Agent 共同工作的“代理计算机”**。对联想而言，这意味着明年的战略重心需要从“卖 AI PC 硬件”进一步前移到 **“卖可被 IT 治理的企业级个人 Agent 运行时”** ，同时用混合 AI 架构把成本、安全和治理串成一套企业叙事。

---

### 一、未来 2–3 年企业个人 AI 的四个结构性演变

#### 1. 从“AI 助手”走向“代理计算机”：员工角色从操作者变为监督者

AMD 对企业 AI PC 的定性最直接：AI PC 将演变为 **Agentic Computers**——不只是帮用户完成任务，而是**在本地持续运行 AI Agent 的系统**。员工的工作方式将从“手动完成每一项任务”，转向“委托、监督、验证 Agent 完成的工作”，自己的时间向批判性思考、创造性和高价值决策集中。

这一转变的关键含义是：**Agent 是持续运行的，而不是按需唤醒的**。这意味着算力消耗不再与“桌前有多少人”线性相关，而是与“有多少 Agent 在并行工作”相关。AMD 明确提出，企业需要像规划人头一样规划 **AI 容量**，因为一名员工可以同时触发多个 Agent 和子 Agent 跨工作流运行。

#### 2. 推理负载向端侧迁移，但不会完全替代云：混合架构成为默认形态

杨元庆给出的判断是：**未来 80% 的词元将在终端和边缘生成**。逻辑不是“云不重要了”，而是随着 Agent 持续运行、词元消耗量级跳升，全部放在云端推理的经济性会迅速恶化。联想的应对是把大模型推理在“端—边—云”三层算力上做合理分布，在用户体验和成本之间找平衡。[1](https://m.cnfin.com/gs-lb//zixun/20261023/4485652_1.html)[28](https://stcn.com/article/detail/3647883.html)

HP 从企业采购侧印证了同一方向：云基础设施继续承担大规模训练和深度推理，而**推理负载向设备、本地基础设施和云端分布式部署**；一些企业员工模型访问支出已从一年 2000 万美元量级跳到 2–3 亿美元量级，架构选择正在变成 CFO 级别的问题。当前笔记本已可本地承载 200 亿参数开源模型，本地系统可承载万亿参数级模型。[3](https://www.nasdaq.com/articles/hp-sees-ai-pcs-enterprise-cost-security-and-growth-catalyst#1)

#### 3. 治理从“事后审计”前移到“运行时控制”，Agent 需要自己的“工号”

企业 IT 面对的不再是员工手动点击的软件，而是**能自主调用工具、访问数据、跨工作流行动的 semi-autonomous 实体**。Gartner 预测到 2026 年底，40% 的企业应用将包含面向特定任务的 AI Agent，而 2025 年这一比例不到 5%。Agent 数量激增的直接后果是：传统 IAM 和审计框架不够用了。

2026 年正在成型的方向是**给 Agent 发放可验证的运行时凭证**。ServiceNow 的 AI Passport 是一个代表性方案：每个 Agent 持有加密签名的凭证，明确它在多 Agent 工作流中**可以访问什么数据、可以执行什么动作、谁授权了它**；Agent 在范围内可自由运行，越界则触发重定向、限制甚至机器速度的终止开关，并留下完整审计记录。Microsoft Agent 365、Okta 的 Cross-App Access 以及 Cloud Security Alliance 的 AIGF 框架，都在把非人类 AI 身份纳入企业生命周期管理、权限审查和审计证据链。[40](https://investor.servicenow.com/news/news-details/2026/ServiceNow-advances-its-operational-harness-for-enterprise-AI-with-AI-Passport-and-expanded-governance-capabilities/default.aspx)

**“IT 能管理”不再是附加功能，而是企业采购个人 Agent 的准入门槛。**

#### 4. 渗透率快速抬升，但企业换机节奏会出现“先放缓、再正常化”的错位

AI PC 的渗透曲线本身很强：高盛预计 AI PC 出货占比从 2025 年的 36% 升至 2026 年的 59%、2027 年的 72%、2028 年的 82%。但**企业侧的采用节奏未必同步**。Futurum 的判断是，Windows 10 退场带来的强制换机红利在 2025 年达到高点，2026 年企业 AI PC 普及速度会放缓，2027 年才回到正常更新周期；企业只有在生产力、安全性、TCO 和 ROI 上看到可衡量改善后，才会大规模推进。[10](https://m.zhiding.cn/article/3175883.htm#1)[13](https://news.futunn.com/post/76137553/overseas-research-selection-goldman-sachs-cuts-global-pc-shipment-forecast?level=1&data_ticket=1784239106910180&global_content=%7B%22promote_content%22%3A%22nn%3Apost%3A76137553%22%7D#1)

这意味着未来 2–3 年企业市场会呈现一种张力：**AI PC 的出货占比在升，但企业为“Agent 能力”付费的意愿，取决于软件和治理层能不能把硬件算力转化为可验证的业务结果。**

---

### 二、对联想明年战略的含义

联想已经具备两个基础：**全球 AI PC 市场份额第一（25.1%），以及天禧 AI 作为端侧个人超级智能体的先发位置**。但要把这两点转化为企业个人 Agent 市场的结构性优势，明年的战略需要在以下四个方向上做出明确取舍。[28](https://stcn.com/article/detail/3647883.html)

#### 1. 终端入口要守住，但价值重心需要向“Agent 运行时”迁移

联想“一体多端”战略把天禧 AI 作为跨设备的“一体”，从 AI PC 延伸到 AI 手机、AI 平板和 AIoT。这在消费侧已经看到效果：天禧 AI 在联想 AI PC 上的周活率达到 42%，AI PC 销量同比大增超过 100%。[1](https://m.cnfin.com/gs-lb//zixun/20261023/4485652_1.html)[28](https://stcn.com/article/detail/3647883.html)

但企业市场的逻辑不同。企业买的不是“员工个人觉得好用的 Agent”，而是**IT 可以批量部署、配置、监控和回收的企业资产**。联想已经发布了**天禧 AI Pro**，面向政企客户，定位是“离线可用、全程可管”，并宣布全面搭载在企业级 AI 终端和边缘产品上。明年的关键不是再发一个版本，而是回答：**天禧 AI Pro 与 ServiceNow / Microsoft Agent 365 / Okta 等企业治理基础设施之间的集成深度到底有多深？** 如果 Agent 的身份、权限、审计仍然停留在联想自己的封闭体系内，企业 IT 的采纳速度会受限；如果能做到 Agent 凭证可被企业现有 IAM 和 SIEM 体系验证，天禧 AI Pro 才真正具备“企业级个人 Agent”的资格。

#### 2. 用“混合 AI + Token 经济学”建立 CFO 能听懂的价值主张

HP 已经明确把 token 成本上升作为架构决策 CFO 化的证据：一家企业员工模型访问支出从 2000 万美元级升到 2–3 亿美元级。这对联想是一个**叙事机会**：如果天禧 AI Pro 能把更多高频、低复杂度的 Agent 推理放在本地 NPU / GPU 上，只在需要深度推理时调用云端，那么企业可以在不牺牲体验的前提下压住人均 token 成本。[3](https://www.nasdaq.com/articles/hp-sees-ai-pcs-enterprise-cost-security-and-growth-catalyst#1)

联想已经在基础设施侧有了配套动作：ThinkCentre X Ultra 支持**最多四台系统集群互联**，扩展算力和内存以运行更大模型、更长上下文窗口和多 Agent 工作流；杨元庆透露联想内部每月消耗词元已达一万亿个，并推出 Token Hub 在统一算力平台上分配不同工作负载。明年的战略表达需要从“本地算力强”升级为 **“单位 Agent 工作流的综合 token 成本更低”** ，并且用可对比的 TCO 数据来支撑企业采购决策。[1](https://m.cnfin.com/gs-lb//zixun/20261023/4485652_1.html)[20](https://news.lenovo.com/pressroom/press-releases/hybrid-ai-for-business-devices-displays-solutions/)

#### 3. 生态重心从“应用数量”转向“可治理的行业 Agent 场景”

天禧生态国内 AI 应用已达到 3200 多个，但企业市场需要的不是通用应用的数量，而是**在具体业务流程中可授权、可审计、可复制的 Agent 技能**。联想政企合作伙伴中 ISV / SI 数量同比增长 96%，并提出共建超过 1000 个可复制的行业场景方案。这个方向是对的，但需要进一步聚焦：在制造、零售、金融等联想已有客户基础的行业里，优先做出**天禧 AI Pro + 行业 ISV Agent + 企业治理平台**的三方集成样板，让企业 IT 看到“买联想的终端，等于同时获得一个已经被行业场景验证过、且能被现有治理体系接住的 Agent 运行环境”。

#### 4. 最大的战略风险不在硬件，而在“可管理性”的信任赤字

企业 IT 对个人 Agent 的核心顾虑不是算力不够，而是**Agent 在员工桌面上“看不见、管不住、说不清”**。ServiceNow 的 AI Passport 之所以在 2026 年成为企业 AI 治理的标杆方向，正是因为它把授权从“事后日志”变成了**运行时强制**：Agent 越界时可以被限制、重定向或终止，且有完整的授权链记录。[40](https://investor.servicenow.com/news/news-details/2026/ServiceNow-advances-its-operational-harness-for-enterprise-AI-with-AI-Passport-and-expanded-governance-capabilities/default.aspx)

联想如果要在明年把天禧 AI Pro 卖进企业，需要正面回答三个问题：**Agent 的身份由谁签发、权限由谁审批、行为日志进入哪个 SIEM / 审计系统。** 如果这三个问题的答案主要指向联想自有平台，而不是与企业现有安全栈互操作，那么联想在“IT 能管理”这一企业采购的硬门槛上会处于防守位置。补齐治理集成能力——无论是通过与 ServiceNow、Microsoft、Okta 等平台的官方集成，还是通过支持开放的 Agent 身份凭证标准——其战略优先级应当不低于天禧 AI 本身的功能迭代。

---

**一句话总结**：未来 2–3 年企业个人 AI 的竞争，会从“谁的 PC 能跑更大模型”转向 **“谁的 Agent 运行时能被企业 IT 安全地放行、被 CFO 算得过账、被员工持续使用”** 。联想明年最值得做的，是把天禧 AI Pro 从一个“政企版个人智能体”升级为**混合 AI 架构下可被企业治理栈验证和接管的 Agent 运行环境**，并用 Token 经济学把端侧算力优势翻译成企业采购语言。终端份额第一是入场券，治理集成深度和单位 Agent 成本才是决定联想能否把 AI PC 的出货优势转化为企业个人 Agent 市场利润池的关键变量。

## 网页版列出的搜索来源（84 个）

编号是网页版里的编号，回答正文里的角标就指向这些编号。

1. 中国金融信息网 · 2026/10/23 · 联想集团杨元庆：未来80%词元将在终端和边缘生成，AI设备将迎新变革 <https://m.cnfin.com/gs-lb//zixun/20261023/4485652_1.html>
2. Windows Report · 2026/06/01 · NVIDIA Reveals Long-Term RTX Spark Roadmap for Windows AI PCs <https://windowsreport.com/nvidia-reveals-long-term-rtx-spark-roadmap-for-windows-ai-pcs/#1#1>
3. Nasdaq · 2026/08/26 · HP Sees AI PCs as Enterprise Cost, Security and Growth Catalyst <https://www.nasdaq.com/articles/hp-sees-ai-pcs-enterprise-cost-security-and-growth-catalyst#1>
4. 上海证券报 · 2026/09/04 · 联想柏林发布AI终端新战略：大模型从云端走向笔记本 个人AI开始“跟着人走” <https://www.cnstock.com/commonDetail/785786#1>
5. chinaaet.cn · 2026/10/23 · 联想判断未来80%Token将在终端和边缘生成-AET-电子技术应用 <http://chinaaet.cn/article/3000181273>
6. Smart自學網 · 2026/10/22 · 全球近4成組織使用AI代理！企業願掏錢，生成式AI可能在3年內普及？ <https://smart.businessweekly.com.tw/Reading/IndepArticle.aspx?id=6024737>
7. 36氪 · 2026/10/22 · 刚刚，黄仁勋柏林震撼演讲，PC已死，AI智能体时代全面爆发 <https://36kr.com/p/4036220967752838#1>
8. 智东西 · 2026/09/08 · 扛起联想六成收入的人，怎么看AI PC的下一站？ <https://zhidx.com/p/592131.html#1>
9. 钛媒体 · 2026/10/22 · 黄仁勋押注新一轮“PC革命”，Agent找到了“最佳宿主”吗？ <https://www.tmtpost.com/8177566.html?rss=10jqka#1>
10. Zhiding · 2025/12/29 · 企业AI PC普及将在2026年放缓 <https://m.zhiding.cn/article/3175883.htm#1>
11. The Futurum Group · 2025/12/09 · Executive Summary: Don’t Expect an Acceleration in the Rate of AI PC Adoption in 2026 <https://futurumgroup.com/press-release/dont-expect-an-acceleration-in-the-rate-of-ai-pc-adoption-in-2026/>
12. 工商時報 · 2026/06/17 · 輝達加把火…AI筆電5成滲透率 明年達陣 <https://readers.ctee.com.tw/cm/20260617/a03aa3/1401821/share>
13. 富途牛牛 · 2026/07/16 · 海外研选 | 高盛再砍全球PC出货预期：2026年或降14%，AI PC渗透提速 <https://news.futunn.com/post/76137553/overseas-research-selection-goldman-sachs-cuts-global-pc-shipment-forecast?level=1&data_ticket=1784239106910180&global_content=%7B%22promote_content%22%3A%22nn%3Apost%3A76137553%22%7D#1>
14. 富聯網 · 2026/06/17 · 《熱門族群》輝達加把火…AI筆電5成滲透率 明年達陣 <https://ww2.money-link.com.tw/realtimenews/NewsContent.aspx?SN=6210102001&PU=1002>
15. TVBS新聞網 · 2026/06/08 · 聯想看好AI PC崛起 2027年有望拿下六成出貨 <https://news.tvbs.com.tw/tech/3225029>
16. CRN Polska · 2025/12/16 · Adopcja AI PC w przedsiębiorstwach wyhamuje w 2026 roku <https://crn.pl/aktualnosci/adopcja-ai-pc-w-przedsiebiorstwach-wyhamuje-w-2026-roku/#ViewPollResults#1>
17. 富途牛牛 · 2026/07/16 · 海外研選 | 高盛再砍全球PC出貨預期：2026年或降14%，AI PC滲透提速 <https://news.futunn.com/hk/post/76137553/overseas-research-selection-goldman-sachs-cuts-global-pc-shipment-forecast?level=1&data_ticket=1784205050898218#1>
18. 鉅亨號 · 2026/09/12 · 個人電腦，靠AI續命？ <https://hao.cnyes.com/post/267421?utm_source=cnyes&utm_medium=home&utm_campaign=postid#1>
19. 联想官网 · 2026/04/13 · 新财年，联想中国五大业务群这样干 <https://mbrand.lenovo.com.cn/brand/ppn03732.html>
20. Lenovo StoryHub · 2026/09/03 · Lenovo Advances Hybrid AI for Business with New Think-Family Devices, Displays, and Security Solutions <https://news.lenovo.com/pressroom/press-releases/hybrid-ai-for-business-devices-displays-solutions/>
21. jingjiribao.cn · 2026/08/15 · 联想刘军：AI终端围绕技术纵深和生态广度加紧布局 <http://rss.jingjiribao.cn/static/detail.jsp?id=676470>
22. 新华网 · 2026/04/02 · 联想集团召开2026/27财年誓师大会 推进混合式AI转型 <https://www.news.cn/tech/20260402/d021b5d59e3f492683f6801e431a042c/c.html>
23. Jingjiribao · 2026/05/20 · 联想启动“苍穹计划” 将投入1万亿Token算力 <http://www.jingjiribao.cn/static/detail.jsp?id=657677>
24. Cnfin · 2026/01/17 · 如何构建下一代AI生态？联想：个人AI与企业AI双轮驱动 <https://m.cnfin.com/wx/share?url=//m.cnfin.com/gs-lb//zixun/20260116/4366961_1.html>
25. 央广网 · 2026/04/01 · 联想集团杨元庆：联想要成为一家AI原生公司 <http://tech.cnr.cn/techph/20260401/t20260401_527569840.shtml>
26. 证券时报 · 2026/04/01 · 杨元庆：联想要成为“AI原生公司”，两年后营收目标千亿美元 <https://stcn.com/article/detail/3720758.html>
27. 上海证券报 · 2026/05/25 · 联想中国将全面发力智能经济 <https://www.cnstock.com/commonDetail/719682>
28. 证券时报 · 2026/02/24 · “天禧AI”首次亮相联想业绩沟通会并提问 联想刘军透露“三大轴线”进化路线 <https://stcn.com/article/detail/3647883.html>
29. China Daily · 2026/02/25 · 联想刘军：从队友到AI Twin，天禧AI将沿“三大轴线”进化 <http://ex.chinadaily.com.cn/exchange/partners/114/rss/channel/cn/columns/07pz5d/stories/WS699ea31fa310942cc49a0779.html>
30. 上海证券报 · 2026/03/02 · 联想集团刘军：天禧AI将沿“三大轴线”进化 <https://www.cnstock.com/commonDetail/643488>
31. 投资界 · 2026/10/12 · 电脑卖不动，但联想们更赚钱了 <https://news.pedaily.cn/202610/570086.shtml#1>
32. 投资界 · 2026/10/12 · 电脑卖不动，但联想们更赚钱了 <https://m.pedaily.cn/news/570086#1>
33. 澎湃新闻 · 2026/10/12 · 电脑卖不动，但联想们更赚钱了 <https://www.thepaper.cn/newsDetail_forward_34234309#1>
34. 富途牛牛 · 2026/10/12 · 电脑卖不动，但联想们更赚钱了 <https://news.futunn.com/post/1000852633?level=1&data_ticket=1791775420574187#1>
35. CBNData-第一财经商业数据中心 · 2026/02/27 · CBNData-第一财经商业数据中心 <https://cbndata.com/information/295863#1>
36. CNMO · 2026/07/02 · 戴尔一季度重夺美国PC市场榜首 惠普出货量暴跌21.6% <https://notebook.cnmo.com/news/812491.html>
37. 凤凰网科技 · 2026/07/24 · 苹果在2026年第二季度逆势突破了全球PC销售下滑的局面 <https://tech.ifeng.com/c/8v0rHoGsP2j?ch=ttsearch>
38. Anue鉅亨 · 2026/07/23 · 全球PC Q2出貨因記憶體成本上漲年減4% 華碩受惠AI PC逆勢走揚4% <https://gfemobile.cnyes.com/news/id/6544030>
39. FIDO Alliance · 2026/10/05 · Thales Brings Agent Access Controls to Google Cloud Gemini Enterprise <https://fidoalliance.org/id-tech-thales-brings-agent-access-controls-to-google-cloud-gemini-enterprise/?query-cdbd12d0-page=4>
40. servicenow.com · 2026/10/15 · ServiceNow advances its operational harness for enterprise AI with AI Passport and expanded governance capabilities <https://investor.servicenow.com/news/news-details/2026/ServiceNow-advances-its-operational-harness-for-enterprise-AI-with-AI-Passport-and-expanded-governance-capabilities/default.aspx>
41. servicenow.com · 2026/10/21 · ServiceNow delivers industry-first personal enterprise agent and policy enforcement with NVIDIA, extending AI governance across software and silicon <https://investor.servicenow.com/news/news-details/2026/ServiceNow-delivers-industry-first-personal-enterprise-agent-and-policy-enforcement-with-NVIDIA-extending-AI-governance-across-software-and-silicon/default.aspx>
42. ITmedia · 2026/10/13 · AIエージェントで「約7人に1人が法令違反リスク」 古いルールを参照させた代償とは <https://atmarkit.itmedia.co.jp/ait/articles/2610/13/news029_2.html>
43. 株式会社ラック · 2026/10/07 · ラック、AIエージェントの安全な業務活用を支援する「Microsoft Agent 365向け導入・統制支援サービス」を提供開始 <https://www.lac.co.jp/news/2026/10/07_press_01.html>
44. 云安全联盟大中华区 · 2026/10/16 · 合规应用背后的失控 AI：如何治理 SaaS 技术栈中的智能体 <https://c-csa.cn/news-detail/i-1351.html>
45. 電波新聞デジタル · 2026/10/11 · NTTドコモビジネスと日本IBM、AIエージェント時代のガバナンス確立へ協業 <https://dempa-digital.com/article/727500>
46. TechOrange 科技報橘 · 2026/10/14 · 【沒人負責就不准上線】專家建議員工自建 AI 工具「先指定負責人」，並在執行階段持續監控 <https://techorange.com/2026/10/14/govern-ai-and-low-code-tools/#1>
47. クラウド Watch · 2026/10/13 · NTTドコモビジネスと日本IBM、企業が安心してAIを活用するためのAIガバナンス領域で協業 <https://cloud.watch.impress.co.jp/docs/news/2147240.html>
48. CodeZine · 2026/10/07 · NTTドコモビジネスと日本IBM、AIエージェントの管理・監査に向けAIガバナンス領域で協業 <https://codezine.jp/news/detail/29935>
49. 证券之星 · 2026/08/17 · 【券商聚焦】东方财富证券维持联想集团增持评级 指AI相关收入增60% <https://4g.stockstar.com/detail/IG2026081700011123>
50. Lenovo · 2026/10/16 · 联想集团FY25/26财年Q3财报发布：强势兑现承诺！联想集团Q3收获创纪录业绩 <http://bp.lenovo.com/information/details/0f73370756d74d93ba8300dae5b2d6a8>
51. 富途牛牛 · 2026/05/27 · 联想集团(00992.HK)FY2026Q4业绩点评：AI收入加速兑现 ISG盈利能力改善 <https://news.futunn.com/post/73693254/lenovo-group-00992-hk-fy2026-q4-earnings-commentary-ai-revenue>
52. 香港商报 · 2026/08/13 · 聯想集團單季度溢利首破10億美元 <https://hkcd.com/newsTopic_content.php?id=8769480>
53. Financial Times · 2026/08/13 · Lenovo Group: Q1 Financial Results 2026/27 <https://markets.ft.markitdigital.com/data/announce/full?dockey=600-202608130016BIZWIRE_USPRX____20260812_BW816414-1#1#1>
54. 证券时报 · 2026/05/22 · 联想交出史上最好财报，未来两年目标跃升千亿美元规模企业 <https://stcn.com/article/detail/3921911.html#1#1>
55. 东方财富 · 2026/08/13 · 二零二六/ 二七年财政年度第一季业绩公布 _ 联想集团(00992) _ 公告正文 <https://data.eastmoney.com/notices/detail/00992/AN202608131827932600.html#1>
56. Oeeee · 2026/08/13 · 新财季迎“开门红”，联想集团营收、利润双双破纪录 <https://m.mp.oeeee.com/oe/BAAFRD0000202608131643065.html>
57. 香港經濟日報HKET · 2026/05/27 · 聯想變身AI股 楊元慶：不只AI還是「原生」的 <https://knowledge.hket.com/article/4133070/>
58. 香港文匯網 · 2026/08/13 · AI收入帶動聯想首財季經調整純利勁升176% <https://www.wenweipo.com/a/202608/13/AP6a7d66c7e4b0c1e50024b077.html>
59. Learn Microsoft · 2026/06/08 · 企業對 AI 代理身份的準備 <https://learn.microsoft.com/zh-tw/startups/build/identity-management/enterprise-readiness-ai-agent-identity#1#1>
60. zenodo.org · Constitutional Self-Governance for Autonomous AI Agents: A Framework Observed in 85 Days of Production <https://www.zenodo.org/records/22385887/files/CSG_PREPRINT.pdf?download=1#1#3#1>
61. zenodo.org · The paper takes a specific position on tool selection: it is not the differentiator <https://www.zenodo.org/records/21529572/files/GhostInTheStack_CISOHandbook.pdf?download=1#2#11#2>
62. Lab Space · 2026/04/02 · Agent Identity Governance Framework <https://labs.cloudsecurityalliance.org/agentic/agentic-identity-governance-framework-v1/>
63. ThinkingAI · 2026/07/22 · 企业级 AI Agent 安全与治理指南（2026）：权限、审计与可信决策 <https://www.thinkingai.cn/hub/adoption/enterprise-agent-security-governance/>
64. 資安人科技網 · 2026/01/28 · Okta 發布 Secure AI 架構與 Cross-App Access 協定 鎖定企業 AI Agents 身份治理需求 <https://www.informationsecurity.com.tw/article/article_detail.aspx?aid=12669>
65. Aembit · 2026/09/16 · Enterprise at Scale: MCP’s Emerging Identity and Governance Foundation <https://aembit.io/blog/enterprise-at-scale-mcps-emerging-identity-and-governance-foundation/>
66. Tray.ai · 2026/10/22 · How to govern AI agents in production (checklist) <https://tray.ai/blog/how-to-govern-ai-agents-in-production/>
67. Cloud Security Alliance · 2026/04/08 · AI Identity Security Compliance Checklist <https://cloudsecurityalliance.org/blog/2026/04/08/ai-identity-security-compliance-checklist?ref=ghost.drevon.dev>
68. SecurityBrief Australia · 2026/09/30 · DigiCert adds identity controls for NVIDIA AI agents <https://securitybrief.com.au/story/digicert-adds-identity-controls-for-nvidia-ai-agents>
69. 手机网易网 · 2026/01/09 · CES 2026|联想阿木透露：天禧AI不止有“个人版”未来也有“专业版” <https://m.163.com/dy/article/KIR9LFJH0514R9OJ.html?spss=adap_pc>
70. 泡泡网 · 2026/04/17 · 联想举办政企伙伴大会 重磅发布企业超级智能体天禧AI Pro <https://m.pcpop.com/article_6924649.html>
71. 新浪财经 · 2026/04/17 · 联想发布超级智能体天禧AI Pro，离线可用全程可管 <https://finance.sina.com.cn/tech/2026-04-17/doc-inhuuyia6508459.shtml#1>
72. Jiemian.com · 2026/04/10 · 联想王忠：围绕四大场景打造专业Skills,加速AI生产力落地 <https://www.jiemian.com/article/14234708.html#1>
73. 猎云网 · 2026/04/09 · 联想政企业务宣布面向AI升级产品方案“矩阵” <https://lieyunpro.com/news/120238>
74. 新浪财经 · 2026/01/09 · 联想集团副总裁阿木：正研发面向企业的“个人超级智能体” <https://finance.sina.cn/tech/2026-01-09/detail-inhfswxt0511271.d.html?vt=4&wm=3200_0001&cid=79649&node_id=79649>
75. IT168 · 2026/04/20 · 联想发布新一代超级智能体天禧AI Pro：专为政企定制，离线可用全程可管 <https://software.it168.com/a2026/0420/6924/000006924824.shtml#articlecomment>
76. 中关村在线 · 2026/04/17 · 联想发布天禧AI Pro超级智能体，赋能政企AI终端与边缘计算 <https://ai.zol.com.cn/1166/11664849.html>
77. lenovo.com.cn · 2026/10/16 · 2026 联想政企合作伙伴大会圆满落幕，新财年冲刺850 亿目标！ <http://tongxiang.lenovo.com.cn/information/details/3b7786d4d0b64bc89a9eed57d7118df6>
78. 证券时报 · 2026/04/17 · 剑指850亿元营收 联想将与政企合作伙伴构建“AI+利益共同体” <https://stcn.com/article/detail/3759167.html>
79. 新浪财经 · 2026/04/17 · 联想正式发布天禧AI Pro和词元（Token）工厂等产品方案 <https://finance.sina.com.cn/roll/2026-04-17/doc-inhuuyih1059003.shtml?cref=cj#1>
80. Lenovo · 2026/09/18 · Lenovo Hybrid AI Advantage 與 AI 合作夥伴生態系統 <https://www.lenovo.com/tw/zh/servers-storage/alliance/ai-innovators/#1>
81. 爱范儿 · 2026/04/17 · 2026联想政企合作伙伴大会：营收目标剑指850亿，为合作伙伴投入10亿 <https://www.ifanr.com/digest/1662673>
82. Lenovo · 2026/09/07 · Lenovo AI Innovators Program & Partner Ecosystem <https://www.lenovo.com/se/sv/servers-storage/alliance/ai-innovators/?cid=us%3Aaffiliate%3Acxsaam#1>
83. 环球网 · 联想正式发布天禧AI Pro和词元（Token）工厂等产品方案 <https://tech.huanqiu.com/article/4RCRr3zNjjY>
84. 中国共产党西藏自治区委员会 · 2026/04/19 · 从“+AI”到“AI+”，政企智能化驶入碳硅融合新赛道 <https://wxb.xzdw.gov.cn/xxh/xxhgzdt/202604/t20260419_664943.html#1>
