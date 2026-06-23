# Workflow Architecture

## 结构摘要

| Component         | Owner              | Role                                                                                     |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Framework core    | Ousia Workflow     | Base instructions、facade skills、shared modes、validation contracts 和 upgrade policy。 |
| Adapter instance  | Project            | 已安装的 `.ousia/**` surface，保存项目事实和设计结论。                                   |
| Design primitive  | Ousia Workflow     | `.ousia/design/**` 的 architecture、proposal、experience 三个 owner。                    |
| Prompt surface    | Ousia Workflow     | Instructions 提供读取边界；skills 提供任务工作流和审查义务。                             |
| Lazy-load skill   | Ousia Workflow     | 按任务意图加载的工程能力。                                                               |
| Feedback evidence | Ousia Workflow     | 用户纠偏、语义偏移和 workflow 失效样本的归档、提炼和升级闭环。                           |
| Local override    | Project, temporary | 带原因和退出条件的显式偏离。                                                             |

## 稳定结论

- Ousia Workflow 是一个可安装、可升级的 agent workflow 框架。
- Ousia Workflow 拥有结构、生命周期、验证和 agent reading protocol。
- 项目在 Ousia 定义的 slot 内拥有事实。
- `.ousia/**` 是当前项目安装出来的 adapter instance，不再包含独立 source 层。
- Design facts 只通过 Architecture、Proposal 和 Experience 三个原语归档。
- Prompt surface 的抽象边界由 instruction 索引；修改、写作和 review 流程由 owning skill 承载。
- Instructions 只保存跨任务硬底线、读取路由和 checker-owned 协议；任务流程、输入维度、输出协议、handoff 和 reviewer obligation 归 entry skills。
- Shared assets 只保存被入口 skill 复用的 mode/task shape，不保存规范正文、项目事实、输出协议或 review checklist。
- Documentation standards 仍拥有 Markdown 写作质量、文档归档语义和 Ousia 文档协议；`doc-validation` 只拥有验证命令、checker 路线和 checker 改动验证矩阵。
- 语言、框架、领域和测试工程能力属于 lazy-load skills，不进入 base always-on instructions，也不需要 plugin instruction 层。
- 测试语义底线仍保持 always-on：测试必须保护真实行为，覆盖失败无副作用，并避免复述实现细节。
- 用户明确要求 subagent review、planning 或 exploration 时，workflow 必须尝试启动对应 subagent；subagent 仍只是执行载体。
- Workflow Context 是一次 Ousia 工作中可被 agent 读取和组装的上下文集合；它不是新存储、runtime container 或第二套配置中心。

## Workflow Context

Workflow Context 聚合一次 Ousia 工作所需的已安装事实、prompt surface、验证路线和任务维度。它只命名现有读取协议，帮助 agent 和 reviewer 在任务归属、skill 选择、design fact 取证或 validation route 边界不清时判断 owner、scope、应读取证据和剩余风险。

| 组成                   | Owner                              | 作用                                                                     |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `.ousia/workflow.json` | Ousia Workflow                     | 声明 ownership、upgrade policy 和 validation baseline。                  |
| Prompt surface         | Ousia Workflow                     | 提供 instructions、entry skills、shared modes 和 validation skills。     |
| Architecture           | Ousia Workflow / installed adapter | 保存稳定结构、owner 和长期设计结论。                                     |
| Proposal               | Ousia Workflow / installed adapter | 保存当前方案、候选路径、实施切片和 review focus。                        |
| Experience             | Ousia Workflow / installed adapter | 保存证据、纠偏样本、review attacks 和复发风险。                          |
| Local overrides        | Project, temporary                 | 保存显式偏离、原因和退出条件。                                           |
| Task dimensions        | Current task                       | 保存 mode、target、subject、scope、focus、changed paths 和用户显式请求。 |

## Spring Concepts Used By Ousia

Ousia 借鉴 Spring 中已经广泛理解的工程概念，但不复制 Spring 的注解、运行时容器或自动装配机制。这里保留常见 Spring 术语，方便人类和 AI 用已有知识理解 Ousia 的设计取舍；同时每个术语都必须绑定到 Ousia 的现有 owner 和边界，避免借用术语后发生语义漂移。

| Spring 术语                              | Ousia 对应                                                                                                 | 不要误解为                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Inversion of Control / 控制反转          | 任务入口由 workflow route、entry skill 和 design facts 决定，而不是由 agent 临场拼规则。                   | 新的运行时容器、隐藏执行流程或 agent 个人偏好。                    |
| ApplicationContext / 应用上下文          | Workflow Context 聚合 prompt surface、installed facts、validation route 和任务维度。                       | 新存储、runtime container 或第二套配置中心。                       |
| Lifecycle / 生命周期                     | Lifecycle Join Points 命名 planning、implementation、review、validation 等阶段。                           | 自动执行 hook；join point 只定位语义阶段，具体行为仍归已有 owner。 |
| Cross-cutting concerns / 横切关注点      | Cross-Cutting Concern Owners 统一 planning、review、prompt ownership、testing、docs 和 diagnostics。       | 把同一规则复制到每个 instruction、skill 或 shared asset。          |
| Convention over configuration / 约定优先 | Instructions、entry skills 和 `.ousia/workflow.json` 提供默认 route；local override 必须写原因和退出条件。 | 静默覆盖 ownership、validation 或 upgrade 边界。                   |
| Observability / 可观测性                 | Installer/API、checker 和 review 输出结构化 phase、code、severity、evidence 和 remediation。               | 只依赖 CLI 文本或最终总结。                                        |
| Extension points / 扩展点                | 新 skill、shared mode、checker 或 design slot 只在真实变化轴存在时增加。                                   | 为了框架感提前增加层级、接口或分类。                               |

这些概念的目标是让 Ousia 项目形成可组合但不过度抽象的工作流：默认路径清楚，例外显式，owner 唯一，诊断可读，测试能证明真实边界。任何借鉴 Spring 的改动都必须改善这些结果；只增加层级、名称或自动路由不算真正借鉴。

## AOP Concepts Used By Ousia

Ousia 借鉴 AOP 的价值：把散落在各任务中的横切关注点放到唯一 owner，并在明确触发条件下执行。Ousia 不采用运行时织入、隐式 advice、注解扫描、隐藏代理、profile 层或 autoconfig 层；所有触发条件、证据读取、输出和失败边界都必须可见、可审查、可验证。

| AOP 术语 | Ousia 对应                                                                                                           | 不要误解为                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Aspect   | 横切关注点的 owner，例如 review、planning、prompt ownership、testing semantics、documentation hygiene、diagnostics。 | 新的规则层、散落规则集合或万能总管。                                        |
| Pointcut | 明确的触发条件，例如文件 scope、任务类型、用户显式请求、validation route 变化或 lifecycle join point。               | 隐藏 profile、自动扫描或模型猜测扩大适用范围。                              |
| Advice   | 由 owning instruction、entry skill、checker 或 review route 执行的具体动作。                                         | 匿名规则；advice 必须能追溯到 owner、输入、输出、退出条件和验证方式。       |
| Weaving  | Agent 在任务执行中显式读取对应 owner，并在报告中暴露验证和 review 结果。                                             | 运行时注入、隐藏代理或绕过用户目标、local override、review 闭环的自动行为。 |

例子：实现完成后的 review 由 `afterImplementationDiff` 触发，owner 是 `black-team-review`，输入和输出由该 skill 声明，主 agent 或 subagent 按真实 diff 执行。若某个横切关注点无法说清 owner、触发条件、具体动作和验证方式，它不能进入 Ousia workflow。

## Lifecycle Join Points

Lifecycle join points 是 Ousia workflow 的语义切入点，不是运行时代码织入点。它们用于定位横切 concern 的触发位置，并保持具体行为归属于已有 owner。

| Join point                 | 触发语义                                                               | 典型 owner                                                   |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `onTaskClassified`         | 用户目标被识别为设计、实现、review、文档、测试或 prompt surface 任务。 | Development entry、architecture planner、owning skill。      |
| `beforePlanning`           | 非平凡设计或边界调整进入 proposal 前。                                 | Architecture planner。                                       |
| `beforeImplementation`     | Proposal review 通过、准备进入实施。                                   | Architecture planner handoff、implementation instructions。  |
| `afterImplementationDiff`  | 非平凡实现、workflow 或 prompt surface 改动完成后。                    | Black-team review。                                          |
| `beforeFinalReport`        | 最终汇报前需要确认验证和 review 状态。                                 | Repository policy。                                          |
| `onUserCorrection`         | 用户指出理念未对齐、workflow 漏执行或体系可能有问题。                  | Experience、prompt-surface、architecture planner。           |
| `onValidationRouteChanged` | Validation route、checker、doc protocol 或 required checks 改动。      | Doc-validation、documentation standards、black-team review。 |

## Cross-Cutting Concern Owners

横切 concern 通过稳定 owner 协作，不复制到每个 skill 或 shared asset。新增或修改横切规则时，应优先改写 owning surface 或路由到 owning surface，而不是创建平行规则。

| Concern               | Owner                                    | 说明                                                                                |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Planning              | `architecture-planner`                   | 负责 proposal、候选方案、纵向切片和 implementation handoff。                        |
| Review                | `black-team-review`                      | 负责 proposal diff、implementation diff 和全局启发扫描。                            |
| Prompt ownership      | `prompt-surface`                         | 负责 instruction、skill、shared asset、design slot 和 validation route 的归属判断。 |
| Documentation hygiene | Documentation standards + doc-validation | 负责 Markdown 写作质量、链接协议和 checker。                                        |
| Testing semantics     | Testing evolution + `test-engineering`   | 负责测试语义底线、测试策略和验证命令选择。                                          |
| Subagent execution    | Repository policy                        | 只约束执行载体和失败边界，不拥有 review 或 planning 输出。                          |
| Feedback ingestion    | Experience -> Proposal -> owning surface | 负责纠偏样本、提炼、review 和升级落点。                                             |
| Diagnostics           | Installer/API 或 validation route owner  | 负责结构化 phase、evidence、severity 和 remediation。                               |

## Conditional Activation

Ousia 的条件激活基于窄而可解释的条件：用户显式请求、任务类型和目标、文件 scope、installed facts、Experience evidence 和验证路线。Lazy-load skills 是当前条件激活机制；instructions 仍按其安装和适用范围生效，不需要新增 plugin instruction 层、profile 层或 hidden autoconfig。

条件激活不是要求 agent 为每个已生效 instruction 解释加载理由，而是在任务入口或证据边界不清时帮助选择正确 skill、design fact 和 validation route。自动路由只能帮助 agent 找到 owner，不能隐藏决策或绕过 review。

## Target Project Shape

Ousia 的 instructions 和 skills 应落实到目标项目的真实使用中。每次修改 workflow、instruction、skill、shared asset 或 design fact 时，都要说明它会怎样改变 agent 在设计、实现、review 或验证中的行为，以及这些改变对现有 owner、边界、测试和诊断有什么影响。

Ousia Workflow 的长期目标不是只维护自身 prompt surface，而是让 agent 在不同技术栈里都能产出有工程感的系统：例如写 Rust/Axum 项目时，也应形成类似 Spring 优良实践中的上下文边界、生命周期、横切 concern、配置落点、诊断和测试支持，而不是把 handler、状态、副作用和校验散落在临场实现里。

Ousia 的 instructions 和 skills 应能稳定帮助项目形成以下工程形态：上下文边界清楚，生命周期阶段可命名，横切 concern 有唯一 owner，扩展点窄而可审查，配置和项目事实有声明式落点，诊断能被机器和 reviewer 读取，测试能覆盖真实边界和失败无副作用。

这意味着 prompt surface 的职责不是把 Spring 概念逐字投射到项目中，而是持续要求实现者回答这些问题：

- 当前任务的 context、owner、scope 和 evidence 在哪里。
- 这个能力属于核心策略、项目事实、横切 concern、扩展点、validation route 还是局部实现。
- 生命周期中哪个阶段建立不变量、执行副作用、触发 review 或暴露 diagnostics。
- 横切 concern 是否已有 owning skill、instruction 或 design primitive；若已有，不新增平行规则。
- 扩展点是否对应真实变化轴；说不清允许哪类变化独立演进时，不新增扩展点。
- 测试是否穿过真实边界证明用户语义、失败无副作用和可观察诊断。

目标项目不需要显式使用 Spring vocabulary。只要项目具备上述工程形态，Ousia 就吸收了 Spring 的可迁移思想；如果只新增术语、层级或自动路由而不能改善这些结果，应视为学其型而非学其神。

## Feedback Ingestion

用户纠偏是 Ousia Workflow 的自我迭代输入，不是对话噪音。它的稳定目标是让 workflow 能吸纳“agent 没有理解理念、没有按流程行动、反复补废话或把一次判断过度提炼成规则”的样本，并把这些样本路由到正确 owner。

反馈吸纳的 owner 是 Ousia Workflow。项目可以在 `.ousia/design/experience/**` 记录当前实例中的错位样本；框架根据样本是否可复发、是否跨任务、是否需要机械阻断，再决定提升到 instruction、skill、shared asset、architecture fact 或 checker。

反馈吸纳路径：

| 阶段        | 输出                                                                                         | Owner             |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------- |
| 纠偏识别    | 未对齐点、错误形态、用户目标和被偏移的语义。                                                 | Experience        |
| 原因分析    | 执行失误、workflow 缺口、prompt 歧义、tool schema 诱导或 review 缺失。                       | Experience        |
| 提炼判断    | 是否需要升级为 hard rule、entry workflow、review obligation、mode shape 或 validation rule。 | Proposal          |
| 实施落点    | 更新 instruction、owning skill、shared mode、checker 或安装实例文档。                        | 对应 owner        |
| Review 攻击 | 检查是否过度泛化、是否把一次判断写成永久规则、是否把可选字段伪装成必填字段。                 | Black-team review |

升级边界：

- 单次错位和具体踩坑先进入 Experience。
- 多次复发、跨任务有效、影响所有实现者的规则才能进入 instructions。
- 任务流程、输入维度、输出协议和 reviewer obligation 进入 owning skill。
- 复用任务形状进入 shared assets。
- 只有可机械判断、复发成本高、误报边界清楚的问题才进入 checker。
- Architecture 记录稳定设计理念和 owner 关系，不记录即时道歉、过程流水或尚未验证的解决方案。
