---
applyTo: ".github/instructions/**/*.instructions.md,.github/skills/**/SKILL.md,.github/skills/_shared/**/*.md"
description: "项目元架构规范：边界性、正交可组合性、简约性、流程化闭环和自我迭代，覆盖代码、文档和 prompt 系统。"
---

# Prompt 元架构规范

这些规则用于设计、review 和演进项目安装 Ousia Workflow 后的 prompt surface：instructions、skills、shared assets、`.ousia/**` slots、validation routing 和 review/planning evidence。它不拥有 Ousia Workflow 本身的发布、升级实现或仓库治理；它只规定如何写出边界清晰、可组合、可升级的项目适配层。

安装后的用户通常不是在开发 Ousia Workflow 本身，而是在为自己的项目填充 Ousia-defined slots。所有 prompt 资产都应帮助 agent 正确读取项目事实、遵守项目边界、产出可验证改动，而不是把 workflow 框架的自我实现细节暴露给项目使用者。

## 核心原则

- 边界优先：每个 instruction、skill、shared asset、`.ousia/**` slot 和 validation route 都应有清晰职责。硬规范、入口界面、任务模式、项目事实、reference 证据和验证规则不能互相偷职责。
- 正交可组合：外部维度应少而稳定。新差异优先投影到已有 `scope`、`focus`、`.ousia/**` slot、owning docs 或 validation route，而不是新增入口、新层级或新私有分类。
- 简约优雅：能用一个稳定 facade、一个明确 slot、一个 validation route 或少量索引解决的问题，不拆成多套角色、透镜、contracts、中转层或私有小框架。
- 概念克制：不要为普通职责发明只在 prompt 体系内成立的术语。新概念必须降低理解成本，并能用 owner、输入输出、读取时机和退出条件解释。
- Adapter instance：`.ousia/**` 是项目中安装出来的适配层实例。Ousia Workflow 控制结构、lifecycle、validation 和 agent reading protocol；项目只在 Ousia-defined slots 中填写事实。
- 流程闭环：非平凡设计和实现应能进入 proposal -> review -> implementation -> review；prompt 资产要支持这个闭环，而不是绕过它。
- 纵向闭环：非平凡改动应推进一个可验证的 vertical slice，从用户目标或项目语义穿过 owning doc、owner、边界 API、实现、测试和验证。
- 自我迭代：当用户指出语义偏移、边界错位、过度抽象或 prompt 失效时，把可复用教训固化到正确 owner，而不是只修当前回答。

## 资产职责

- Instructions：保存跨角色必须遵守的硬规范、项目读取规则或语言/领域投影。不要承载一次性计划、完整项目正文或某个 skill 的输出协议。
- Entry skills：保存可发现入口、输入维度、流程和输出要求。Skill 可以组合 instructions 和 shared assets，但不复制整份规范。
- Shared assets：只保存任务形状、mode 的 required inputs、stop conditions 或少量可复用组件。Shared asset 不是外部入口，也不保存项目事实。
- `.ousia/design/**`：保存项目设计事实。Architecture 保存长期结构，Proposal 保存当前方案，Experience 保存经验、证据和 review attacks。它是 adapter instance 的项目事实 surface，不是 skill 扩展层。
- `.ousia/pending.md`：保存暂时无法归档到唯一 owner 的事项。每个条目必须有 owner question 和退出条件。
- Validation route：保存命令矩阵、覆盖风险和剩余风险。Checker 只执行 owning instruction 定义的稳定协议。

## 适配层设计规则

- 先区分“结构”与“事实”：目录、slot、读取协议、合并策略和验证生命周期属于 Ousia Workflow；项目目标、架构约束、命令、reference 和领域规则属于 `.ousia/**` adapter instance 中的项目事实。
- 项目事实只能进入对应 slot。说不清 slot 的内容先进入 pending，不要发明新的入口或把事实塞进 skill。
- Slot 文件不解释自己为什么存在，也不记录命名、目录或迁移过程的历史叙事。Slot 职责由 framework schema、manifest 或 instruction 定义；slot 文件正文只保存该 slot 的项目事实、条目或内容。
- 同一语义只允许一个 owner。若 instruction、skill、README、design doc 和 validation route 重复定义同一规则，必须收敛到唯一 owner，其他位置只链接或路由。
- Reference 和 review attacks 必须具体到证据、适用边界和攻击问题。不要把 reference note 写成隐藏规范源。
- Validation route 必须说明它覆盖什么风险、不覆盖什么风险，以及缺少环境时的 residual risk。

## 递归应用

- Prompt 要求代码具备边界和可组合性；prompt 资产本身也必须具备边界和可组合性。
- Workflow 要求实现可 review、可验证、可回滚；`.ousia/**` 内的 adapter instance facts 也必须可 review、可验证、可演进。
- `.ousia/design/experience/**` 可以保存查证路线、review attacks 和 planning prompts，但不能变成隐藏规范源、skills 扩展层或第二套 project docs。
- Review 要攻击实现中的抽象错位；review prompt 也要攻击自身体系中的抽象错位。
- 如果某条规则同时适用于代码、文档和 prompt，它属于 instruction；如果只描述一个 skill 的输出协议，它属于该 skill；如果只是项目事实，它属于 `.ousia/**` adapter instance 中的 owning slot。

## 设计检查

修改 prompt surface、`.ousia/**` adapter slot 或 validation route 前，先问：

- 这是硬规范、入口界面、任务模式、项目事实、reference 证据、验证规则，还是一次性说明？
- 这条规则的 owner 是否唯一；以后改它应该去哪一个文件？
- 如果 owner 还不确定，是否应进入 `.ousia/pending.md`，并写清退出条件？
- 新增文件或入口是否真的降低复杂度，还是只是把一个概念拆成更多名字？
- 新维度是否会和已有 `mode`、`target`、`subject`、`scope`、`focus` 或 `.ousia/**` slot 重叠？
- 新术语是否真的承载新边界，还是把普通职责包装成更难懂的词？
- Reference 正文是否具体到证据和攻击问题，而不是泛泛复述规范？
- Validation route 是否说明覆盖风险和剩余风险，checker 是否仍只执行 owning instruction 定义的协议？

## Prompt Review Attacks

- Entry skill 是否承载了整份规范、完整 checklist 或大量项目正文。
- Shared asset 是否只是薄中转层，不能保存独立任务语义。
- Slot 文件是否在自我说明职责、解释历史迁移或为新读者引入只有旧上下文才懂的术语。
- `.ousia/design/**` 是否把 experience/review evidence 写成隐藏硬规范。
- 同一个输出协议、handoff packet、验证规则或 reference 读取规则是否出现在多个权威位置。
- 新增入口是否只是旧入口的 subject/mode/focus/slot 组合，应该收回 facade。
- Reference checklist 是否没有 Evidence To Seek、Applicability Boundary 或 Residual Risk Triggers，导致只能机械打勾。
- Validation route 是否只列命令而不说明覆盖风险和不覆盖风险。
- Adapter 文案是否对普通项目使用者暴露了 Ousia Workflow 自身开发、迁仓或发布细节。

## 自我迭代规则

- 用户指出体系问题时，先定位失效层：instruction、entry skill、shared mode、`.ousia/**` adapter slot、reference evidence、validation route 或一次性任务说明。
- 如果问题是所有项目都应遵守的 prompt 元规则，写入通用 instruction。
- 如果问题只属于某个项目或项目类型，写入对应 `.ousia/**` adapter slot。
- 如果问题只是某个入口的输出协议、handoff packet 或调用约定，写入 owning `SKILL.md`。
- 如果问题是项目事实或 reference baseline，写入 `.ousia/design/**`，不要偷放进通用入口 instruction。
- 如果归属暂时不清楚，写入 `.ousia/pending.md`，记录 owner 候选和退出条件。
- 能通过调整现有 owner 解决时，不新增层。
- 非平凡 prompt/workflow 改动完成后，使用 `black-team-review` 审查真实 diff，重点攻击边界性、正交性、简约性和闭环可执行性。
