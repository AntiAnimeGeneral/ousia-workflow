---
applyTo: "**"
description: "开发规范索引：按任务读取入口、架构抽象、实现质量、测试演进和设计任务模块。"
---

# 开发规范索引

除非任务只是机械改名、纯文案修改或格式修正，否则实现任务默认包含设计决策，必须同时遵守架构、抽象、边界和演进规则。

## 规范模块

- `.github/instructions/ousia-development-entry.instructions.md`：需求识别、依赖复用、相邻模块阅读、现有模式判断。
- `.github/instructions/ousia-architecture-abstraction.instructions.md`：架构边界、依赖方向、抽象取舍、命名和职责。
- `.github/instructions/ousia-implementation-quality.instructions.md`：实现质量、错误边界、失败前置检查和内部 invariant。
- `.github/instructions/ousia-testing-evolution.instructions.md`：测试语义、失败无副作用、可测试性和演进底线。
- `.github/instructions/ousia-design-task.instructions.md`：设计任务、候选方案、边界、迁移、验证和实施计划。
- `.github/instructions/ousia-prompt-architecture.instructions.md`：项目元架构规范，约束代码、文档和 prompt/skill/reference/workflow 的边界性、正交可组合性、简约性、闭环和自我迭代。

## 读取规则

- 实现者至少读取 `development-entry`、`architecture-abstraction` 和 `implementation-quality`；涉及测试或行为变化时读取 `testing-evolution`。
- 架构师读取全部开发规范模块，并按范围追加 documentation、workflow、language/framework/domain skill 或 installed adapter facts。
- 黑队 reviewer 按 review focus 读取对应模块：实现偏移看 entry/architecture/implementation，测试语义底线看 testing，proposal 审查看 design-task；涉及测试质量、测试策略或测试树时读取 `test-engineering`。
- Proposal reviewer 必须读取 `design-task`，并按 proposal 内容追加 architecture、implementation、testing、相关 skills 和 installed adapter facts；涉及测试策略时读取 `test-engineering`。
- 如果任务涉及 language/framework/domain-specific design、implementation 或 review，读取对应 skill。
- 如果任务涉及测试编写、测试重构、测试 review、fixture、测试层级、test contract、测试策略或验证命令选择，读取 `test-engineering`。
- 如果任务涉及当前 installed adapter 声明的领域边界、验证矩阵或项目约束，还必须读取 `.ousia/**` 路由到的 design facts。
- 如果任务涉及 Markdown、design docs、README、skills 或 instructions，还必须读取 `.github/instructions/ousia-documentation-standards.instructions.md`。
- 如果任务涉及架构边界、模块组合、抽象取舍、instructions、skills、shared assets、design-owned evidence、workflow 或 prompt 体系演进，还必须读取 `.github/instructions/ousia-prompt-architecture.instructions.md`。
- 如果任务涉及验证、review 闭环、subagent 使用边界、handoff、upgrade ownership 或最终报告，还必须读取 `.github/instructions/ext-ousia-workflow.instructions.md`。

## 组合式工作流

Facade skills 负责外部维度和入口输出协议：`architecture-planner` 使用 `mode` 与 `target`，`black-team-review` 使用 `subject` 与 `mode`。组合方式由 `.github/instructions/ext-ousia-workflow.instructions.md`、`.github/instructions/ousia-prompt-architecture.instructions.md`、`.ousia/workflow.json` 和入口 skill 的“组合资产”段约束；这些 prompt 结构也必须服从项目元架构规则。

不要在 skill 中复制 base instructions。产品层设计、代码实现、project 边界、文档归属和测试质量规则由 base instructions 与 lazy-load skills 提供；installed `.ousia/**` adapter instance 提供项目事实、约束和证据；shared assets 只描述任务形状。
