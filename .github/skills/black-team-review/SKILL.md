---
name: black-team-review
description: "用于统一黑队审查：实现 diff、全局扫描、架构提案、测试策略、语义漂移、边界违规、缺失测试、workflow 风险或提案假设。"
argument-hint: "subject、mode、scope、用户目标、输入、验证结果和可选审查重点"
---

# 黑队审查入口

只读审查。它不修改文件、不生成完整替代方案；结构性问题通过交接包交给 architecture planner。Subagent 只是执行载体，本 skill 拥有 subject/mode、证据要求、输出和交接语义。

## 外部接口

调用时提供：

- `subject`：`设计提案` 或 `代码实现`。
- `mode`：`diff` 或 `全局启发扫描`。
- `scope`：真实 diff、文件列表、子系统、测试树、proposal packet、文档区域或 workflow 区域。
- `user goal`：用户原始目标和不希望偏移的语义。
- `inputs`：实现摘要、验证结果、测试结果、proposal packet、已知 assumptions、open questions 或 residual risks。
- `focus`：可选；未提供时由 subject、mode 和 scope 推断。

## 组合资产

先读取 `.github/skills/_shared/index.md`，再按 `mode` 读取唯一匹配的组件。根据 subject 和 scope 追加 instructions、owning skills、目标文件、相邻模块、design facts、测试、reference sources、Experience evidence 或验证结果。审查测试质量、测试策略或测试树时读取 [SKILL.md](../test-engineering/SKILL.md)。审查 prompt surface diff 时读取 [SKILL.md](../prompt-surface/SKILL.md) 以及被改动 surface 的 owning skill。涉及项目事实时先读 `.ousia/workflow.json`，再按目标进入 `.ousia/design/architecture/**`、`.ousia/design/proposal/**` 或 `.ousia/design/experience/**`。

## Mode 映射

- `diff`
- `全局启发扫描`

Mode component 和 stop conditions 由 `_shared/index.md` 决定。subject、mode 和 scope 不匹配时，报告输入不匹配或要求切换 mode。

默认选择：

- 已经落地的代码、测试、文档或 workflow 改动，使用 `mode: diff`。
- 没有真实 diff、只有区域扫描或长期风险调查时，使用 `mode: 全局启发扫描`。
- 非平凡实现、重构、架构边界调整或 prompt/workflow 改动的 implementation review，使用 `subject: 代码实现`。
- 架构提案、design facts 落地前审查或 proposal packet 审查，使用 `subject: 设计提案`。
- 没有真实 diff 时，不把 review 伪装成 diff review；只有用户明确要求扫描时才切换到 `全局启发扫描`。

## 证据要求

Review 前尽量收集：

- 用户目标和不希望偏移的语义。
- 真实 diff、proposal packet、扫描范围或目标文件列表。
- 已运行检查、测试结果、失败信息和 residual risks。
- 目标区域的 design facts、相邻模块、调用方和测试。
- Prompt surface diff 的 owning instruction 或 skill；修改者使用的写作 skill 也是 reviewer 的审查证据。
- 项目专用语义或外部 baseline 的 design facts、reference 证据和必要的 Experience evidence。

证据不足时列为 residual risk 或输入不匹配 finding。

## Review Prompt 要求

无论由主 agent 直接执行还是交给 subagent，review 输入都必须包含：

- Review subject：`设计提案` 或 `代码实现`。
- Review mode：`diff` 或 `全局启发扫描`。
- 用户原始目标：保留用户的关键原话和不希望偏移的语义。
- Review scope：真实 diff、文件列表、子系统、proposal packet、测试树或文档区域。
- Vertical slice：本次改动推进的用户语义、跨越的 owner/边界/API/测试/design facts、完成条件和明确排除范围。
- Inputs：实现摘要、proposal packet、验证结果、测试结果、已知 assumptions、open questions、residual risks。
- Invariants：必须保持的边界、状态所有权、错误模型、测试语义、文档归属或 workflow 约束。
- Evidence to read：本 skill、`_shared/index.md`、index 路由到的 mode、相关 instructions、目标文件、相邻模块、design facts 或 reference。
- Prompt surface evidence：相关写作 skill、被改动 entry skill、shared asset、validation route 或 `.ousia/design/**` owner。
- Checks：已运行或计划运行的验证命令，以及它们覆盖或未覆盖的风险。
- Review focus：调用者希望重点攻击的问题。

如果使用 subagent，prompt 还必须声明只读、不修改文件、不得生成完整替代方案；结构性问题通过 handoff packet 交给 architecture planner。

Diff review 的证据源是真实 workspace diff。Subagent 直接读取 workspace diff。

## Subject 攻击焦点

`subject: 设计提案` 重点攻击：

- 用户目标是否被 proposal 偷换，目标与非目标是否清楚。
- 是否至少比较了两个真实候选方案，而不是只包装单一路径。
- 模块边界、状态所有权、依赖方向、数据流和副作用边界是否闭合。
- Prompt/workflow proposal 是否证明新增规则没有和现有 owner 冲突、重复定义或互相覆盖；如果只是收窄例外或拆分步骤，是否改写原 owner 而不是新增平行规则。
- 产品层落点、代码落点或 design facts 是否明确。
- proposal 或 design facts 是否把实现过程、文件迁移历史或 agent 刚完成的步骤写成进度噪音；除非历史事实解释当前兼容入口、删除条件、风险或迁移步骤，否则应要求改为当前结构、当前约束和下一步入口。
- proposal 是否声明了第一个可实施纵向切片，且边界清理、模块重排、命名修正都服务于该切片；如果只会继续横向整理，应阻塞进入 implementation。
- 迁移、兼容性、回滚和验证策略是否可执行。
- Assumptions、open questions 和 residual risks 是否足以阻止误实施。
- 用户纠偏提炼是否过度：是否把一次判断写成永久规则，是否把 Experience 样本直接升级成 checker，是否把可选字段伪装成必填字段。
- 项目语义漂移风险先按 `.ousia/workflow.json` 和目标 design primitive 判断；需要领域 attack prompts 时读取 Experience 后追加攻击。

`subject: 代码实现` 重点攻击：

- 真实 diff 是否偏离用户目标、architecture plan 或 design facts。
- 真实 diff 是否说明目标使用场景和工程形态影响；如果只能解释代码更整齐，却不能证明它改善 handler/controller、业务编排、状态、配置、副作用、诊断或测试组织，应要求收窄、补 proposal 或重新设计。
- Prompt/workflow diff 是否检查了相邻 instructions、owning skills、shared assets、design facts 和 checker routes，证明新增或修改规则没有语义冲突、重复定义或互相覆盖。
- 校验、归一化、默认值和错误映射是否出现多个权威位置。
- 失败路径是否先完成外部输入检查，再做状态修改或外部副作用。
- 内部 invariant 是否被边界建立后仍层层重复防御，或被包装成 public recoverable error。
- 抽象是否只是透传 helper、薄 service、空泛 adapter 或私有小框架。
- 真实 diff 是否推进了声明的纵向切片；如果只是连续收紧边界、改名、删除中间态而没有可观察语义闭环，应作为 finding 要求重新规划或收窄实施范围。
- 实现同步的文档是否只描述当前结构、状态 owner、兼容入口和可执行下一步；如果只是记录“本次移动/重组/拆分了什么”，应作为需要修正的文档噪音。
- 测试是否约束使用语义、失败无副作用和边界状态，而不是复述实现或只覆盖 happy path。
- 用户纠偏触发的实现是否保留了 Experience -> Proposal -> Review 的升级边界，而不是用最终解释、自查或验证命令替代闭环。
- 项目边界、reference 和实现偏好先按 `.ousia/workflow.json` 和目标 design primitive 判断；需要领域 attack prompts 时读取 Experience 后追加攻击。

`mode: 全局启发扫描` 只能报告风险和代表性证据；不能把扫描 finding 当成已验证修复方案。结构性问题应 handoff 给 architecture planner。

## 输出要求

Review 输出必须以 `findings` 开头。按严重程度排序，每条 finding 包含：

- 严重级别：`critical` / `high` / `medium` / `low`。
- 位置：文件、测试名、提案章节、代码区域或文档区域；能给行号时给行号。
- 问题：实际会坏在哪里，或哪条语义无法被证明。
- 证据：来自代码、测试、文档、proposal、diff、验证结果或 reference。
- 建议：最小修正方向，或是否需要 handoff 给 architecture planner。

无阻塞问题时使用对应固定句式：

- `设计提案`：`未发现需要阻塞提案进入实施的问题。`
- `代码实现`：`未发现需要阻塞合入的问题。`

随后列出：

- `Open questions`：需要用户、实现者或提案作者确认的问题。
- `Residual risks`：本次 review 无法覆盖或无法证明的风险。
- `Recommended follow-ups`：后续建议，不要混入当前必须修的 finding。

根据 subject 和 mode 追加要求：

- `设计提案` 必须明确是否阻塞 proposal 进入 implementation。
- `代码实现` 必须明确验证结果是否覆盖实际改动。
- 涉及 Experience evidence 时，必须列出已读取的 evidence 正文；未读取相关正文的部分标为 residual risk。
- `全局启发扫描` 必须明确哪些 finding 只是启发式风险，哪些需要 handoff 给 architecture planner。

需要后续架构处理时，按本 skill 的 handoff packet 输出。

## Handoff Packet

Review 发现结构性问题时，输出给 architecture planner 的 handoff packet 包含：

- 目标产品区域、代码模块或文档区域。
- 需要重新定义或补齐的纵向切片目标，以及当前边界整理为何无法证明完成语义。
- 触发 handoff 的 findings。
- 疑似边界、状态所有权、错误模型、测试质量或文档归属问题。
- 必须保留的外部语义。
- 建议 planner 比较的候选方向。
- 需要 proposal review 重点攻击的问题。
