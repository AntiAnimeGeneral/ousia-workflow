---
applyTo: ".github/agents/**/*.agent.md,.github/instructions/**/*.instructions.md,.github/skills/**/SKILL.md,.ousia/framework.json"
description: "Prompt surface 抽象边界：约束 instructions、skills、Framework Manifest、项目 facts 和 validation routes 的唯一 owner。"
---

# Prompt 元架构索引

## 职责边界

- Instructions 保存跨项目必须自动生效的硬规范和项目读取规则。
- 工程调用边界、唯一 owner、失败前置检查、抽象有效性和测试 evidence 的硬规范归
  `ousia-engineering-standards.instructions.md`。
- Entry skills 保存可发现入口、输入维度、流程、输出要求和 reviewer obligations。
- Custom agents 保存执行载体的身份、模型、工具边界和最小角色说明；不复制 entry
  skill 的任务流程、输出协议或 reviewer obligations。
- `.ousia/framework.json` 保存 task/concern route、安装 inventory、project fact
  slots和prompt asset 读取预算，不保存prompt规则正文。
- `.ousia/design/**` 保存项目设计事实：Architecture 是长期结构，Proposal
  根目录是当前方案，`proposal/archive/**`
  是已关闭方案的历史决策与关闭证据，Experience 是经验、证据和 review attacks。
- `.ousia/pending.md` 保存暂时无法归档到唯一 owner 的事项。
- Validation routes 保存命令矩阵、覆盖风险和剩余风险。
- Prompt 资产只暴露 agent 完成项目任务所需的读取边界。
- Markdown 协议和 checker-owned 规则归
  `.github/instructions/ousia-documentation-standards.instructions.md`；文档正文写作质量和
  review obligation 归 `.github/skills/documentation-authoring/SKILL.md`。

## 读取规则

- 需要硬规范时读对应 instruction。
- 需要执行某类任务时读对应 entry skill。
- 需要启动专用执行载体时使用对应 custom agent；其正文只路由到 owning skill，不作为第二份任务规范。
- 需要项目事实时按 manifest 的 slot ID进入
  `.ousia/project.json`、`.ousia/design/architecture/**`、`.ousia/design/proposal/*.md`
  或 `.ousia/design/experience/**`。
- 只有历史比较、决策追溯或关闭证据查证时才定向读取
  `.ousia/design/proposal/archive/**`；归档提案不参与当前方案判断。
- 需要经验、证据或 review attacks 时读 `.ousia/design/experience/**`。
- 需要 validation 语义时读 owning instruction、validation route 和对应 checker
  skill。
- 当任务归属、skill 选择、design fact 取证或 validation route 边界不清时，先用
  `prompt-surface` 或 `architecture-planner` 明确
  owner、scope、应读取证据和剩余风险；`.ousia/framework.json` 和
  `.ousia/design/**` 只作为项目事实和 evidence，不作为隐藏规则源。

## 边界约束

- 硬规范、入口界面、任务模式、项目事实、reference evidence
  和验证规则必须分属唯一 owner。
- 同一语义只能有一个权威 owner；新增 prompt 规则前必须先检查相邻
  instruction、owning skill、`.ousia/design/**` 和 checker
  route，确认没有语义冲突、重复定义或互相覆盖。
- 规则不得用局部修正覆盖更宽的既有语义。若新规则只是收窄、补例外或拆分执行步骤，应改写原
  owner 中的既有规则，而不是在另一处追加一条近似规则。
- 冗余不是靠文字不同判断，而按 agent 行为判断：如果两条规则会让 agent
  在同一触发条件下做同一决策，必须合并、路由或删除其中一条。
- 项目事实只能进入 `.ousia/**` adapter instance 的 owning slot。
- Task mode、required inputs和stop conditions由对应entry skill拥有；entry
  skill不复制domain skill清单。
- 条件激活只能帮助 agent 选择正确任务入口和证据边界；不得新增隐藏
  autoconfig、plugin instruction 层、profile 层或第二套配置中心。
- `.ousia/design/experience/**` 可以保存查证路线和 review
  attacks，但不能变成隐藏规范源、skills 扩展层或第二套 project docs。
- Checker 只执行 owning instruction 定义的稳定协议。
