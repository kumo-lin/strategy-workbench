---
id: dec-w1-managed-agent-gap-to-w2
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
reason: W1-H1 提议需要修正：平台和 PC 厂商在供给侧已经把员工 agent 做成端云混合、带隔离和身份管控的形态；但员工大量自带云端工具、企业 agent 部署率低、管控工具尚未全部落地，需求侧没有证据
affects:
  - "[[20_项目/个人AI战略/WS-A 买方/workspace|WS-A 买方]]"
  - "[[20_项目/个人AI战略/WS-B 用户/workspace|WS-B 用户]]"
  - "[[W1-H1 员工个人AI走向端云混合的受控agent]]"
  - "[[项目]]"
---

# W1 决定：员工个人 AI 按"受控 agent"定义，供需之间的缺口交给 W2 验证

> **已确认**：Senior 于 2026-10-25 确认（AI 根据 [[20_项目/个人AI战略/W1 形态/调查/形态演变/报告 v1|报告 v1]] 起草，Senior 审阅）。

## 决定

1. 本项目里"企业员工的个人 AI"的形态，按"端云混合、受企业管控的 agent"来定义（供给侧已经成形）。
2. "受控 agent 能不能取代员工自带的云端工具"不在 W1 下结论，作为 W2 的主问题：WS-A 验证 IT 是否把"能管住"当作付费门槛；WS-B 验证员工会不会在 IT 管着的前提下放弃自带工具。

## 理由

- **供给侧：平台已把受控的端云混合 agent 做进系统**：微软把 Windows 定位成 agent 的平台。“a platform where agents can run locally when it makes sense, reach the cloud when they need to”（A 级，知识库）[[Microsoft 2026-10 Windows混合智能#^c1]]；IT 能区分 agent 和人的操作。“Identity makes clear which agent acted, so IT can distinguish agent activity from the person using the device”（A 级，知识库）[[Microsoft 2026-10 Windows混合智能#^c2]]
- **供给侧：PC 厂商也在做本地执行的个人 AI**：“Lenovo Qira can act on the user’s behalf using device capabilities and local AI, including offline”（A 级，知识库）[[联想 2026-01 Qira发布#^c2]]
- **需求侧：员工今天大量自带工具**：“two-thirds of office professionals report having used AI tools or services at work even though they believed doing so was not permitted under company policy”（B 级，知识库）[[PagerDuty 2026-06 影子AI调查#^c1]]；另一家、另一批样本结论相近。“nearly half (49%) of workers admit to adopting AI tools without employer approval”（B 级，知识库）[[CIO.com 2026-01 BlackFog影子AI调查#^c1]]
- **需求侧：企业部署和管控工具都还没跟上**：“only 17% of organizations have deployed AI agents to date”（B 级，知识库）[[Gartner 2026-04 Agentic AI成熟度曲线#^c2]]；“Intune policy for MXC process containers on Windows 11 is coming soon, without a date”（C 级，知识库）[[Fleet 2026-10 先盘点再隔离AI agent#^c2]]

这和高层在 [[2026-10-16 高层周会（模拟）]] 里给的方向一致：重点看 IT 能不能管。周会是方向，不是证据，所以不放进上面的理由。

## 影响

- WS-A、WS-B 的 workplan 共创以这条为前提。
- 第 3 枝：微软在把管理层做进 Windows，W3 要回答 PC 厂商在管理 / 安全栈这一层还能拿到什么。

## 什么情况下要重新考虑

- W2 发现员工自带工具的趋势在受控方案出现后仍然不减，或企业不把管控当作采购条件。
