---
id: dec-w1-aipc-not-wtp
type: decision
status: 已确认
created: "2026-10-25"
updated: 2026-10-25T08:37:06.000Z
author: AI
derived_from:
  - "[[20_项目/个人AI战略/W1 形态/调查/形态演变/报告 v1|报告 v1]]"
relates_to:
  - "[[20_项目/个人AI战略/W1 形态/workspace|W1 形态]]"
  - "[[项目]]"
decided_by: Senior
trigger: "[[20_项目/个人AI战略/W1 形态/调查/形态演变/报告 v1|报告 v1]]"
reason: W1-H2 提议成立：2025 年商用 AI PC 增长主要来自 Windows 10 停服换机，AI 是随标配装上的；AI PC 按配备 NPU 统计，NPU 变成标配后渗透率会机械上升，和企业是否为 AI 付钱无关
affects:
  - "[[20_项目/个人AI战略/WS-A 买方/workspace|WS-A 买方]]"
  - "[[20_项目/个人AI战略/WS-B 用户/workspace|WS-B 用户]]"
  - "[[W1-H2 AI PC渗透主要靠换机周期]]"
  - "[[项目]]"
---

# W1 决定：AI PC 渗透率不作为企业为 AI 付费意愿的证据

> **已确认**：Senior 于 2026-10-25 确认（AI 根据 [[20_项目/个人AI战略/W1 形态/调查/形态演变/报告 v1|报告 v1]] 起草，Senior 审阅）。

## 决定

在 W2 及以后判断"企业愿不愿意为员工个人 AI 买单"时，**不把 AI PC 的出货、渗透率或占比当作企业为 AI 付费意愿的证据**。要论证付费意愿，必须找企业在换机之外、为 AI 能力本身付钱的证据（单独定价、溢价被接受、预算科目）。

## 理由

- **研究机构把换机列为主因**：Futurum 认为 2025 年企业 AI PC 采用的主要推手是 Windows 10 停服，而不是端侧 AI。“was the primary catalyst for enterprise AI PC adoption through 2025, rather than on-device AI capabilities themselves”（B 级，知识库）[[Futurum 2025-12 AI PC采用不会加速#^c1]]
- **另一家独立研究机构结论相同**：Omdia 分析师说带 AI 能力的 PC 是"顺带"买到的。“has been more by default than design, with the Windows 11 refresh being the driving factor”（B 级，知识库）[[ComputerWeekly 2025-10 Omdia称Win11才是换机主因#^c1]]；把 AI 当首要条件的客户极少。“It would be an incredibly niche set of customers whose first priority [would be] AI capability.”（B 级，知识库）[[ComputerWeekly 2025-10 Omdia称Win11才是换机主因#^c2]]
- **厂商财报印证**：微软 Windows OEM 收入下降，部分因为上一年有停服换机撑着。“a high prior-year comparable that benefited from Windows 10 end of support”（A 级，知识库）[[Microsoft 2026-07 FY26Q4 财报电话会#^c3]]；HP 说换机已经走完大半。“We now see roughly 70% of the Win 11 refresh complete.”（A 级，知识库）[[HP 2026-08 FY26Q3 财报电话会#^c3]]

另外，AI PC 按"配备 NPU 的 PC"统计，NPU 变成标配后渗透率会机械上升（见 [[20_项目/个人AI战略/W1 形态/调查/形态演变/报告 v1|报告 v1]] H2 一节的"注意定义"），这是推导，不是单独的证据。

## 影响

- WS-A：预算和付费意愿只能用采购和定价证据论证。
- 项目决策"押哪一层"：押"端侧算力"这一层，目前没有企业付费意愿的证据支持。

## 什么情况下要重新考虑

- 出现 A/B 级证据，显示企业为 AI 功能单独付了溢价，且这是采购的首要因素。
