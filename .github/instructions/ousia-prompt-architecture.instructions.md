---
applyTo: ".github/instructions/**/*.instructions.md,.github/skills/**/SKILL.md,.github/skills/_shared/**/*.md"
description: "Prompt surface 抽象边界索引：说明 instructions、skills、shared assets、.ousia slots、validation routes 和 review/planning evidence 的读取边界。"
---

# Prompt 元架构索引

## 职责边界

- Instructions 保存跨项目必须自动生效的硬规范和项目读取规则。
- Entry skills 保存可发现入口、输入维度、流程、输出要求和 reviewer obligations。
- Shared assets 保存被入口 skill 复用的任务形状、mode inputs 或 stop conditions。
- `.ousia/design/**` 保存项目设计事实：Architecture 是长期结构，Proposal 是当前方案，Experience 是经验、证据和 review attacks。
- `.ousia/pending.md` 保存暂时无法归档到唯一 owner 的事项。
- Validation routes 保存命令矩阵、覆盖风险和剩余风险。
- Prompt 资产只暴露 agent 完成项目任务所需的读取边界。
- Markdown 写作质量和文档协议归 `.github/instructions/ousia-documentation-standards.instructions.md`。

## 读取规则

- 需要硬规范时读对应 instruction。
- 需要执行某类任务时读对应 entry skill。
- Entry skill 指向 `_shared/**` 时，只读被路由到的 shared asset。
- 需要项目事实时读 `.ousia/workflow.json`，再按目标进入 `.ousia/design/architecture/**`、`.ousia/design/proposal/**` 或 `.ousia/design/experience/**`。
- 需要经验、证据或 review attacks 时读 `.ousia/design/experience/**`。
- 需要 validation 语义时读 owning instruction、validation route 和对应 checker skill。

## 边界约束

- 硬规范、入口界面、任务模式、项目事实、reference evidence 和验证规则必须分属唯一 owner。
- 项目事实只能进入 `.ousia/**` adapter instance 的 owning slot。
- Shared asset 不是外部入口，也不保存项目事实。
- Entry skill 可以组合 instructions 和 shared assets，但不复制整份规范。
- `.ousia/design/experience/**` 可以保存查证路线和 review attacks，但不能变成隐藏规范源、skills 扩展层或第二套 project docs。
- Checker 只执行 owning instruction 定义的稳定协议。
