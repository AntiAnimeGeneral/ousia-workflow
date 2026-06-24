---
name: engineering-quality
description: "用于规划、实现审查或全局启发扫描非平凡工程质量边界；当 review scope 涉及 entry、orchestration、state、model、validation、side effect、configuration、diagnostics、tests、handoff docs 或成熟库级工程化证据时必须参考。"
argument-hint: "目标功能/模块、技术栈、用户目标、现有边界、验证期待、review/scan focus 和需证明的 evidence"
---

# Engineering Quality

本 skill 是 Ousia baseline 的 lazy-load 工程质量能力。它帮助 planner、reviewer 和实现者把“好工程”转成可证明 evidence，而不是依赖个人品味、目录模板或框架命名。

它不拥有 architecture plan 输出协议，也不拥有 review findings 输出协议。规划输出仍归 `architecture-planner`；审查输出仍归 `black-team-review`；具体项目事实仍归 installed `.ousia/**`。

这里的 evidence 指能让 reviewer 判断边界是否成立的可审查证据：owner、输入输出、状态提交点、失败无副作用、验证路径、诊断和接手文档。Evidence 不是固定字段填空，也不是某个技术栈的目录模板。

## 读取时机

在以下场景读取：

- 非平凡代码实现、重构、工程化改造或模块边界设计。
- Handler/controller、业务编排、状态、配置、副作用、诊断、测试或 handoff docs 可能混在一起。
- 用户要求借鉴成熟框架、工程最佳实践、Spring/Rails/Django/OTP/Kubernetes/Nix/Rust/Cargo 等 reference。
- Review 发现目录形状、框架术语、薄 service、测试复述实现或文档过程噪音替代了真实工程证据。

不在以下场景读取：

- 纯格式化、机械改名、单行 bugfix 或代码解释。
- 只涉及 Markdown protocol、checker 实现、installer manifest 等已有专属 owner 的窄任务，除非它们同时涉及工程质量边界。

## Evidence Catalog

非平凡工程计划或实现应能说明这些 evidence；不适用项必须说明原因。

| Evidence              | 要证明什么                                                                         |
| --------------------- | ---------------------------------------------------------------------------------- |
| Entry boundary        | 外部请求、命令、事件、任务或用户动作从哪里进入，入口是否保持薄。                   |
| Orchestration owner   | 哪个模块拥有业务流程，哪些部分只是调用外部副作用。                                 |
| State owner           | 可变状态由谁拥有，状态转移在哪里提交，失败后哪些状态必须不变。                     |
| Model boundaries      | 传输模型、领域模型、持久化模型和展示模型何时需要分开。                             |
| Validation authority  | 输入校验、归一化、默认值和错误映射的唯一权威层在哪里。                             |
| Side-effect boundary  | 数据库、文件、网络、消息、时间、随机数和外部系统调用在哪个边界发生。               |
| Configuration owner   | 配置从哪里声明、如何校验、默认值在哪里建立、local override 如何退出。              |
| Diagnostics contract  | 失败和关键状态如何暴露 phase、code、severity、evidence 和 remediation。            |
| Test contract         | 哪些测试穿过真实边界，哪些覆盖失败无副作用，哪些只是链路 smoke。                   |
| Handoff documentation | 下一位接手者能否从 README、Architecture、Proposal 或代码入口看懂当前结构和下一步。 |

这些 evidence 不是模板装饰。关键 evidence 填不出时，应收窄 scope、补 proposal 或重画边界，而不是继续实现。

## Reference Use

借鉴成熟框架或工程系统时，只抽取可迁移判断：

- Spring / AOP：context、lifecycle、configuration、cross-cutting owner、diagnostics、testing support。
- Rails / Django：约定如何降低决策负担，以及何时不能复制目录习惯。
- OTP / Kubernetes：状态 owner、恢复边界、desired state、status 和 controller responsibility。
- Nix / Cargo：可复现输入、版本/依赖边界、验证和回滚。
- Unix / LLVM：窄接口、组合性、pass/phase 边界和诊断。

不要复制目录、注解、运行时机制、命名、框架层级或技术栈习惯。Reference 的价值只在于帮助当前项目证明 owner、边界、状态、失败和验证。

## Examples

Examples 只帮助理解 evidence 如何落地，不新增规则，也不要求项目采用示例中的目录、类型名或 workflow surface。Ousia 是一个特殊的元项目，可以作为 few-shot 示例：当审查 Ousia 自身的 prompt surface、installer、checker、design docs 或 workflow routes 时，不把 prompt surface 词汇当作 evidence 的替代品，而是把它们映射回同一组工程问题。

| Evidence              | Ousia few-shot 示例                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Entry boundary        | 用户请求、agent mode、CLI 命令、installer 操作或 validation task 从哪里进入，入口是否只路由不承载主体。 |
| Orchestration owner   | owning skill、CLI module、installer module 或 checker route 谁拥有流程，谁只是提供 mode shape 或事实。 |
| State owner           | `.ousia/**` facts、manifest、snapshot、installed files、diagnostics 或 review state 由谁拥有和提交。     |
| Model boundaries      | Prompt surface、design facts、installer manifest、runtime code、test fixture 和 README 是否语义混用。  |
| Validation authority  | Frontmatter、Markdown protocol、workflow route、installer input 和 checker error 的权威校验层在哪里。  |
| Side-effect boundary  | 文件写入、安装覆盖、formatter、git staging、subagent 调用和外部命令在哪个边界发生。                    |
| Configuration owner   | Workflow routes、local overrides、installed adapter facts 和 validation commands 的声明 owner 在哪里。 |
| Diagnostics contract  | checker、installer、review 和 handoff 是否暴露 stable code、phase、evidence、remediation 或 residual risk。 |
| Test contract         | 哪些测试穿过 CLI/installer/checker 真实入口，哪些覆盖失败无副作用，哪些只是 docs smoke。              |
| Handoff documentation | README、Architecture、Proposal、Experience 或 owning skill 是否让下一位维护者知道入口、owner 和验证命令。 |

如果一个项目改动只能说明文件更整齐、术语更统一或文档更完整，却不能说明它改善某个 owner、边界、状态、验证或副作用路径，应收窄为文案整理，或补 proposal 后再实现。

## Smell Catalog

| Smell                         | 失控形态                                                     | 最小攻击                                                            |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Fat handler/controller        | 入口同时解析输入、执行业务、访问存储、映射错误和写日志。     | 要求指出 orchestration owner、state owner 和 side-effect boundary。 |
| Thin service / service 垃圾桶 | service 只按技术名装杂事，没有领域职责。                     | 要求说明它拥有的流程、不变量或变化轴；说不出则删除或重画边界。      |
| 模型混用                      | DTO、domain、persistence、view model 共用结构但语义不同。    | 要求说明每个模型的消费者和不变量；语义不同则分开。                  |
| 配置散落                      | 默认值、环境判断和 override 分布在多个调用点。               | 找唯一 configuration owner 和验证层。                               |
| 重复错误映射                  | 边界和内部层重复把同一错误转换多次。                         | 找 recoverable error、internal invariant 和 response mapping 边界。 |
| 先副作用后校验                | 外部输入失败时已修改状态或发出消息。                         | 要求失败无副作用测试和提交边界说明。                                |
| 测试复述实现                  | 测试复制 match 表、mock 内部 helper 或只断言 helper 被调用。 | 要求通过真实调用路径保护用户语义。                                  |
| Fixture 隐藏 owner            | fixture 让权限、状态或对象类型前置条件不可见。               | 要求测试契约暴露 goal、scope、semantics 和 owner。                  |
| 文档过程噪音                  | 文档记录“新增/移动/拆分了什么”，而不是当前结构和下一步。     | 要求改为当前入口、owner、状态、配置、诊断和验证命令。               |
| 空扩展点                      | 新接口、adapter、plugin 或分类无法说明允许哪类变化独立演进。 | 要求删除或写出真实变化轴和退出条件。                                |

## Planning Use

当 `architecture-planner` 调用本 skill 时，plan 应把 evidence 映射到第一个可实施纵向切片：

- 用户目标和首个可观察语义是什么。
- 输入从哪里进入，输出到哪里，谁拥有状态，失败由谁处理。
- 哪些边界调整是该纵向切片的必要前置。
- 哪些 reference 判断被采用、调整或拒绝。
- 哪些 tests 证明真实边界、失败路径和失败后状态不变。
- 哪些 docs 让下一位接手者理解入口、owner、状态、配置、诊断和验证命令。

如果 plan 只能给出目录、层名或“更工程化”的口号，应要求收窄或重画边界。

## Review Use

当 `black-team-review` 调用本 skill 时，review 应攻击：

- Diff 是否用目录形状、框架术语、薄 service 或新 adapter 代替 engineering evidence。
- 是否有 fat handler/controller、模型混用、配置散落、重复错误映射或先副作用后校验。
- Tests 是否保护用户语义、失败无副作用和边界状态，而不是复述实现。
- Docs 是否描述当前结构和可执行下一步，而不是过程流水。
- Proposal 是否把单次样本、example 或 reference 直接升级成 hard rule、checker 或 host 命名要求。

无论 planning 还是 review，examples 只能辅助判断，不能强制项目采用特定目录、类型名、框架或分层命名。

## Evidence Sources

可读取 installed `.ousia/design/experience/**` 中的 examples、dry-run、review attacks 或项目踩坑作为补充证据。它们不自动成为 baseline 规则；只有跨任务稳定、误报边界清楚且需要机械阻断的问题，才进入 checker。

具体 evidence 路径由 `.ousia/design/experience/index.md`、workflow route 或当前 proposal 指向；本 baseline skill 不硬编码某个仓库的 Experience 文件为必读依赖。

## 验证

按 repository policy、validation route 和 owning checker skill 选择验证命令；本 skill 只要求收集工程质量改动对应的验证证据、覆盖风险和剩余风险。
