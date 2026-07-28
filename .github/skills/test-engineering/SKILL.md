---
name: test-engineering
description: "用于测试编写、重构、设计、专项审查或全局启发扫描；当 review scope 包含测试文件、测试策略、测试证据、fixture、失败路径、冒烟/集成/单元边界，或实现把测试作为正确性证据时必须参考。"
argument-hint: "测试范围、用户语义、行为变化、失败路径、fixture、runner、验证期待和 review/scan focus"
---

# 测试工程

按任务触发的测试工作流，也是测试语义底线的唯一owner。

## 适用范围

- 测试编写、重构和审查。
- 新行为、行为变化和纵向切片的测试策略。
- 单元、集成、冒烟、fixture、表驱动和快照测试取舍。
- 失败路径、状态不变量和黑队输入设计。
- 测试契约形状和测试证据选择。

## 测试策略

- 从调用方语义开始：谁调用、前置状态是什么、执行什么动作、可观察结果是什么、失败后哪些状态必须不变。
- 优先测试承诺行为的真实边界。
- 单元测试通过公开 API 或模块 API 覆盖单一 owner 的本地语义。
- 集成测试覆盖跨 owner 行为、边界输入、状态协作、失败无副作用和错误映射。
- 冒烟测试只证明系统链路没有断裂，不证明深层领域语义。
- 快照测试只用于稳定文本、trace、AST、JSON
  或协议格式。状态机、权限、资源生命周期和事务语义需要语义断言。
- 如果重要行为只能通过窥探私有实现、复制内部映射或构造内部状态才能测试，应先检查公共边界和状态
  owner，而不是继续增加测试技巧。
- 时间、随机数、配置、权限或外部系统会影响决策时，应在拥有该副作用的边界提供可替换控制点；不要把替换机制扩散到不消费这些依赖的内部模块。

## 测试契约

- 每个测试都必须暴露 `Goal`、`Scope` 和 `Semantics`（GSS）；语言 skill拥有可编译
  carrier和机械验证投影。本规则没有“窄 parser case”“机械常量”或短测试豁免：如果无法
  写出非空洞 GSS，应删除该测试或重新定义其真实契约。
- `Goal` 命名被保护的行为。
- `Scope` 命名测试层级和 owner-visible 调用边界。层级语义：
  - `unit`：一个 type/function/validation owner的本地 API，不跨文件系统、进程、项目
    metadata或外部系统。
  - `module`：同一 module/subsystem 内多个行为的协作，不跨 crate target或 OS副作用
    边界。
  - `integration`：跨 module、crate target、项目 metadata、文件系统、进程或外部依赖。
  - `contract`：稳定 syntax、protocol、diagnostic code、serialized schema或 public API
    contract；即使 fixture跨边界，契约目的优先。
  - `smoke`：只证明 installed/executable end-to-end path连通。
  - 多种层级同时适用时按 `smoke > contract > integration > module > unit` 选择。
- `Semantics` 命名成功条件，以及失败后必须保持不变的状态。
- 表驱动测试可以在测试组共享一份 GSS，但每个 case必须有唯一语义标签。
- 同一 owner、调用边界和成功或失败不变量下，两个或更多仅输入与期望变化的用例必须
  使用语言生态的参数矩阵能力。不同 owner、副作用、共同状态、调用顺序或失败不变量必须
  保持独立测试。

## 夹具和用例

- fixture 只有在澄清准备步骤或减少重复领域构造时才使用。
- 避免隐藏状态 owner、权限边界或失败前置条件的 fixture。
- 优先使用明确用例标签，不复制实现 match table。
- 除非私有 helper 本身就是稳定边界，否则不要断言私有 helper 的机械行为。

## 黑队输入

- 相关时覆盖重复提交、乱序调用、错误权限、错误对象类型、跨 owner
  输入、部分失败和陈旧描述符。
- 失败路径测试必须证明状态不变，不能只断言错误 variant。
- 行为变化时，同步更新测试契约和 design
  facts，说明新语义、兼容取值、迁移风险和回滚路径；`compatibility: forbidden`
  时不得为了保留旧断言引入桥接实现。

## 工具和证据

- 使用项目 workflow route 或 installed adapter facts 声明的标准测试 runner。
- 引入新测试库或 runner 前，design facts
  必须先说明测试层级、依赖边界、验证命令和不覆盖的风险。
- 验证命令归项目 route 或语言/领域 skill；本 skill 只说明需要哪类测试证据和
  runner 约束输入。

## 审查

- Review scope 包含测试文件、测试证据或实现者用测试证明语义时，reviewer
  必须逐项检查本节，而不是只确认测试通过。
- 测试保护使用语义，而不是实现形状。
- 测试缺少 GSS，或 GSS 不能说明真实行为、边界和不变量，应作为 testing contract
  finding；checker通过不能替代该判断。
- 除非断言外部稳定格式或常量，否则测试应通过真实调用路径触发行为。
- 失败用例证明没有意外状态变化。
- 测试名、注释或用例标签能识别被保护的行为。
- fixture 和表驱动结构应提升清晰度，而不是隐藏 owner 或复制实现分支。
- 测试层级应匹配行为：单 owner 用单元测试，协作用集成测试，链路健康用冒烟测试。
- 语言 skill提供 inventory时，reviewer必须比较新增/删除测试、GSS、direct-call/oracle
  evidence、矩阵 cases和候选 groups；候选只能触发删除、拆分、合并或 planner handoff的
  人工判断，不能直接宣称测试无用。
