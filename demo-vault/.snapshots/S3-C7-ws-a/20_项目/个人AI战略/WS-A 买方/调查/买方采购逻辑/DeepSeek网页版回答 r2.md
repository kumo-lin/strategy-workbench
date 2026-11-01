---
id: web-baseline-deepseek-r2
type: report
status: 推断
created: "2026-10-25"
updated: "2026-10-25"
author: AI
derived_from:
  - "[[20_项目/个人AI战略/WS-A 买方/workspace|workspace]]"
relates_to:
  - "[[20_项目/个人AI战略/WS-A 买方/workspace|workspace]]"
version: 2
research_plan: null
mode: web_baseline
exploratory: false
web_baseline_run:
  tool: DeepSeek 网页版（chat.deepseek.com）
  settings: 深度思考 + 智能搜索
  run: 2
  conversation: 新对话
  run_at: "2026-10-25"
  question: 企业员工用的个人 AI（AI PC 上、IT 能管理的个人 agent）未来 2–3 年会怎么演变？对联想明年的战略意味着什么？（课题英文原文：Evolvement and future outlook of the Personal AI market and implications to Lenovo strategy going forward）
  searched_pages: 73
  inline_citations: 9
  cited_urls: 5
---

# DeepSeek 网页版回答 r2

同一道题在新对话里跑的第 2 次，设置和 r1 相同（深度思考、智能搜索都打开）。它是"现状"参照，不是严格的对照。r1 见 [[DeepSeek网页版回答 r1]]。

- 题目（原样发送）：企业员工用的个人 AI（AI PC 上、IT 能管理的个人 agent）未来 2–3 年会怎么演变？对联想明年的战略意味着什么？（课题英文原文：Evolvement and future outlook of the Personal AI market and implications to Lenovo strategy going forward）
- 网页版显示搜过 73 个网页；回答正文里有 9 处引用，指向 5 个网址。
- "回答原文"一节是网页版的输出，文字一字未改；正文里的 [n](网址) 就是网页上的引用角标和它链接的网址。

## 引用核对

口径和 r1、和通用 deep research（对照组）那组数字相同：一处引用算一次，打开链接，看原文支不支持引用所在的那句话。

| 结果 | 处数 |
|---|---|
| 打不开 | 2 |
| 对得上 | 6 |
| 对不上 | 1 |

| # | 引用 | 所在的句子（摘要） | 结果 | 依据 |
|---|---|---|---|---|
| 1 | [1] 新华财经 2026-10-23 | 杨元庆：未来 80% 词元在终端和边缘生成；个人数据、模型、智能体的专属计算体系；很多设备由 Agent 使用（同段还有"黄仁勋在 2026 年 GTC 上"） | 对得上 | 杨元庆这几句原文都有，例如"未来很多设备将不再由人直接使用，而是由Agent使用。"黄仁勋那句这篇里没有 |
| 2 | [28] 证券时报 3647883 | 同上一段 | 打不开 | 本机打开超时（浏览器和命令行都一样）。从同一篇稿件的中国日报网转载看，它是 2026-02 的报道，没有 80% 词元这句 |
| 3 | [14] 腾讯云开发者社区 | Agent 进入工作现场后 IT 要回答：谁启动的、以什么身份运行、能碰哪些文件…… | 对得上 | 原文："企业越需要知道它是谁启动的、以什么身份运行、能碰哪些文件、能访问哪些地址、异常时怎样停下来。" |
| 4 | [9] Digitalisation World 2026-10-22 | Tanium 覆盖 DGX Spark、RTX Spark；运行时控制：启动、监控并自动终止超过时间或资源阈值的 Agent，策略施加于运行中的进程 | 对得上 | 原文："start, monitor and automatically kill AI agents that exceed defined time or resource thresholds, applying policy-layer limits to running processes rather than configuration state alone" |
| 5 | [11] 디지털투데이（中文版）2026-05-02 | Microsoft Agent 365 纳管第三方 Agent，新增影子 AI 发现、Agent 运行设备/MCP 服务器/账号映射、生命周期管理 | 对得上 | 原文都有；但原文说生命周期管理是"计划在近期上线"，回答写成了已经新增 |
| 6 | [14] 腾讯云开发者社区 | 企业统一 Agent 平台的立项、采购、集成慢于员工自行部署；研发、运营、数据团队已先用起 IDE 助手、命令行 Agent | 对得上 | 原文："企业统一建设Agent平台，通常要经过立项、采购、集成和安全评审，推进速度不可能太快。" |
| 7 | [28] 证券时报 3647883 | 天禧 AI 演进：2024 年 4 月首发、2025 年 6 月端云一体、3.5 版多智能体，从"助手"到"队友"，再到"专家"和"AI Twin" | 打不开 | 同 #2。转载稿里这几点都有 |
| 8 | [1] 新华财经 2026-10-23 | 80% Token 在端侧生成；Token Hub 在统一算力平台上分配工作负载 | 对得上 | 原文："发展Token Hub，在统一算力平台上将不同工作负载分配给不同模型" |
| 9 | [9] Digitalisation World 2026-10-22 | 联想要在 BIOS/固件、设备管理接口和 Qira 运行时之间建立策略执行点，对端侧 Agent 的资源占用（CPU/GPU/内存/温度）和网络行为施加硬约束 | 对不上 | 原文讲的是 Tanium 能看到 CPU、内存、GPU、温度（"real-time visibility into process activity and resource utilisation — including CPU, memory, GPU and temperature"），是可见性，不是硬约束；BIOS、固件、联想、Qira 在原文里都没有 |

另外，回答里有几处带数字的说法没有引用，比如"Gartner 预测到 2028 年 25% 的企业安全漏洞可追溯到 AI Agent 滥用"、"Forrester 判断到 2027 年三分之一的大型企业将面临影子 AI Agent 治理问题"，以及"联想 AI PC 全球份额 25%—31%"。这些读者没法核对。

## 回答原文

未来2–3年，企业员工个人AI的演变主线，不是“PC里多了一个助手”，而是**PC从人的工具，变成Agent的宿主与执行环境；IT的管理对象，也从“设备上的软件”，转向“拥有身份、权限和运行时行为的数字行动者”**。对联想而言，这意味着明年的战略重心需要从“卖AI PC硬件”向“交付可被企业IT纳管的个人Agent基础设施”实质性地前移。

### 未来2–3年：企业个人AI的四个结构性变化

**1. Agent成为PC的一等公民，算力重心向端侧迁移**

黄仁勋在2026年GTC上已经明确判断，“输入指令，电脑执行”的范式正在终结，PC只有成为理解意图并主动执行任务的个人Agent，才符合AI时代的需求。联想杨元庆则给出了一个更具量化意味的预测：**未来80%的词元将在终端和边缘生成**，个人计算将围绕个人数据、模型和智能体，形成专属计算体系，很多设备将不再由人直接使用，而是由Agent使用。这背后是成本逻辑：随着Token消耗量急剧膨胀，将推理尽可能留在本地端侧，是企业控制AI使用成本的必然选择。[1](https://m.cnfin.com/gs-lb//zixun/20261023/4485652_1.html)[28](https://stcn.com/article/detail/3647883.html)

**2. 企业IT的管理对象发生质变：从“软件”到“Agent身份”**

这是企业个人AI与消费级个人AI最本质的分野。传统终端管理关心的是设备是否合规、软件是否授权、补丁是否及时；Agent进入工作现场后，IT需要回答的是：**它是谁启动的、以什么身份运行、能碰哪些文件、能访问哪些地址、异常时怎样停下来**。[14](https://cloud.tencent.com.cn/developer/article/2714644?policyId=1004#2)

Gartner已将此列为2027年战略技术趋势的核心议题：**AI Agent Identity**——每个Agent应拥有独立身份，在完成任务的动态过程中获得零常设权限（zero standing privilege），任务结束后权限即回收。Gartner进一步预测，**到2028年，25%的企业安全漏洞将可追溯到AI Agent滥用**，根源在于未受管理的机器权限和遗留凭证实践。Forrester则判断，**到2027年，三分之一的大型企业将面临“影子AI Agent治理问题”**，员工将个人AI Agent带入职场，模糊个人与职业边界，而现有安全控制验证的是身份和访问权限，而非意图，一个执行良性任务的Agent可能滥用其权限或暴露敏感信息。

**3. 治理工具正在成型，但管理缺口仍然显著**

平台侧已经开始响应。Microsoft Agent 365定位为“Agent的控制平面”，将纳管范围从Copilot、Teams扩展到第三方Agent，并新增影子AI发现、Agent资产上下文映射（Agent运行在哪台设备、连接哪些MCP服务器、关联哪些账号）以及生命周期管理（启动、停止、删除）。Tanium则从端点管理切入，率先覆盖NVIDIA本地AI硬件（DGX Spark、RTX Spark等），提供**运行时控制**：IT可以启动、监控并自动终止超过时间或资源阈值的Agent，并将策略层限制施加于运行中的进程，而非仅仅停留在配置状态。[9](https://www.digitalisationworld.com/news/24471-tanium-extends-endpoint-management-to-nvidias-local-ai-hardware)[11](https://www.digitaltoday.co.kr/cn/view/52477/microsoft-launches-agent-365-to-manage-third-party-ai-agents)

但一个结构性缺口在于：**企业统一Agent平台的立项、采购、集成节奏，远慢于员工在终端上自行部署Agent的速度**。研发、运营、数据团队往往已经先用起了IDE编程助手、命令行自动化Agent、桌面文件处理工具，各自解决具体问题，也各自留下管理盲区。终端侧Agent扩散大概率不是短期过渡现象，企业将长期面对自研Agent、开源框架、商业桌面助手、IDE插件并存的混合局面。[14](https://cloud.tencent.com.cn/developer/article/2714644?policyId=1004#2)

**4. Agent的能力层级在爬升，管理复杂度同步上升**

联想天禧AI的演进路径提供了一个观察样本：2024年4月作为端侧个人超级智能体首发，2025年6月升级为“端云一体”混合架构，到3.5版本已构建多智能体协同框架，从“助手”出落为“队友”；联想明确规划其继续向“专家”乃至“个人AI Twin”演进。Agent越接近真实工作能力，动态决策的范围越大，IT对其每一次动作进行意图级判断的难度就越高。管理重心必然从“安装控制”进一步下压到“运行时行为治理”。[28](https://stcn.com/article/detail/3647883.html)

### 对联想明年战略的含义

联想在企业个人AI上拥有一个被低估的结构性优势：**它同时处在“AI PC出货份额第一”和“企业商用PC存量基本盘”的交汇点上**。联想AI PC全球份额在不同统计口径下处于25%—31%区间，继续位居第一，且AI PC出货渗透率在快速攀升。商用PC的存量意味着联想已经握有企业IT信任关系和端点触达能力，问题在于如何将这一优势转化为Agent时代的治理入口。

**第一，将战略叙事从“AI PC份额领先”升级为“可管理个人Agent的首选载体”。** 在企业采购语境中，“AI PC”本身正在快速商品化——高盛预测2026年AI PC渗透率将达59%，招银国际判断2026年AI PC将成为主流标配机型。当AI PC成为标配，硬件参数不再是差异化来源。联想明年真正需要向企业IT证明的是：**天禧AI/Qira不仅是一个好用的个人智能体，更是一个可以被Intune、Tanium或企业自有管理平面以Agent粒度发现、约束、审计和终止的受管运行时**。这要求联想在Windows管理平面之外，主动将自己的Agent运行时与企业主流端点治理工具做深度互操作，而不是等待企业IT来适配。

**第二，把“端侧推理成本优势”转化为企业TCO叙事。** 杨元庆提出的80% Token在端侧生成，对企业客户的核心卖点不是技术指标，而是**在Agent使用频次指数级上升的场景下，将边际推理成本锁在硬件资产内部**。联想的Token Hub思路——在统一算力平台上将不同工作负载分配给不同模型——如果能够向企业IT暴露为可策略化配置的管理接口（例如按部门、按任务类型设定端侧/边缘/云端推理路由），就会从“成本优化功能”上升为“IT可治理的算力调度层”。[1](https://m.cnfin.com/gs-lb//zixun/20261023/4485652_1.html)

**第三，在商用产品线上，需要明确回答“Agent时代的ThinkPad是什么”。** 传统商用PC的竞争力锚点是可靠性、可管理性、生命周期成本。Agent PC需要在这三个锚点之上增加第四个：**Agent运行时的可预测性与可中断性**。这意味着联想需要在BIOS/固件层、设备管理接口和Qira运行时之间建立一致的策略执行点，使企业IT能够以不依赖上层应用的方式，对端侧Agent的资源占用（CPU/GPU/内存/温度）和网络行为施加硬约束。这不是一个可以在发布时补上的功能，而是需要在明年产品定义阶段就嵌入架构的选择。[9](https://www.digitalisationworld.com/news/24471-tanium-extends-endpoint-management-to-nvidias-local-ai-hardware)

**第四，个人AI与企业AI的“双轮”不能停留在口号层面，需要在渠道和服务体系中落地。** 联想已经提出“个人AI与企业AI双轮驱动”，并在中国区推进天禧AI 4.0从“副驾驶”向“主驾驶”演进。但企业市场的Agent交付天然带有治理属性：客户买的不是一个智能体，而是一套**可审计、可回滚、权限收敛的Agent运行环境**。联想明年的商用渠道能力需要从“设备部署”向“Agent策略配置与运行时治理”延伸，否则个人Agent的终端渗透率越高，企业IT的失控感越强，反而会抑制采购意愿。

**综合来看，联想明年的战略优先级建议排序为：Agent治理互操作能力 > 端侧算力调度接口的IT可配置性 > AI PC硬件规格的进一步升级。** 份额领先提供了一个窗口期，但这个窗口正在收窄——当2026年AI PC成为主流标配，真正的竞争将转向“谁的PC上，Agent跑得更可控”。联想在企业个人AI上的胜负手，不在于能否造出更强的个人Agent，而在于能否让企业IT相信：**部署在联想设备上的Agent，是他们管得住的那一类。**

## 网页版列出的搜索来源（73 个）

编号是网页版里的编号。第 24、27、43 条没能从页面上读出来，这里缺着。个别太长的网址去掉了末尾的查询参数；回答正文里的引用网址都是原样。

1. 中国金融信息网 · 2026/10/23 · 联想集团杨元庆：未来80%词元将在终端和边缘生成，AI设备将迎新变革 <https://m.cnfin.com/gs-lb//zixun/20261023/4485652_1.html>
2. 钛媒体 · 2026/10/22 · 黄仁勋押注新一轮“PC革命”，Agent找到了“最佳宿主”吗？ <https://www.tmtpost.com/8177566.html?rss=10jqka#1>
3. chinaaet.cn · 2026/10/23 · 联想判断未来80%Token将在终端和边缘生成 <http://chinaaet.cn/article/3000181273>
4. 今日头条 · 2026/10/22 · 黄仁勋押注新一轮“PC革命”，Agent找到了“最佳宿主”吗？ <https://www.toutiao.com/article/7699416405787165199/?wid=1792660375061>
5. BT财经 · 2026/10/22 · 英伟达宣称PC已死，押注AI智能体基础设施 <https://businesstimescn.com/articles/630827.html?in=wanfang#1>
6. 36氪 · 2026/10/22 · 刚刚，黄仁勋柏林震撼演讲，PC已死，AI智能体时代全面爆发 <https://36kr.com/p/4036220967752838#1>
7. IT之家 · 2026/10/23 · 联想杨元庆预测：未来 80% Token 将在终端和边缘生成，每个人都将需要一台家用服务器或 AI 中心 <https://m.ithome.com/html/1017074.htm>
8. Rti 中央廣播電臺 · 2026/06/11 · AI代理元年來臨 如何重燃AI PC需求？ <https://www.rti.org.tw/news?uid=3&pid=214010#1>
9. Digitalisation World · 2026/10/22 · Tanium extends endpoint management to NVIDIA's local AI hardware <https://www.digitalisationworld.com/news/24471-tanium-extends-endpoint-management-to-nvidias-local-ai-hardware>
10. IT Brief New Zealand · 2026/10/22 · Tanium teams with NVIDIA to manage local AI endpoints <https://itbrief.co.nz/story/tanium-teams-with-nvidia-to-manage-local-ai-endpoints>
11. 디지털투데이 · 2026/05/02 · Microsoft推出企业级AI Agent管理平台Agent 365，支持统一纳管第三方Agent <https://www.digitaltoday.co.kr/cn/view/52477/microsoft-launches-agent-365-to-manage-third-party-ai-agents>
12. IT Brief India · 2026/05/04 · Microsoft launches Agent 365 to oversee AI agents <https://itbrief.in/story/microsoft-launches-agent-365-to-oversee-ai-agents#1>
13. eWEEK · 2026/10/22 · ServiceNow and Nvidia Launch Arc Enterprise AI Agent <https://www.eweek.com/news/servicenow-nvidia-arc-ai-agent/>
14. Tencent · 2026/07/23 · AI时代，对于企业CIO来说，管理Agent比管理员工设备更有挑战性 <https://cloud.tencent.com.cn/developer/article/2714644?policyId=1004#2>
15. The Next Web · 2026/09/24 · AI agents are the next thing endpoint management has to govern <https://thenextweb.com/news/endpoint-management-ai-agents-automox>
16. anunta.us · 2026/10/08 · Omnissa ONE 2026: What the Agentic Pivot Means for Partners in Q4 <https://www.anunta.us/anunta-blog-us/omnissa-one-2026>
17. Perplexity · 2026/05/22 · Perplexity <https://www.perplexity.ai/page/110220a8-3fc4-4370-a556-df87534666b7>
18. 中央社 CNA · 2026/06/01 · 搶攻企業主權AI商機！NeuroWatt於Computex發表地端算力軟硬整合方案 <https://www.cna.com.tw/business/chinese/434982>
19. Tiger Brokers · 2025/12/13 · 招銀國際稱2026年AI PC將成主流標配機型 聯想(00992)憑藉內存戰略備貨防禦性最強 <https://www.itiger.com/hant/news/2591631175>
20. 证券之星 · 2025/12/13 · 招银国际称2026年AI PC将成主流标配机型 联想凭借内存战略备货防御性最强 <https://4g.stockstar.com/detail/IG2025121300015046>
21. CHINAZ · 2026/09/02 · 全球AI PC第一是谁？联想25.1%份额继续居首，国内37款产品通过L3测试 <https://www.chinaz.com/2026/0902/1774795.shtml#1>
22. 极客公园 · 2026/09/02 · 全球 AI PC 谁第一？联想集团以 25.1% 份额继续居首 <https://w.geekpark.net/news/369716#1>
23. 未央网 · 2026/09/14 · 国内AI终端头部企业观察：联想集团的多端矩阵与能力图谱 <https://www.weiyangx.com/481917.html#1>
25. 鉅亨號 · 2026/09/12 · 個人電腦，靠AI續命？ <https://hao.cnyes.com/post/267421?utm_source=cnyes&utm_medium=home&utm_campaign=postid#1>
26. 36Kr · 2026/08/18 · Are AI-Powered PCs Gaining a New Lease of Life? Exploring the Revitalization of Personal Computers <https://eu.36kr.com/en/p/3944497978883203#1#1>
28. 证券时报 · 2026/02/24 · “天禧AI”首次亮相联想业绩沟通会并提问 联想刘军透露“三大轴线”进化路线 <https://stcn.com/article/detail/3647883.html>
29. 上海证券报 · 2026/03/02 · 联想集团刘军：天禧AI将沿“三大轴线”进化 <https://www.cnstock.com/commonDetail/643488>
30. China Daily · 2026/02/25 · 联想刘军：从队友到AI Twin，天禧AI将沿“三大轴线”进化 <http://ex.chinadaily.com.cn/exchange/partners/114/rss/channel/cn/columns/07pz5d/stories/WS699ea31fa310942cc49a0779.html>
31. jingjiribao.cn · 2026/05/25 · 联想中国全面发力智能经济 <http://rss.jingjiribao.cn/static/detail.jsp?id=658794>
32. Cnfin · 2026/01/17 · 如何构建下一代AI生态？联想：个人AI与企业AI双轮驱动 <https://m.cnfin.com/wx/share?url=//m.cnfin.com/gs-lb//zixun/20260116/4366961_1.html>
33. 上海证券报 · 2026/05/25 · 联想中国将全面发力智能经济 <https://www.cnstock.com/commonDetail/719682>
34. Jingjiribao · 2026/05/20 · 联想启动“苍穹计划” 将投入1万亿Token算力 <http://www.jingjiribao.cn/static/detail.jsp?id=657677>
35. TMCnet · 2026/10/21 · Forrester's 2027 Asia Pacific Predictions: One In Three Large Enterprises Will Face A Shadow AI Agent Governance Problem <https://www.tmcnet.com/usubmit/2026/10/21/10467822.htm#1>
36. iThome · 2026/10/23 · Gartner揭2027科技趨勢，AI代理身分管理與自主曝險修補成資安焦點 <https://www.ithome.com.tw/news/179893>
37. 至顶网 · 2026/10/23 · 5个让CIO转型为"主动架构师"的技术趋势 <https://www.zhiding.cn/ai/2026/1023/3203338.shtml>
38. Gartner · 2026/10/20 · Gartner IT Symposium/Xpo 2026 Orlando: Day 2 Highlights <https://www.gartner.com/en/newsroom/press-releases/2026-10-20-gartner-it-symposium-xpo-2026-orlando-day-2-highlights>
39. Infor · 2026/10/21 · Gartner IT Symposium/Xpo 2026 Day 3 Highlights <https://www.infor.com/blog/gartner-2026-day-3-governed-ai-trust>
40. Express Computer · 2026/10/22 · Gartner identifies 10 strategic technology trends for 2027, highlighting AI governance and digital sovereignty <https://www.expresscomputer.in/amp/news/gartner-identifies-10-strategic-technology-trends-for-2027-highlighting-ai-governance-and-digital-sovereignty/140229/>
41. 벤처스퀘어 · 2026/10/21 · Gartner Announces Top 10 Strategic Technology Trends for 2027 <https://www.venturesquare.net/en/1121720/#1>
42. SecurityBrief Asia · 2026/10/22 · Forrester warns of shadow AI surge across Asia Pacific <https://securitybrief.asia/story/forrester-warns-of-shadow-ai-surge-across-asia-pacific>
44. Biometric Update · 2025/09/25 · Okta upgrade of agentic AI capabilities includes support for mDLs, digital IDs <https://www.biometricupdate.com/202509/okta-upgrade-of-agentic-ai-capabilities-includes-support-for-mdls-digital-ids>
45. Lenovo StoryHub · 2026/01/07 · Lenovo at CES 2026: Smarter AI Meets Purposeful Business Innovation <https://news.lenovo.com/pressroom/press-releases/lenovo-at-ces-2026-smarter-ai-meets-purposeful-business-innovation/>
46. Cnfin · 2026/04/03 · 联想刘军：打造智能体“FDE”模式 营收和利润“剑指”双位数增长 <https://m.cnfin.com/wx/share?url=//m.cnfin.com/cmjj-lb//zixun/20260402/4395062_1.html>
47. 央广网 · 2026/04/01 · 联想集团杨元庆：联想要成为一家AI原生公司 <http://tech.cnr.cn/techph/20260401/t20260401_527569840.shtml>
48. udn科技玩家 · 2026/01/08 · 聯想推動混合式AI優勢 攜手NVIDIA、F1與FIFA展示「代理式AI」落地應用 <https://tech.udn.com/tech/story/123717/9251729?form=udn_ch2_common3_cate#1>
49. 快科技 · 2026/09/28 · 联想集团亮相CES 2026：发布新一代商用产品与AI体验创新 打造企业生产力新范式 <https://m.mydrivers.com/newsview/1096985.html?ref=#1>
50. 泡泡网 · 2026/05/28 · 2026联想中小企业合作伙伴大会举办，抢占Token词元经济风口 <https://m.pcpop.com/article_6931255.html>
51. 太平洋科技 · 2026/05/28 · 太平洋科技 企业站 <https://smb.pconline.com.cn/2160/21602191.html>
52. iThome · 2026/05/05 · 微軟推出AI代理人管理平臺Agent 365、Windows 365 for Agents <https://www.ithome.com.tw/news/175555#1>
53. Learn Microsoft · 2026/08/25 · 了解 Microsoft 365 管理中心中的影子 AI <https://learn.microsoft.com/zh-cn/microsoft-365/admin/manage/agent-shadow-ai?view=o365-21vianet#1>
54. CrowdStrike · 2026/03/23 · CrowdStrike Innovations Secure AI Agents and Govern Shadow AI <https://www.crowdstrike.com/en-us/blog/new-crowdstrike-innovations-secure-ai-agents-govern-shadow-ai/>
55. Okta · 2026/09/01 · Okta Identity Security Posture Management (ISPM) release announcements <https://help.okta.com/ispm/en-us/content/topics/releasenotes/ispm/ispm-rn.htm>
56. IT Brief New Zealand · 2026/10/21 · AppViewX adds shadow AI agent controls & quantum IDs <https://itbrief.co.nz/story/appviewx-adds-shadow-ai-agent-controls-quantum-ids#1>
57. The Futurum Group · 2026/05/08 · Microsoft Agent 365 Turns Shadow AI Into a Governed Asset Class <https://futurumgroup.com/insights/microsoft-agent-365-turns-shadow-ai-into-a-governed-asset-class/>
58. 디지털투데이 · 2026/05/02 · Microsoft、「Agent 365」を一般提供開始 他社製AIエージェントも一元管理 <http://www.digitaltoday.co.kr/jp/view/52478/microsoft-launches-agent-365-to-manage-third-party-ai-agents>
59. Windows Blog · 2026/10/07 · Building Windows for hybrid intelligence <https://blogs.windows.com/windowsexperience/2026/10/07/building-windows-for-hybrid-intelligence/>
60. 디지털투데이 · 2026/05/02 · Microsoft launches Agent 365 to manage third-party AI agents <https://www.digitaltoday.co.kr/en/view/52472/microsoft-launches-agent-365-to-manage-third-party-ai-agents#1>
61. Learn Microsoft · 2026/08/21 · Windows 11 作為管理式 AI 體驗的基礎 <https://learn.microsoft.com/zh-tw/training/modules/manage-ai/4-foundation>
62. ITforBusiness.fr · 2026/06/05 · Build 2026 (2/2) : Comment Microsoft assemble sa plateforme pour agents d’entreprise <https://www.itforbusiness.fr/build-2026-2-2-comment-microsoft-assemble-sa-plateforme-pour-agents-dentreprise-104503#1>
63. Benzinga · 2026/10/22 · Satya Nadella Says Microsoft Is Rebuilding Around AI Agents <https://www.benzinga.com/markets/tech/26/10/62517972/satya-nadella-says-microsoft-is-rebuilding-around-ai-agents-as-trump-pushes-super-intelligence-from-11000-models-to-agents-that-work-on-your-behalf>
64. Dell · 2026/10/07 · Dell Technologies Drives the Agentic AI Era with New Windows PCs and Workstations <https://www.dell.com/en-au/dt/corporate/newsroom/announcements/detailpage.press-releases~usa~2026~10~dell-technologies-drives-the-agentic-ai-era-with-new-windows-pcs-and-workstations.htm>
65. Dell · 2026/05/19 · 戴尔科技推出生产就绪型智能解决方案，实现从桌面端到数据中心的全面覆盖 <https://www.dell.com/en-us/dt/corporate/newsroom/announcements/detailpage.press-releases~china~2026~-.htm>
66. Dell · 2026/05/19 · Dell Technologies bringt produktiv einsatzbereite Agentic AI direkt auf den Schreibtisch <https://www.dell.com/en-us/dt/corporate/newsroom/announcements/detailpage.press-releases~germany~2026~05~20260519-02.htm>
67. 디지털투데이 · 2026/08/25 · エージェント型AIの拡大で推論はPCへ DellがAIインフラ再設計を提起 <https://www.digitaltoday.co.kr/jp/view/96306/ai-infrastructure-market-desktop-pcs-role-growing-as-agentic-ai-spreads#1>
68. ETNEWS : Korea IT News · 2026/08/26 · Dell Expands AI Infrastructure to the Desktop <https://en.etnews.com/20260826200006>
69. IT168 · 2026/08/27 · 进化，乘势而上 对话戴尔科技喻智娟：企业AI落地，终端的 <https://notebook.it168.com/a2026/0827/6947/000006947884.shtml>
70. 테크M · 2026/08/25 · [DTF 2026] 클라우드에서 책상 위로...델 "국내 기업용 데스크톱 1위, AI PC는 이제 시작" <https://www.techm.kr/news/articleView.html?idxno=154591>
71. 泡泡网 · 2026/05/28 · 2026戴尔科技集团春季新品品鉴会：让未来更从容，以全栈新品赋能企业数智化转型 <https://m.pcpop.com/article_6931480.html#1>
72. RCRTech · 2026/05/18 · Dell bets on enterprise control to scale agentic AI <https://rcrtech.com/analyst-angle/dell-enterprise-agentic-ai/>
73. 至顶智库 · 2026/06/02 · AI能力买齐了，链路正在加速打通：戴尔科技给企业递了一套“端到端”的解法 <https://www.zhiding.cn/ai-applications/2026/0602/3189121.shtml>
