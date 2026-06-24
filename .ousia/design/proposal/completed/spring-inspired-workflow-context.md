# Spring-Inspired Workflow Context

本提案定义 Ousia Workflow 吸收 Spring 工程思想的元架构方案。目标不是引入 IoC 容器、Bean 命名或 AOP 运行机制，而是把 Ousia 已经存在的 context assembly、生命周期、条件加载、横切 concern 和诊断边界显式化。

## 目标

- 将 Ousia 的 installed manifest、prompt surface、design facts、validation routes、local overrides 和当前任务维度命名为可审查的 Workflow Context。
- 用 Ousia 自己的 lifecycle join point 描述 planning、implementation、review、validation、feedback ingestion 和 final report 的触发位置。
- 把 review、validation、documentation hygiene、testing semantics、subagent execution 和 feedback ingestion 这类横切 concern 映射到已有 owner，而不是复制到每个 skill。
- 将 lazy-load skills 理解为 Ousia 的条件激活机制，补强激活证据和可解释性。
- 从目标项目形态反推 instructions 和 skills：让项目形成 context 清楚、生命周期明确、横切 concern 有唯一 owner、扩展点窄而稳定、诊断可观察、测试能证明真实边界的工程结构。
- 为后续 installer diagnostics 和 lifecycle phase 暴露提供设计基础。

## 非目标

- 不新增通用 IoC container、Bean factory、XML 式配置层或运行时代理机制。
- 不把 Spring 术语直接写成 Ousia 硬规范。
- 不新增 plugin instruction 层、profile 层或 hidden autoconfig。
- 不把 shared assets 升级成规范源。
- 不在本提案内修改 installer 代码或实现完整 upgrade engine。

## 背景与约束

Ousia Workflow 已经稳定声明：Framework core 拥有结构、生命周期、验证和 agent reading protocol；项目只在 Ousia 定义的 slot 内填充事实。当前 prompt surface 也已经分出 instructions、entry skills、shared assets、`.ousia/design/**` 和 validation routes 的 owner。

Spring 可借鉴的深层思想是：框架拥有上下文装配和生命周期，应用通过声明式元数据提供事实；横切 concern 通过明确切入点组合；条件激活必须可解释、可覆盖、可测试。Ousia 已有这些思想的雏形，但表达分散在 repository policy、prompt architecture、facade skills、shared modes 和 design facts 中。

应继承的现有结构：

- Instructions 保存跨项目必须自动生效的硬规范和读取规则。
- Entry skills 保存可调用流程、输入维度、输出协议和 reviewer obligations。
- Shared assets 只保存入口 skill 复用的任务形状。
- Architecture、Proposal 和 Experience 是 design facts 的唯一原语。
- Lazy-load skills 是语言、框架、领域和测试工程能力的加载方式。

应停止模仿的模式：

- 用局部 workflow 规则重复定义同一横切 concern。
- 用自然语言流程隐含生命周期切入点。
- 把一次 Spring 类比扩展成新术语体系或新框架层。
- 让自动路由隐藏 owner、scope、证据边界或剩余风险。

## 候选方案

### 方案 A：只记录 Spring 启发到 Experience

将这次观察记录成 Experience evidence，不改 Architecture、Proposal 或 prompt surface。

优点：风险低，不会引入新抽象。

缺点：只能保存启发，不能指导后续 installer、skills 和 workflow 设计；也无法让 reviewer 攻击横切 concern 是否继续散落。

### 方案 B：直接把 Spring-like 概念写入 Architecture 和 instructions

把 Workflow Context、join point、condition 和 advice owner 直接写成稳定 architecture fact 或 hard rule。

优点：落地快，后续实现者能立即使用这些概念。

缺点：未经过 proposal review，容易把类比写成永久术语；也可能重复已有 owner，增加 prompt surface 负担。

### 方案 C：先建立 Ousia-native proposal，再审查并分阶段蒸馏

先在 Proposal 中定义 Workflow Context、lifecycle join points、cross-cutting concern owner 和第一纵向切片。Review 通过后，只把稳定结论回写 Architecture 或必要 prompt surface。

优点：保留 Spring 的工程精神，同时让 Ousia 的 owner、slot 和 review 闭环决定最终形状。

缺点：需要多一步 proposal review，短期不能直接修改执行规则。

## 推荐方案

采用方案 C。

理由：这是一个元架构调整，影响 prompt surface、design facts、installer diagnostics 和未来 skill activation。直接升级为硬规范风险过高；只记录 Experience 又无法形成可实施切片。Proposal 能让 reviewer 先攻击“是否只学其型”、owner 是否重复、自动路由是否隐藏决策。

## 推荐模型

### Workflow Context

Workflow Context 是一次 Ousia 工作中可被 agent 读取和组装的上下文集合：

| 组成                   | Owner                              | 作用                                                                     |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `.ousia/workflow.json` | Ousia Workflow                     | 声明 ownership、upgrade policy 和 validation baseline。                  |
| Prompt surface         | Ousia Workflow                     | 提供 instructions、entry skills、shared modes 和 validation skills。     |
| Architecture           | Ousia Workflow / installed adapter | 保存稳定结构、owner 和长期设计结论。                                     |
| Proposal               | Ousia Workflow / installed adapter | 保存当前方案、候选路径、实施切片和 review focus。                        |
| Experience             | Ousia Workflow / installed adapter | 保存证据、纠偏样本、review attacks 和复发风险。                          |
| Local overrides        | Project, temporary                 | 保存显式偏离、原因和退出条件。                                           |
| Task dimensions        | Current task                       | 保存 mode、target、subject、scope、focus、changed paths 和用户显式请求。 |

Workflow Context 不是新存储，也不是 runtime container。它只是给现有读取协议一个可审查的聚合名字：当任务归属、skill 选择、design fact 取证或 validation route 边界不清时，agent 应能用它判断 owner、scope、应读取证据和剩余风险。

### Lifecycle Join Points

Ousia 的 join point 是 workflow 语义切入点，不是运行时代码织入点。

| Join point                 | 触发语义                                                               | 典型 owner                                                   |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `onTaskClassified`         | 用户目标被识别为设计、实现、review、文档、测试或 prompt surface 任务。 | Development entry、architecture planner、owning skill。      |
| `beforePlanning`           | 非平凡设计或边界调整进入 proposal 前。                                 | Architecture planner。                                       |
| `beforeImplementation`     | Proposal review 通过、准备进入实施。                                   | Architecture planner handoff、implementation instructions。  |
| `afterImplementationDiff`  | 非平凡实现、workflow 或 prompt surface 改动完成后。                    | Black-team review。                                          |
| `beforeFinalReport`        | 最终汇报前需要确认验证和 review 状态。                                 | Repository policy。                                          |
| `onUserCorrection`         | 用户指出理念未对齐、workflow 漏执行或体系可能有问题。                  | Experience、prompt-surface、architecture planner。           |
| `onValidationRouteChanged` | validation route、checker、doc protocol 或 required checks 改动。      | Doc-validation、documentation standards、black-team review。 |

这些 join point 的用途是减少横切 concern 重复定义。它们不应变成新的大型状态机；现有 owner 仍决定具体行为。

### Cross-Cutting Concern Owners

| Concern               | Advice-like owner                        | 说明                                                                                |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Planning              | `architecture-planner`                   | 负责 proposal、候选方案、纵向切片和 implementation handoff。                        |
| Review                | `black-team-review`                      | 负责 proposal diff、implementation diff 和全局启发扫描。                            |
| Prompt ownership      | `prompt-surface`                         | 负责 instruction、skill、shared asset、design slot 和 validation route 的归属判断。 |
| Documentation hygiene | Documentation standards + doc-validation | 负责 Markdown 写作质量、链接协议和 checker。                                        |
| Testing semantics     | Testing evolution + `test-engineering`   | 负责测试语义底线、测试策略、测试证据和 runner 约束输入；验证命令归项目 route 或语言/领域 skill。 |
| Subagent execution    | Repository policy                        | 只约束执行载体和失败边界，不拥有 review 或 planning 输出。                          |
| Feedback ingestion    | Experience -> Proposal -> owning surface | 负责纠偏样本、提炼、review 和升级落点。                                             |
| Diagnostics           | Installer/API 或 validation route owner  | 负责结构化 phase、evidence、severity 和 remediation。                               |

### Conditional Activation

Ousia 的条件激活应基于窄而可解释的条件：

- 用户显式请求。
- 任务类型和目标，例如设计、实现、review、prompt surface、测试或文档。
- 文件 scope，例如 `.github/instructions/**`、`.github/skills/**`、`.ousia/design/**`、Rust source、测试树或 installer source。
- Installed facts，例如 `.ousia/workflow.json`、Architecture、Proposal 或 Experience evidence。
- 验证路线，例如 doc checker、TypeScript tests 或 smoke install。

条件激活不得隐藏决策。它不要求 agent 为每个已生效 instruction 解释加载理由；它只在任务入口或证据边界不清时帮助选择正确 skill、design fact 和 validation route。

## 第一实施切片

目标语义：Ousia 能用统一 proposal 描述 Spring-inspired Workflow Context，并为后续 diagnostics / lifecycle 实现提供审查过的 owner 和 join point。

跨越 owner：

- Proposal：新增本提案，定义候选方案、推荐模型、第一切片和 review focus。
- Proposal index：加入本提案入口。
- Black-team review：审查本提案是否可以进入后续 Architecture 蒸馏或 implementation。

完成条件：

- Workflow Context 被定义为现有上下文集合，而不是新 runtime container。
- Join points 被定义为 workflow 语义切入点，而不是运行时代理。
- Cross-cutting concern 都映射到已有 owner。
- Conditional activation 有触发条件和禁止隐藏魔法的约束。
- Review focus 明确攻击学其型、owner 重复、profile 膨胀和 hidden autoconfig。

排除范围：

- 不修改 active instructions 或 skills。
- 不修改 Architecture 稳定结论。
- 不修改 installer 代码。
- 不新增 checker 或 validation route。

## 后续实施候选

### 已完成：蒸馏 Architecture

Workflow Context、join point 词汇、cross-cutting concern owner、conditional activation 和 target project shape 的稳定部分已写入 `workflow-architecture.md`。

验证重点：Architecture 只保存稳定事实，不保存本提案的论证过程。

### 已完成：更新 prompt surface 读取规则

Prompt architecture 已加入最小读取规则：当任务归属、skill 选择、design fact 取证或 validation route 边界不清时，先用 `prompt-surface` 或 `architecture-planner` 明确 owner、scope、应读取证据和剩余风险；`.ousia/workflow.json` 和 `.ousia/design/**` 只作为项目事实和 evidence，不作为隐藏规则源。

验证重点：新增规则不能重复已有 owner；其他文件只路由，不复制 advice 细节。

### 已完成：installer lifecycle diagnostics

TypeScript installer 已为 `source -> plan -> blocked/dry-run/apply -> report` 暴露结构化 phase，并在 plan item 上暴露 diagnostic code、severity、path、message 和 remediation。

验证重点：CLI 渲染不成为唯一行为契约；planner/API 层应能断言 phase、code、severity、path 和 remediation。

## 测试与验证

- 文档协议：`deno task --cwd .github/skills/doc-validation check:docs`。
- `.ousia` diff hygiene：`git diff --check -- .ousia`。
- Prompt/workflow review：使用 `black-team-review`，`subject: 设计提案`，`mode: diff`。
- 若后续进入 installer 代码：`npm --prefix packages/ousia test`、`npm --prefix packages/ousia run build`，必要时运行 `npm run smoke:install`。

## 兼容性与回滚

本提案已落地到 Architecture、prompt surface 读取规则和 TypeScript installer API。兼容性边界如下：

- Architecture 只新增稳定事实，不改变 active execution policy。
- Prompt surface 只新增 Workflow Context 的最小路由规则，不新增 plugin instruction 层、profile 层或 validation route。
- Installer 保留既有 install/plan 行为和 CLI 输出形状；新增 `InstallResult.phases` 与 `PlanItem.diagnostic` 作为结构化诊断 API，并让既有 `reason` 字段从 diagnostic message 派生。

回滚时应按落点分别处理：撤销 prompt surface 路由规则、移除 Architecture 中的 Workflow Context 事实、移除 installer diagnostics API 和对应测试，最后再将本 proposal 从已完成索引中移除。只删除 proposal 入口不足以回滚已经落地的 active surface 或 API 改动。

## Review Focus

- 是否把 Spring 术语当成 Ousia 硬规范，而不是只提炼工程思想。
- Workflow Context 是否只是为现有上下文命名，还是偷偷引入了新容器层。
- Join points 是否帮助减少横切规则重复，还是制造了第二套流程状态机。
- Cross-cutting concern 是否都映射到唯一 owner，没有重复定义。
- Conditional activation 是否可解释、可覆盖、可 review，没有 hidden autoconfig。
- 是否重新引入已被拒绝的 plugin instruction 层、profile 层或 shared asset 规范源。
- 第一实施切片是否足够小，且没有越过 proposal 直接改 active rules。
