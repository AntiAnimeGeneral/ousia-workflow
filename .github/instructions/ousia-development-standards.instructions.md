---
applyTo: "**"
description: "开发规范索引：列出开发底线模块和任务入口路由。"
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

## 任务入口

- 实现任务至少读取 `development-entry`、`architecture-abstraction` 和 `implementation-quality`；涉及测试或行为变化时读取 `testing-evolution`。
- 设计、重构、边界调整、实施计划或 proposal packet 使用 `architecture-planner`；该 skill 拥有 mode、target、组合读取、输出协议和 handoff。
- 已落地 diff、prompt/workflow 改动、测试策略或全局风险审查使用 `black-team-review`；该 skill 拥有 subject、mode、证据要求、输出协议和 handoff。
- 测试编写、测试重构、测试 review、fixture、测试层级、test contract、测试策略或验证命令选择使用 `test-engineering`。
- Language、framework 或 domain-specific design、implementation、review 和 validation 使用对应 skill。
- 涉及 installed adapter 的领域边界、验证矩阵或项目约束时，按 `.ousia/workflow.json` 路由到 `.ousia/design/**` facts。
- Markdown、design docs、README、skills 或 instructions 改动读取 `ousia-documentation-standards` 的协议；文档正文写作和审查使用 `documentation-authoring`。
- Prompt surface 改动读取 `ousia-prompt-architecture` 并使用 `prompt-surface`；如果 prompt surface 是 Markdown，同时使用 `documentation-authoring` 检查表达质量。
- Review 闭环和 handoff 使用 `black-team-review`；planning handoff 使用 `architecture-planner`；验证路线使用对应 validation skill 或 installed `.ousia/workflow.json`。
- 项目特有的完成检查、subagent 运行策略、报告格式或 repository policy 由 host 项目自己的 policy surface 约束；Ousia baseline 不规定该 surface 的文件名、路径或命名规范。

本索引只负责发现底线规范和任务入口；planner/reviewer 的追加读取逻辑、外部维度、输出协议和 handoff 归对应 entry skill。Shared assets 只描述任务形状，不作为外部入口或隐藏规范源。
