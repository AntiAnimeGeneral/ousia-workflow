---
name: black-team-review
description: "用于统一黑队审查：实现 diff、全局启发扫描、架构提案、测试策略、语义漂移、边界违规、缺失测试、workflow 风险或提案假设；必须按 scope 读取相关领域 skill 作为审查规范。"
argument-hint: "subject、mode、scope、用户目标、输入、验证结果、相关领域规范和可选审查重点"
---

# 黑队审查入口

只读审查。它不修改文件、不生成完整替代方案；结构性问题通过交接包交给
architecture planner。Subagent 只是执行载体，本 skill 拥有
subject/mode、证据要求、输出和交接语义。

## 外部接口

调用时提供：

- `subject`：`proposal`（设计提案）或 `implementation`（代码实现）。
- `mode`：`diff` 或 `scan`（全局启发扫描）。
- `scope`：真实 diff、文件列表、子系统、测试树、proposal packet、文档区域或
  workflow 区域。
- `user goal`：用户原始目标和不希望偏移的语义。
- `inputs`：实现摘要、验证结果、测试结果、proposal packet、已知
  assumptions、open questions 或 residual risks。
- `strictness`：可选，`focused`、`balanced` 或 `exhaustive`；默认
  `focused`。
- `focus`：可选；未提供时由 subject、mode 和 scope 推断。

## 审查强度与阻塞语义

Finding 必须证明对用户目标、correctness、security、compatibility、状态/副作用不变量、稳定协议或可验证交付的具体影响。存在另一种实现、还能增加测试组合、命名或文案可以更好、抽象可以更统一，本身都不是阻塞证据。

- `focused`：默认。只有 `critical` 和 `high` 是 blocking finding。`medium` 和
  `low` 去重后进入 `Recommended follow-ups`，必须由用户明确选择后才进入当前实现。
- `balanced`：`critical` 和 `high` 阻塞；直接影响当前纵向切片、证据充分且可局部修复的
  `medium` 也可以阻塞。其他 `medium` 与 `low` 仍由用户选择。
- `exhaustive`：用户明确要求深审时使用。可以逐条展示所有级别，但每条仍须满足
  materiality；`critical` 和 `high` 始终阻塞，用户指定 focus 只能影响
  `medium`/`low` 的展示和处理选择，不得绕过高风险 gate。不得把完整展示等同于全部返工。

Reviewer 不得通过提高严重级别来表达个人偏好。无法证明 material impact 的观察不得进入
`findings`。

## 组合资产

消费 `.ousia/framework.json` 已解析的 concern
assets，并追加目标文件、相邻模块、design facts、测试、reference
sources、Experience evidence或验证结果。Entry skill 不重新判断 concern 到 domain
skill 的映射。项目事实按 manifest 声明的slot进入owning sources。

## Mode 映射

- `diff`
- `scan`

`diff`要求真实落地文件或workspace
diff，并输入用户目标、subject、实现/提案摘要、checks和residual
risks；没有真实diff时不得伪装成diff review。

`scan` 用于没有单次diff的设计区、代码子系统、测试树或workflow区域。它只报告启发式风险，不能声称已验证修复；scope过大且没有focus时先收窄，结构性finding交给architecture
planner。

subject、mode和scope不匹配时，报告输入不匹配或要求切换mode。

默认选择：

- 已经落地的代码、测试、文档或 workflow 改动，使用 `mode: diff`。
- 没有真实 diff、只有区域扫描或长期风险调查时，使用 `mode: scan`。
- 非平凡实现、重构、架构边界调整或 prompt/workflow 改动的 implementation
  review，使用 `subject: implementation`。
- 架构提案、design facts 落地前审查或 proposal packet 审查，使用
  `subject: proposal`。
- 没有真实 diff 时，不把 review 伪装成 diff
  review；只有用户明确要求扫描时才切换到 `scan`。

## 证据要求

Review 前尽量收集：

- 用户目标和不希望偏移的语义。
- 真实 diff、proposal packet、扫描范围或目标文件列表。
- 已运行检查、测试结果、失败信息和 residual risks。
- 目标区域的 design facts、相邻模块、调用方和测试。
- Prompt surface diff 的 owning instruction 或 skill；修改者使用的写作 skill
  也是 reviewer 的审查证据。
- Markdown、README、design docs 或 `.ousia/design/**` diff 的 documentation
  authoring skill 和 documentation protocol instruction。
- 项目专用语义或外部 baseline 的 design facts、reference 证据和必要的 Experience
  evidence。

证据不足时列为 residual risk 或输入不匹配 finding。

工程质量 evidence 和 smell catalog 由 `engineering-quality` 拥有；本 skill
只拥有 review subject、mode、证据要求、输出协议和 handoff。

## Review Prompt 要求

无论由主 agent 直接执行还是交给 subagent，review 输入都必须包含：

- Review subject：`proposal` 或 `implementation`。
- Review mode：`diff` 或 `scan`。
- 用户原始目标：保留用户的关键原话和不希望偏移的语义。
- Review scope：真实 diff、文件列表、子系统、proposal packet、测试树或文档区域。
- Vertical slice：本次改动推进的用户语义、跨越的 owner/边界/API/测试/design
  facts、完成条件和明确排除范围。
- Inputs：实现摘要、proposal packet、验证结果、测试结果、已知 assumptions、open
  questions、residual risks。
- Invariants：必须保持的边界、状态所有权、错误模型、测试语义、文档归属或
  workflow 约束。
- Evidence to read：本 skill、相关owning skills、目标文件、相邻模块、design
  facts 或 reference。
- Domain evidence：scope 命中的领域 skill 及其 review
  checklist；若未读取，必须在 residual risks 中说明为什么不适用。
- Prompt surface evidence：相关写作 skill、被改动 entry skill、validation route
  或 `.ousia/design/**` owner。
- Documentation evidence：documentation authoring skill、documentation protocol
  instruction、文档 owner、index-only 约束和目标读者。
- Checks：已运行或计划运行的验证命令，以及它们覆盖或未覆盖的风险。
- Review focus：调用者希望重点攻击的问题。
- Review strictness：默认 `focused`；非默认值必须来自用户或当前 proposal 的明确要求。

如果使用 subagent，prompt
还必须声明只读、不修改文件、不得生成完整替代方案；结构性问题通过 handoff packet
交给 architecture planner。

Diff review 的证据源是真实 workspace diff。Subagent 直接读取 workspace diff。

## Subject 攻击焦点

`subject: proposal` 重点攻击：

- 用户目标是否被 proposal 偷换，目标与非目标是否清楚。
- 是否至少比较了两个真实候选方案，而不是只包装单一路径。
- 模块边界、状态所有权、依赖方向、数据流和副作用边界是否闭合。
- Prompt/workflow proposal 是否证明新增规则没有和现有 owner
  冲突、重复定义或互相覆盖；如果只是收窄例外或拆分步骤，是否改写原 owner
  而不是新增平行规则。
- 产品层落点、代码落点或 design facts 是否明确。
- 工程质量是否按 `engineering-quality` 转成可证明 evidence；如果 proposal
  只写参考框架理念、目录形状或抽象命名，应要求补证据或收窄。
- proposal 或 design facts 是否把实现过程、文件迁移历史或 agent
  刚完成的步骤写成进度噪音；除非历史事实解释当前兼容入口、删除条件、风险或迁移步骤，否则应要求改为当前结构、当前约束和下一步入口。
- proposal
  是否声明了第一个可实施纵向切片，且边界清理、模块重排、命名修正都服务于该切片；如果只会继续横向整理，应阻塞进入
  implementation。
- 迁移、兼容性、回滚和验证策略是否可执行。
- Assumptions、open questions 和 residual risks 是否足以阻止误实施。
- 用户纠偏提炼是否过度：是否把一次判断写成永久规则，是否把 Experience
  样本直接升级成 checker，是否把可选字段伪装成必填字段。
- 项目语义漂移风险先按 `.ousia/framework.json` 和目标 design primitive
  判断；需要领域 attack prompts 时读取 Experience 后追加攻击。

`subject: implementation` 重点攻击：

- 真实 diff 是否偏离用户目标、architecture plan 或 design facts。
- diff 是否说明目标场景和工程影响；若只解释代码整齐，不能证明它改善
  编排、状态、副作用、诊断或测试，应收窄或重设。
- 实现是否用目录形状、框架术语或薄 service 代替 `engineering-quality` evidence。
- 是否出现 `engineering-quality` smell catalog 中的失控形态。
- Prompt/workflow diff 是否检查了相邻 instructions、owning skills、manifest
  routes、design facts 和 checker
  routes，证明新增或修改规则没有语义冲突、重复定义或互相覆盖。
- 校验、归一化、默认值和错误映射是否出现多个权威位置。
- 失败路径是否先完成外部输入检查，再做状态修改或外部副作用。
- 内部 invariant 是否被边界建立后仍层层重复防御，或被包装成 public recoverable
  error。
- 抽象是否只是透传 helper、薄 service、空泛 adapter 或私有小框架。
- 真实 diff
  是否推进了声明的纵向切片；如果只是连续收紧边界、改名、删除中间态而没有可观察语义闭环，应作为
  finding 要求重新规划或收窄实施范围。
- 实现同步的文档是否只描述当前结构、状态
  owner、兼容入口和可执行下一步；如果只是记录“本次移动/重组/拆分了什么”，应作为需要修正的文档噪音。
- Markdown、README、design docs 或 `.ousia/design/**` diff 是否按
  `documentation-authoring` 约束当前事实、归属、Mermaid
  表达、临时实现风险和目标读者；不能只依赖 skill description 自动发现。
- 测试是否约束使用语义、失败无副作用和边界状态，而不是复述实现或只覆盖 happy
  path。
- 如果 diff 或实现证据包含测试，必须按 `test-engineering` 报告 Test contract
  evidence：哪些测试是
  unit、integration、CLI/smoke；哪些测试证明失败无副作用；哪些测试缺少
  Goal/Scope/Semantics 或 fixture 透明度。
- 用户纠偏触发的实现是否保留了 Experience -> Proposal -> Review
  的升级边界，而不是用最终解释、自查或验证命令替代闭环。
- Implementation review 涉及当前 Proposal 时，必须判断其是否满足
  `documentation-authoring` 定义的关闭条件；存在阻塞
  finding、验证缺口、稳定事实未回写或未完成事项无 owner 时不得归档。
- 项目边界、reference 和实现偏好先按 `.ousia/framework.json` 和目标 design
  primitive 判断；需要领域 attack prompts 时读取 Experience 后追加攻击。

`mode: scan` 只能报告风险和代表性证据；不能把扫描 finding
当成已验证修复方案。结构性问题应 handoff 给 architecture planner。

## 输出要求

Review 输出必须以 `findings` 开头。`findings` 只包含当前 strictness 下的 blocking
findings，按严重程度排序。每条 finding 包含：

- 严重级别：`critical` / `high` / `medium` / `low`。
- 位置：文件、测试名、提案章节、代码区域或文档区域；能给行号时给行号。
- 问题：实际会坏在哪里，或哪条语义无法被证明。
- 证据：来自代码、测试、文档、proposal、diff、验证结果或 reference。
- 建议：最小修正方向，或是否需要 handoff 给 architecture planner。

无阻塞问题时使用对应固定句式：

- `proposal`：`未发现需要阻塞提案进入实施的问题。`
- `implementation`：`未发现需要阻塞合入的问题。`

随后列出：

- `Open questions`：需要用户、实现者或提案作者确认的问题。
- `Residual risks`：本次 review 无法覆盖或无法证明的风险。
- `Recommended follow-ups`：后续建议，不要混入当前必须修的 finding。

`medium`/`low` 或当前 strictness 下不阻塞的观察必须去重并简短放入
`Recommended follow-ups`；不得在输出中暗示主 agent 自动修复。用户明确选择某项后，它才成为新的当前工作。

固定无阻塞句式是 review 闭环的终止信号。输出该句后，主 agent 不得因为
`Recommended follow-ups` 自动继续修改。

根据 subject 和 mode 追加要求：

- `proposal` 必须明确是否阻塞 proposal 进入 implementation。
- `implementation` 必须明确验证结果是否覆盖实际改动。
- `implementation` 涉及当前 Proposal 时，必须明确输出
  `Proposal disposition`：`保持当前` 或 `可关闭并归档`，并列出判断 evidence。
- 涉及 Experience evidence 时，必须列出已读取的 evidence
  正文；未读取相关正文的部分标为 residual risk。
- `scan` 必须明确哪些 finding 只是启发式风险，哪些需要 handoff 给
  architecture planner。

需要后续架构处理时，按本 skill 的 handoff packet 输出。

## 复审与终止条件

主 agent 修复已接受的 blocking findings 后，复审 scope 只包含：

- 原 blocking findings；
- 为修复它们产生的 diff；
- 这些修复的直接回归和必须保持的不变量。

复审仍有 blocking finding 时继续闭环；没有 blocking finding 时立即停止并返回用户。复审中只有由当前 diff 引入、或此前证据不可见的 `critical`/`high` 可以新增为阻塞项；新的非阻塞观察不得扩大 scope 或延长返工。不得用固定最大轮数放过残留 blocking finding，也不得以“再完整扫一遍”为由重启无边界 review。

## Handoff Packet

Review 发现结构性问题时，输出给 architecture planner 的 handoff packet 包含：

- 目标产品区域、代码模块或文档区域。
- 需要重新定义或补齐的纵向切片目标，以及当前边界整理为何无法证明完成语义。
- 触发 handoff 的 findings。
- 疑似边界、状态所有权、错误模型、测试质量或文档归属问题。
- 必须保留的外部语义。
- 建议 planner 比较的候选方向。
- 需要 proposal review 重点攻击的问题。
