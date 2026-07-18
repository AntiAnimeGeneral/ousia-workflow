---
name: architecture-planner
description: "用于生成架构计划、proposal packet 或全局启发扫描后的 architecture handoff：新实现、重构、模块边界修复、workflow 设计更新、adapter 边界设计、reference 对比、依赖决策、实施计划或设计事实更新。"
argument-hint: "mode、target、scope、用户目标、输入、验证期待、review/scan findings 和可选 focus"
---

# 架构规划入口

生成可审查的架构计划或提案包。它不实施改动、不自证正确、不审查已实施 diff。

## 外部接口

调用时提供：

- `mode`：`refactor`（重构）或 `new-module`（新模块）。
- `target`：`product`（产品层）或 `code`（代码）。
- `scope`：目标文件、文档区域、子系统、测试树、workflow 区域、reference baseline
  或扫描范围。
- `user goal`：用户原始目标和不希望偏移的语义。
- `inputs`：当前结构、已知痛点、约束、允许修改范围、验证期待、assumptions、open
  questions 或 residual risks。
- `focus`：可选；未提供时由 mode、target 和 scope 推断。

## Mode

`mode: refactor`
用于已有产品、代码、测试、文档或workflow的边界混乱、语义漂移或演进阻塞。Required
inputs是用户目标、重构范围、偏移证据、必须保留的语义和
`compatibility`。必须判断现有结构应继承、演进或停止模仿的部分，比较至少两个方向，并说明迁移、验证、回滚和review
focus。范围过大且没有具体痛点，或无法说明保留语义时，先收窄而不写稳定结论。

`mode: new-module` 用于新能力、新模块、新文档区域或新实现。Required
inputs是用户目标、能力范围、已知约束、验证期待和
`compatibility`。必须定义目标/非目标、模块和依赖边界、状态与副作用owner、产品或代码落点、测试和回滚。目标语义不清或无法判断target时先澄清。

`compatibility` 只能是 `required`、`forbidden` 或 `not-applicable`；`forbidden`
时方案不得引入兼容facade、adapter、bridge、旧schema转换或双写。

消费 `.ousia/framework.json` 已解析的 concern assets，并根据 target 和 scope
追加目标代码、相邻模块、测试、reference sources 或 `.ousia/design/experience/**`
evidence。Entry skill 不重新维护 concern 到 domain skill 的映射。项目事实按
manifest 声明的slot进入owning sources。

## 输入信息

开始前尽量收集：

- 用户目标和不希望改变的行为或设计语义。
- 目标文件、文档区域、相关模块、直接依赖和被依赖方。
- 当前测试、验证命令、失败信息和 residual risks。
- 现有设计文档、instruction、manifest 或 installed `.ousia/**` 约束。
- 是否允许同步修改测试、文档、public API 或 workflow。

资料不足时输出受限假设和待确认问题。

## 调用时机

在以下场景使用：

- 用户要求新功能/新实现前的架构方案、重构、边界调整、工程化改造或实现计划。
- 项目、子系统、测试树、文档区域或 workflow 出现长期偏移。
- 状态所有权、数据流、错误边界、副作用边界、文档归属或测试切入点不清楚。
- 需要判断能力应属于 framework core、installed adapter instance、local
  override、产品层、代码层或 Architecture/Proposal/Experience。
- 需要比较成熟库、外部系统或 reference implementation。

纯格式化、机械改名、单行 bugfix、代码解释或已有明确实施方案时不使用。

## 工作流程

1. 读取本 skill、相关owning
   skills、目标文件、相邻模块、测试、调用方和manifest路由的项目事实。
2. 用一两句话说清当前主流程：输入从哪来，输出到哪去，谁拥有状态，失败由谁处理。
3. 判断现有模式是稳定约束还是历史偶然。
4. 找出真正变化轴：经常变化的策略、稳定不变量、外部副作用、传输模型、领域模型、持久化模型和文档归属。
5. 涉及项目专用语义或外部 baseline 时，读取 reference 索引和对应正文，并在 plan
   中列出正文、具体文件或符号。
6. 至少比较两个方案：保守局部演进、边界修正、抽象提取、成熟库/现有模块复用、文档归属调整，或暂不改动。
7. 输出符合本 skill 输出要求的 architecture plan / proposal packet。
8. 定义最终目标状态和验收矩阵：完成后哪些
   owner、结构、行为、不变量和删除条件必须成立，以及由哪些测试、命令或人工场景证明。
9. 明确第一个可实施的纵向切片；边界整理、模块拆分或命名修正必须说明如何服务该切片。
10. 给出能由其他 agent 直接执行的实施方案和 proposal review
    focus；如需进入实施，输出本 skill 声明的 implementation handoff packet。
11. 声明 Proposal 的关闭条件；实施、验证、implementation review
    和稳定事实回写完成后，按 `documentation-authoring` 的生命周期归档。

## Target 特化

`target: product` 重点判断：

- 产品概念、目标/非目标、能力归属和稳定落点是否清楚。
- 设计是否足以指导实现，而不是只给理念、口号或历史过程。
- 项目专用归属和 reference/adoption 约束按 `.ousia/framework.json` 和 installed
  `.ousia/**` design facts 判断。

`target: code` 重点判断：

- 逻辑是否归属到正确边界。
- 状态所有权、数据流、错误边界和副作用顺序是否能用一句话说明。
- 校验、归一化、默认值和错误映射是否有单一权威位置。
- 失败前检查、副作用顺序、状态机表达和项目专用边界按 instructions、manifest 和
  installed `.ousia/**` design facts 判断。
- 非平凡工程实现是否按 `engineering-quality` 给出
  evidence，而不是只给目录、层名或框架术语。

## 规划原则

优先：

- 状态所有权唯一且可命名。
- 高层策略不反向依赖底层细节。
- 副作用集中在边界层，核心决策可测试。
- 公共抽象保存真实语义，而不是只包装调用。
- 测试覆盖新语义、失败路径、失败后的状态不变性和边界状态，不只覆盖 happy path。

避免：

- 为了“工程化”增加透传 helper、薄 service、空泛 adapter 或私有小框架。
- 把多个变化频率不同的东西硬塞进一个结构。
- 为了沿用旧模式继续复制旧问题。
- 在内部层层重复防御同一个已经由边界建立的不变量。

项目专用偏好、经验和约束归 installed `.ousia/**` design primitives；查证路线和
review attacks 进 Experience。

## Plan 必须说明

- 用户目标和原始问题。
- Mode：`refactor` 或 `new-module`。
- Target：`product` 或 `code`。
- 背景与约束。
- 目标与非目标。
- 当前结构中应继承、演进或停止模仿的部分。
- 至少两个候选方案，以及不选择它们的原因。
- 推荐方案和取舍理由。
- 推荐方案如何改善边界，而不是只增加层数。
- 最终目标状态：实现完成后必须成立的目录/模块/API/owner、数据流、状态和副作用边界、稳定不变量、应删除的旧表面，以及用户可观察行为。
- 验收矩阵：每项目标状态对应的自动测试、验证命令、结构扫描或人工场景；不能用“代码更清楚”“架构更合理”作为验收条件。
- 第一个可实施的纵向切片：目标语义、跨越 owner、边界 API、实现文件、design
  facts、测试层级、完成条件、排除范围，以及哪些边界调整是必要前置。
- 实施方案：按依赖顺序列出可独立验证的纵向切片；每个切片说明目标语义、允许修改范围、关键文件和符号、必要前置、实施步骤、完成条件、验证路线和明确排除范围，使未参与提案设计的
  agent 无需重新猜测架构即可实施。
- 模块边界、依赖方向、状态所有权、数据流和副作用边界。
- 状态所有权、数据流、副作用边界、错误映射层和内部 invariant。
- 校验、归一化、权限检查、错误映射和内部 invariant 所在层。
- Design 归属：稳定结论、reference
  事实、项目约束和采用理由分别落在哪里；项目专用命名按 installed adapter facts
  或 reference 表达。
- Engineering quality evidence：非平凡工程计划按 `engineering-quality` 选择适用
  evidence 并说明不适用项；不要在本 skill 复制完整 evidence catalog。
- 已读取的 reference 正文、本地 reference 文件/符号或 Experience
  evidence，以及采用、调整或拒绝的理由。
- 测试策略如何覆盖新语义、失败路径、失败后状态不变性和边界状态。
- 兼容性、迁移成本、回滚方式、验证命令和剩余风险。
- 已知 assumptions、open questions、residual risks 和 review focus。
- Proposal 关闭条件：哪些实施、验证、review、Architecture/Experience
  回写和未完成事项转移 evidence 成立后可以归档。

如果计划只能说明边界会更清楚，却不能定义可验收的最终目标状态和首个可验证纵向切片，必须先收窄
scope 或返回 architecture
handoff；不要输出只会导致连续边界整理、或需要实现者重新做一遍架构设计的实施计划。

如果调用者提供的是已经实施的 diff，本 skill 不应继续审查；应交给
`black-team-review` 按其 mode 规则处理。

## Implementation Handoff

Proposal review 通过或修正后，进入 implementation 的 handoff packet 包含：

- 已通过或已修正的 architecture plan 摘要。
- 第一个可实施纵向切片：目标语义、跨越 owner、边界 API、实现文件、design
  facts、测试层级、完成条件和排除范围。
- 允许修改范围。
- 必须保持的不变量和边界。
- 必须在实现中保留或建立的 engineering quality
  evidence，以及不能依赖目录形状或框架命名替代这些 evidence 的约束。
- 实施步骤。
- 验证命令。
- Implementation review focus。
