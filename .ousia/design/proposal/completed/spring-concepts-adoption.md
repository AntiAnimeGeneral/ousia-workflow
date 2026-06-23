# Spring Concepts Adoption

本提案枚举 Spring Framework、Spring Boot 和 AOP 中对 Ousia Workflow 有参考价值的概念，并判断是否吸纳、如何吸纳、落到哪个 owner。目标是借用业界已有术语和工程经验，而不是为 Ousia 发明一套难理解的新黑话。

状态：已完成。稳定结论已回写到 [workflow-architecture.md](../../architecture/workflow-architecture.md)，执行 gate 已落到 `prompt-surface`、`ousia-development-entry` 和 `black-team-review`。

## 目标

- 用 Spring/AOP 已有术语描述可迁移思想，降低人类和 AI 的理解成本。
- 保留经过社区验证、深入人心的术语，但为每个术语声明 Ousia 对应 owner、触发条件和禁止误读，防止语义漂移。
- 把 Ousia 的设计落实到使用场景：每次 workflow 或 prompt surface 修改都要说明它会怎样影响真实项目中的设计、实现、review 和验证。
- 让 Ousia Workflow 能指挥 agent 在 Rust/Axum 等非 Spring 技术栈中产出具备 Spring 式工程感的系统，而不是散乱实现。
- 判断每个概念是否适合 Ousia Workflow。
- 对适合吸纳的概念，说明对应的 Ousia owner、触发条件、验证方式和禁止误读。
- 对不适合吸纳的概念，说明为什么不进入 Ousia core。

## 非目标

- 不复制 Spring runtime container、annotation scanning、dynamic proxy 或 autoconfiguration 机制。
- 不新增 profile 层、plugin instruction 层或第二套配置中心。
- 不把每个 Spring 概念都硬映射成 Ousia 功能。
- 不把成熟术语替换成 Ousia 自造术语。

## 背景

Spring 的核心价值不是某个 Java API，而是长期沉淀出的工程组织方式：控制反转、上下文、生命周期、横切关注点、事务边界、配置优先级、生产可观测性和测试支持。Ousia Workflow 面向 agent workflow，不是 Java 应用框架，所以只能吸收这些概念背后的 owner、边界、触发条件和验证思想。

采用这些思想的判断标准必须来自使用场景：如果一条 Ousia 规则不能改善目标项目中 handler、service、state、side effect、config、diagnostics 或 tests 的组织方式，它就只是 prompt surface 的自我整理。好的 workflow 改动应能让 agent 在具体项目里更容易识别上下文、建立 owner、选择边界、前置失败检查、暴露诊断并写出穿过真实路径的测试。

本轮覆盖 Spring Framework、Spring Boot 和 AOP 中与 Ousia Workflow 直接相关的概念。Spring Cloud、Spring Batch、Spring Integration、Spring Security 等项目只在未来出现分布式配置、批处理 workflow、外部系统 adapter 或安全模型等真实变化轴时再单独评估。

## 概念枚举与吸纳判断

| Spring / AOP 概念                           | 价值                                             | Ousia 是否吸纳         | Ousia 对应 owner / 形态                                                                                                | 禁止误读                                               |
| ------------------------------------------- | ------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| IoC / 控制反转                              | 调用方不手写装配细节，交给稳定容器或框架 owner。 | 已吸纳                 | 任务入口由 instructions、entry skills、`.ousia/workflow.json` 和 design facts 路由。                                   | 不引入运行时容器或隐藏执行流。                         |
| Dependency Injection / 依赖注入             | 依赖从外部提供，降低耦合并提升测试性。           | 部分吸纳               | Agent 通过 Workflow Context 读取已声明 evidence，而不是在局部规则中硬编码事实。                                        | 不做对象注入或服务定位器。                             |
| Bean / Component                            | 框架管理的可组合单元。                           | 谨慎吸纳               | Instruction、entry skill、shared mode、checker、design fact 都是有 owner 的 prompt surface 单元。                      | 不把所有文件都称为组件，也不新增 Ousia bean 概念。     |
| ApplicationContext                          | 聚合配置、bean、资源和环境。                     | 已吸纳                 | Workflow Context 聚合 prompt surface、installed facts、validation routes 和 task dimensions。                          | 不是新存储、runtime container 或第二套配置中心。       |
| Bean lifecycle / 生命周期回调               | 在稳定阶段初始化、校验、销毁或触发副作用。       | 已吸纳                 | Lifecycle Join Points 命名 planning、implementation、review、validation、report 等阶段。                               | 不自动执行 hook；行为仍归 owning skill/instruction。   |
| Events / 事件                               | 解耦事件发布方和监听方。                         | 暂不吸纳为机制         | 用户纠偏、validation route 变化等只作为明确 task trigger 和 Experience evidence。                                      | 不新增事件总线或监听器层。                             |
| Resources                                   | 统一访问 classpath、file、URL 等资源。           | 部分吸纳               | `.ousia/workflow.json` 和 design indexes 提供 evidence route。                                                         | 不引入通用资源抽象层。                                 |
| Environment / Profiles                      | 根据环境和 profile 选择配置。                    | 只吸纳显式覆盖思想     | Local override 必须写原因、范围和退出条件；validation route 可声明环境约束。                                           | 不新增 hidden profile、autoconfig 或按环境静默改行为。 |
| Externalized Configuration                  | 配置外置并有优先级。                             | 部分吸纳               | `.ousia/workflow.json` 声明 ownership、upgrade policy 和 validation baseline；project facts 填入 Ousia-defined slots。 | 不让项目自由 overlay Ousia skeleton。                  |
| Configuration Properties / 类型化配置       | 配置有结构、校验和默认值。                       | 可后续吸纳             | installer/manifest 可对 workflow config 做 schema、diagnostic 和 remediation。                                         | 不用松散 Markdown 文本替代 schema。                    |
| Conditional configuration                   | 根据 classpath/property/bean 条件启用配置。      | 谨慎吸纳               | 条件激活只基于用户请求、任务类型、scope、installed facts 和 validation route。                                         | 不用模型猜测、隐藏 profile 或自动扫描扩大范围。        |
| Auto-configuration                          | 基于约定自动装配常见能力。                       | 不直接吸纳             | Ousia 可提供默认 route 和 installer baseline。                                                                         | 不做隐藏 autoconfig；默认必须可审查、可覆盖、可诊断。  |
| Starters                                    | 打包一组常用依赖和配置。                         | 可后续吸纳             | 未来 installer 可提供 workflow bundle 或 adapter preset。                                                              | 不让 starter 混入项目事实或静默改变 owner。            |
| AOP Aspect                                  | 管理横切关注点。                                 | 已吸纳                 | Cross-Cutting Concern Owners：review、planning、prompt ownership、testing、docs、diagnostics。                         | Aspect 是 owner，不是万能总管或散乱规则层。            |
| AOP Pointcut                                | 定义触发位置。                                   | 已吸纳                 | 文件 scope、任务类型、用户显式请求、validation route 变化、Lifecycle Join Points。                                     | Pointcut 必须显式，不靠隐藏扫描或模型猜测。            |
| AOP Advice                                  | 在触发点执行的动作。                             | 已吸纳                 | Owning instruction、entry skill、checker 或 review route 的具体动作。                                                  | Advice 必须可追溯到 owner、输入、输出和退出条件。      |
| AOP Weaving                                 | 将 advice 应用到 pointcut。                      | 已吸纳为显式编排       | Agent 显式读取 owner，并在报告中暴露验证和 review 结果。                                                               | 不做运行时织入、代理或隐式注入。                       |
| Transaction management                      | 把一组操作放在同一成功/失败边界内。              | 需要吸纳               | Installer、upgrade、prompt rewrite 应有 preflight、apply、rollback/residual risk 边界。                                | 不只在最终报告里说失败；失败前置检查要先于副作用。     |
| Data access abstraction                     | 隔离底层存储差异。                               | 暂不吸纳为 core        | 当前 Ousia 没有多存储后端；只保留 design facts 和 filesystem owner。                                                   | 不提前造 repository/DAO 层。                           |
| Validation / Data Binding / Type Conversion | 输入归一化、校验和错误映射。                     | 已部分吸纳             | doc checker、installer manifest、workflow config 应集中校验和诊断。                                                    | 不在多个层重复默认值、错误映射或归一化。               |
| SpEL / Expression Language                  | 在配置中表达动态条件。                           | 不吸纳                 | Ousia 条件必须窄且可解释。                                                                                             | 不引入表达式语言或动态规则脚本。                       |
| MVC / WebFlux                               | 面向 HTTP 的同步/响应式 web 模型。               | 不吸纳                 | Ousia 不是 web framework。                                                                                             | 不把 agent workflow 包装成 controller/router 层。      |
| Scheduling / Task Execution                 | 管理后台任务和异步执行。                         | 暂不吸纳               | 当前 workflow 是显式任务，不是常驻 runtime。                                                                           | 不新增 daemon、watcher 或后台调度。                    |
| Integration / Messaging                     | 与外部系统通过消息解耦。                         | 暂不吸纳               | 后续如接入外部 issue/PR/CI，可按 adapter proposal 设计。                                                               | 不提前引入 message bus。                               |
| Testing support                             | 让框架边界可测试，提供测试上下文。               | 已吸纳                 | `test-engineering`、testing-evolution、installer tests、doc-validation tests。                                         | 测试不复述实现，也不只跑 smoke。                       |
| Actuator / production-ready features        | 健康检查、metrics、info、管理端点。              | 需要吸纳为 diagnostics | Installer/API/checker/review 输出结构化 phase、severity、code、evidence、remediation。                                 | 不把 CLI 文本当唯一契约。                              |
| Observability                               | metrics、tracing、logs 和诊断上下文。            | 已部分吸纳             | workflow diagnostics、review findings、validation result 和 Experience evidence。                                      | 不把日志/总结当作架构事实。                            |
| Dependency management                       | 统一依赖版本和兼容边界。                         | 可后续吸纳             | Workflow release/installer 可声明 core version、adapter version、compat matrix。                                       | 不让目标项目隐式漂移 core surface。                    |
| Opinionated defaults                        | 框架提供合理默认。                               | 已部分吸纳             | 默认 instructions、entry skills、validation route 和 installed skeleton。                                              | 默认必须可解释、可覆盖、可诊断。                       |
| Devtools / fast feedback                    | 缩短开发反馈回路。                               | 可后续吸纳             | watcher/check-only commands、doc checker、smoke install 和 review loops。                                              | 不引入长期后台流程作为默认要求。                       |
| Security                                    | 认证授权和安全边界。                             | 暂不吸纳为通用 core    | 当前无安全模型；可在未来 adapter/domain skill 中处理。                                                                 | 不把权限术语写进无消费者的 workflow core。             |
| Internationalization                        | 文案国际化。                                     | 不吸纳                 | Ousia first-party docs 当前默认中文，稳定外部术语可保留英文。                                                          | 不引入 i18n 体系。                                     |

## 推荐吸纳优先级

### 第一优先级：直接服务当前 Ousia Workflow

- Transaction management：用于 installer、upgrade、prompt rewrite 的 preflight/apply/rollback/residual risk 边界。
- Actuator / Observability：用于 installer/API/checker/review 的结构化 diagnostics。
- Configuration Properties：用于 `.ousia/workflow.json`、manifest 和 validation route 的 schema 与 diagnostic。
- Conditional configuration：继续收紧为显式条件激活，避免 hidden profile/autoconfig。
- Testing support：让每条 workflow 能通过真实 owner、边界输入、状态提交点和可观察结果验证。

### 第二优先级：作为架构语言保留

- IoC、ApplicationContext、Lifecycle、AOP Aspect/Pointcut/Advice/Weaving。
- Convention over configuration、Externalized Configuration、Extension points。

这些概念已经在 Architecture 中有稳定对应，后续只需保持术语清楚，不再新造 Ousia 黑话。

### 暂不吸纳

- SpEL、MVC/WebFlux、Messaging、Scheduling、Security、Internationalization、Data access abstraction。

这些概念要么属于 Java/web/runtime 应用框架，要么当前没有真实变化轴。没有消费者前不进入 Ousia core。

## 第一个可实施切片

目标语义：清理 prompt surface 中容易误导的 shared mode/output 术语，并为下一阶段 installer/upgrade diagnostics 设计提供 Spring 概念映射依据。

实施范围：

- `_shared/modes/planning/**` 将 `Output Focus` 改为 `Mode Focus`，避免 shared asset 被误读成输出协议 owner。
- 删除空的 proposal 子目录，保持 proposal root 只有真实 proposal 文件和 completed 归档目录。
- 将本文加入 proposal index，作为后续吸纳 Spring 概念的当前方案。
- 精简 `ext-ousia-workflow`、`ousia-design-task` 和 `prompt-surface` 中重复 owner 说明，验证“少写一点是否更清楚”。
- 在 `prompt-surface` 和 Architecture 中加入使用场景与目标项目影响要求，确保后续改动说明它怎样改善真实开发行为。

排除范围：

- 不在本切片实现 installer transaction/rollback。
- 不新增 autoconfig/profile/starter 机制。
- 不重写 architecture 中已经稳定的 Spring/AOP 对应表。
- 不在本切片重构 `architecture-planner` 或 `black-team-review`；它们是输出协议 owner，后续需单独 review 后再压缩。

## 第二个可实施切片

目标语义：把使用场景和目标项目工程形态要求从 prompt/workflow 改动扩展到普通代码实现，让 Ousia Workflow 不只整理自身 surface，也能约束 agent 在真实项目中写出有 owner、边界、诊断和测试支持的实现。

实施范围：

- `ousia-development-entry` 要求非平凡实现前说明目标使用场景和工程形态影响。
- `black-team-review` 在 implementation review 中攻击只让代码更整齐、却不能证明改善真实工程组织的 diff。

排除范围：

- 不新增语言或框架专用规则；Rust/Axum 仍只是目标项目形态例子。
- 不重构 `architecture-planner` 或 `black-team-review` 的输出协议。
- 不新增 checker；该要求主要由实现前说明和 review 判断执行。

Review focus：

- 是否把目标项目影响落实到开发入口和 review，而不是继续只写理念。
- 是否和现有纵向切片、状态所有权、边界和测试语义规则重复或冲突。
- 是否把“有工程感”写成空泛口号，而没有落到 handler/controller、业务编排、状态、配置、副作用、诊断或测试组织。

## 后续精简切片

以下事项不是本提案完成条件；它们需要作为独立提案或独立实施切片进入 review。

- `architecture-planner`：压缩和 base instructions 重复的规划原则、target 特化和 proposal packet 字段，保留外部接口、组合资产、工作流程、输出契约和 handoff。
- `black-team-review`：合并外部接口、证据要求和 review prompt 中重复的输入说明，但保留 finding 输出、subject 攻击焦点和 handoff packet。
- 执行前必须使用 `black-team-review` 审查提案 diff，避免把 planner/reviewer 的质量约束误删。

## 完成结果

- Spring Framework、Spring Boot 和 AOP 的可迁移概念已枚举，并按 Ousia owner、触发条件和禁止误读分类。
- Architecture 已记录 Ousia 对 IoC、Workflow Context、生命周期、AOP 横切 concern、条件激活、目标项目形态和反馈吸纳的稳定采用方式。
- Prompt/workflow 改动必须说明目标使用场景、真实项目行为影响和受影响 owner。
- 普通非平凡代码实现也必须说明目标使用场景和工程形态影响，implementation review 会攻击只让代码更整齐但不能证明改善真实工程组织的 diff。
- 未采用的 Spring runtime/web/security/messaging 等概念保留为非目标或后续真实变化轴，不进入 Ousia core。

## Review Focus

- 概念清单是否偷换 Spring 术语或遗漏主要概念。
- 是否把不适合 Ousia 的 runtime/web/security/messaging 概念强行吸纳。
- 是否把 shared assets 变成输出协议 owner。
- 是否说明目标使用场景和真实项目影响，而不是只说明 prompt surface 自身更整齐。
- 是否新增 hidden autoconfig、profile 或第二套配置中心。
- 是否把 proposal 写成长期 Architecture 事实。

## 验证

- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md`
