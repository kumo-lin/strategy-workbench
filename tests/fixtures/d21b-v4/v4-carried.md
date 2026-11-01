<!-- 报告 v4 的真实片段（C 的正式 v4，代码 1b1c4b6，D-21-4）：沿用自 v3、数字对不上所引原文的 4 处，和它们的脚注。 -->
## Summary

| H1 2026–2027 年，有统一机队管理的大中型企业里，员工端侧个人 AI 的选型权在 IT/CIO 手里；「影子 AI」说明使用绕过 IT，不说明采购绕过 IT。 | 需要修正 | 受管终端上 IT 确实能看见实际使用并建立工具审批登记（[^1]），影子 AI 发生在使用层而非采购层（[^2]、[^3]），但技术岗决策权里 CIO 只占 12%、CTO 占 25%（[^4]），预算还在向业务部门扩散（[^5]），所以只能成立窄版本——IT 掌握准入门槛，不掌握全部选型与预算。 | 支持 B 级 6、C 级 23 · 反证 33 · 专家挑战 3 |

## 逐个假设

### H1

| 论断 | 关键数字 | 等级 | 出处 |
|---|---|---|---|
| 对 500 人以上企业 2000 名员工的调查显示，49% 承认未经雇主批准就使用 AI 工具，多数用的是免费版，属使用侧绕过，而非企业采购绕过 | 500 人、49% | B | [^2] |

### H2

| 挑战 | 回应 | 结论 | 出处 |
|---|---|---|---|
| 19% 把缺乏清晰商业案例视为最大顾虑，提示价值门槛替代可管性门槛 | 19% 与其他材料中安全治理占 48% 的比例口径不同，且商业案例顾虑针对的是投不投，不是准入评审[^57]；它不足以推翻准入层结论。[^6] | 推不翻 | [^69] |

### H3

- 修正后的假设：企业为员工端侧个人 AI 花钱时，能查到、能量化的计费单元集中在软件侧：按席位订阅的 Copilot 付费席位已超过 3000 万、单价为每用户每月 30 美元[^10]，设备也越来越多以设备加服务的打包订阅方式交付；硬件侧找不到为 AI 能力单独定价的科目，买方侧也没有同代同配置的比价证据支持 AI 溢价，厂商自述的溢价定价缺少买方印证得对不上。但「新增支出主要记在软件订阅/安全/管理服务科目」这一步只能部分成立：科目随交付形态走（跟着 PC 来就摊进设备成本，单独订阅就走软件预算，独立 AI 预算盘子很小），而且有相当比例的 AI 支出被认为落在企业 IT 预算之外，因此可以确认软件侧的计费科目可查、可计量，不能确认新增支出的主体份额落在这些科目上；硬件侧是否仍能拿到小幅、有条件的溢价，也缺买方证据。

## 引文出处

[^1]: “In one Jazz deployment the security team had sanctioned a handful of GenAI tools, and the agent found 1,223 in use.”（C 级，网络 · AI 定级）[[AI use rules for banks, broker-dealers and fintechs (2026)#^c5]]
[^2]: “In a new BlackFog survey, nearly half (49%) of workers admit to adopting AI tools without employer approval, many using free versions with which they are freely sharing sensitive enterprise data.”（B 级，知识库）[[CIO.com 2026-01 BlackFog影子AI调查#^c1]]
[^3]: “According to the findings, two-thirds of office professionals report having used AI tools or services at work even though they believed doing so was not permitted under company policy.”（B 级，知识库）[[PagerDuty 2026-06 影子AI调查#^c1]]
[^4]: “- Technical Supremacy: Technical roles (CTO, CIO, Head of AI/ML, CDO, VP Engineering, CISO) collectively control 72% of AI purchasing decisions, demonstrating that organizations prioritize technical expertise and implementation capability over traditional business considerations in AI investments.”（C 级，网络 · AI 定级）[[Technical Leaders Own 72% of Enterprise AI Purchasing Power#^c3]]
[^5]: “- Buying Power Continues to Drift Out of IT: Business units are already covering part of the AI bill.”（C 级，网络 · AI 定级）[[Enterprise AI Overruns Hit 46.9% Is the Reckoning in FY2027#^c4]]
[^6]: “某城商行2025年实施的AI服务商白名单制度要求：服务商需通过ISO/IEC27001认证、提供源代码托管权限、接受季度渗透测试。”（C 级，网络 · AI 定级）[[人工智能在金融领域的2025年法规解读与风险管理可行性分析报告.docx - 建立供应商“准入-监控-退出”全流程管控#^c6]]
[^10]: “Microsoft 365 Copilot costs $30 per user each month.”（C 级，网络 · AI 定级）[[EPCGroup 2026-10 Copilot定价与授权#^c1]]
[^39]: “- CTO Dominance: At 25%, CTOs hold more than double the decision-making authority of CIOs (12%), marking a shift from IT management to technology innovation leadership in AI adoption, and suggesting AI is viewed as a competitive differentiator rather than an operational tool.”（C 级，网络 · AI 定级）[[Technical Leaders Own 72% of Enterprise AI Purchasing Power#^c4]]
[^40]: “Futurum Group today released groundbreaking research mapping AI decision-making authority across enterprises, revealing that Chief Technology Officers (CTOs) have emerged as the dominant force in AI purchasing decisions at 25%—more than double the authority of any other single role.”（C 级，网络 · AI 定级）[[Technical Leaders Own 72% of Enterprise AI Purchasing Power#^c2]]
[^57]: “IDC identifies lack of security and governance as the leading concern surrounding enterprise AI globally, cited by 48% of organisations.”（C 级，知识库）[[Irish Tech News 2026-08 Logicalis CIO报告#^c3]]
[^69]: “Some 19% of CIOs identified a lack of a clear business case as their biggest concern about deploying the technology.”（C 级，网络 · AI 定级）[[CIOs under pressure to prove AI’s business value#^c3]]
