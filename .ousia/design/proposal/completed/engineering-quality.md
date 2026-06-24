# Engineering Quality Research

本提案定义 Ousia 如何研究成熟框架和工程系统，并把研究结果转化为项目里的好代码、好架构和好设计。目标不是继续整理 Ousia 自己的 prompt surface，而是让没有工程审美的人或 Agent 也能在真实项目中形成清晰边界、状态 owner、生命周期、配置、诊断、测试和文档。

状态：三个切片均已完成；稳定执行面已提炼到 `engineering-quality` skill。后续只在真实项目复发时提炼 checker 或新增技术栈 examples。

## 目标

- 建立一条 reference research -> engineering judgment -> engineering quality gates -> review attacks -> scenario validation 的路径。
- 从 Spring、Rails、Django、Erlang/OTP、Kubernetes、Nix、LLVM、Unix、Rust/Cargo 等成熟系统中抽取可迁移工程判断。
- 把“好工程”改写为可填写、可证明、可 review 的证据要求，而不是依赖实现者主观品味。
- 用真实项目场景验证 Ousia 是否能把容易写坏的任务拉回到清晰边界。

## 非目标

- 不把任何参考框架的目录、注解、命名、运行时机制或具体技术栈约定直接变成 Ousia baseline。
- 不要求项目采用 Ousia 的命名、目录或 policy surface 形态。
- 不在本切片修改 installer、增加 checker 或新增常驻运行机制。
- 不把研究结果写成口号；没有场景和 review 证据的结论不进入稳定 Architecture。

## 研究问题

每个参考框架或工程系统都必须回答这些问题：

- 它解决了哪类项目失控。
- 它让普通开发者或 Agent 少做哪些错误决定。
- 它通过什么机制把好设计变成默认路径。
- 它的适用边界和反面风险是什么。
- 它如何帮助项目形成好代码和好设计，而不是只让 Ousia 自己的 prompt surface 更整齐。

## Reference Taxonomy

| 工程成果             | 参考系统                                              | 要抽取的判断                                 | 项目落点                                                          |
| -------------------- | ----------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| 项目结构和约定       | Rails、Django、Cargo                                  | 哪些结构应成为默认路径，哪些只应作为示例。   | 目录边界、模块职责、接手路径。                                    |
| 生命周期和状态 owner | Spring、OTP、Kubernetes                               | 谁建立不变量，谁提交状态，谁恢复失败。       | handler/service/domain/repository、状态机、任务生命周期。         |
| 横切关注点           | Spring AOP、Django middleware、Kubernetes controllers | 横切 concern 应有唯一 owner 和显式触发条件。 | auth、logging、metrics、validation、review、docs。                |
| 配置和环境           | Spring Boot、Nix、Kubernetes                          | 配置应声明式、有优先级、有诊断和回滚边界。   | config owner、env policy、validation route、local override。      |
| 错误与恢复           | OTP、Rust、Kubernetes                                 | 失败属于边界设计，不是事后兜底。             | recoverable error、panic/invariant、rollback、status。            |
| 诊断和可观测性       | Spring Actuator、Kubernetes status、Unix tools        | 输出应服务定位和自动检查。                   | structured diagnostics、logs、metrics、review evidence。          |
| 测试和迁移           | Django、Rails、Cargo、Nix                             | 测试应保护语义和迁移路径。                   | test contract、fixtures、migration/rollback、failure invariants。 |
| 扩展点               | Kubernetes CRD、LLVM pass、Spring extension points    | 扩展点必须对应真实变化轴。                   | plugin/adapter boundaries、shared modes、project facts。          |
| 开发者体验           | Rails、Cargo、Django admin                            | 好路径要比坏路径更省力。                     | generator/init docs、README、default checks、scaffold。           |
| 可复现和回滚         | Nix、Cargo lock、Kubernetes desired state             | 输入、输出、版本和回滚应可说明。             | install/upgrade plan、validation baseline、release artifacts。    |

## 候选方案与取舍

| 方案                      | 做法                                                                                                                             | 优点                                                                             | 风险                                                                                         | 结论                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 直接修改 planner/reviewer | 立刻把 engineering quality fields 写进 `architecture-planner` 和 `black-team-review`。                                           | 见效快，下一次实现就会被 gate。                                                  | 没有先定义稳定 evidence，容易把一次用户纠偏升级成永久规则，也容易和现有 skill 输出协议重复。 | 延后到第二切片。                            |
| 新增机械 checker          | 用脚本检查是否填写 evidence、是否有目录或测试。                                                                                  | 可自动执行。                                                                     | 现在还不能机械判断好坏边界，误报会诱导模板化填空。                                           | 暂不做。                                    |
| 提供框架模板              | 为 Rust/Axum、Node、Python、React 提供固定目录和样例。                                                                           | 对没有经验的人最直观。                                                           | 容易强迫项目采用 Ousia 或某框架命名，且会把目录形状误当设计质量。                            | 只作为后续 examples，不作为 baseline 规则。 |
| 先定义 evidence model     | 先把跨框架工程判断收敛成可 review 的 engineering evidence，Architecture 保存稳定模型，Proposal 保存 taxonomy、smell 和验证切片。 | 不绑定技术栈，不强迫命名；可被 planner、reviewer、docs 和未来 checker 逐步吸收。 | 第一切片仍需人工 review，自动化不足。                                                        | 本提案采用。                                |

## Engineering Quality Model

Ousia 对项目的质量要求应能被没有工程审美的人或 Agent 填写和证明。非平凡设计或实现至少说明：

- 入口：外部请求、命令、事件或用户动作从哪里进入，入口是否保持薄。
- 编排：哪个模块拥有业务流程，哪些部分只是调用外部副作用。
- 状态：可变状态由谁拥有，状态转移在哪里提交，失败后哪些状态必须不变。
- 模型：传输模型、领域模型、持久化模型和展示模型何时需要分开。
- 校验：输入校验、归一化、默认值和错误映射的唯一权威层在哪里。
- 副作用：数据库、文件、网络、消息、时间、随机数和外部系统调用在哪个边界发生。
- 配置：配置从哪里声明、如何校验、默认值在哪里建立、local override 如何退出。
- 诊断：失败和关键状态如何暴露 phase、code、severity、evidence 和 remediation。
- 测试：哪些测试穿过真实边界，哪些覆盖失败无副作用，哪些只是链路 smoke。
- 文档：下一位接手者能否从 Architecture/README/Proposal 看懂当前结构和下一步。

这些字段不是模板装饰。任一关键字段填不出时，应收窄 scope、补 proposal 或重画边界，而不是继续实现。

## Smell Catalog

| Smell              | 失控形态                                                     | Review attack                                             |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------------- |
| Fat handler        | handler 同时解析输入、执行业务、访问存储、映射错误和写日志。 | 要求指出业务 owner、边界 API 和副作用层；无法说明则阻塞。 |
| Service 垃圾桶     | service 只按技术名装杂事，没有领域职责。                     | 检查函数是否围绕同一变化轴和状态 owner。                  |
| 模型混用           | DTO/domain/persistence/view 共用一个结构但语义不同。         | 要求说明每个模型的消费者和不变量。                        |
| 配置散落           | 默认值、环境判断和 override 分布在多个调用点。               | 找唯一配置 owner 和验证层。                               |
| 重复错误映射       | 边界和内部层重复把同一错误转换多次。                         | 要求明确 recoverable error 和 internal invariant 边界。   |
| 先副作用后校验     | 外部输入失败时已修改状态或发出消息。                         | 要求失败路径状态不变性测试。                              |
| 测试复述实现       | 测试复制 match 表或断言私有 helper 机械返回。                | 要求通过真实调用路径保护用户语义。                        |
| Fixture 隐藏 owner | fixture 让权限、状态或对象类型前置条件不可见。               | 要求测试契约暴露 Goal、Scope、Semantics。                 |
| 文档过程噪音       | 文档记录 agent 做了什么，而不是当前结构和下一步。            | 要求按 documentation-authoring 改为当前事实。             |
| 空扩展点           | 新接口或分类无法说明允许哪类变化独立演进。                   | 要求删除或写出真实变化轴和退出条件。                      |

## Rust/Axum 第一验证切片

第一片用 Rust/Axum API feature 验证模型，因为 handler、service/domain、repository、config、diagnostics 和 tests 的边界容易暴露工程品味问题。

场景：新增一个需要读取配置、校验请求、查询/更新状态、返回结构化错误并记录诊断的 API 能力。

好路径应证明：

- Axum handler 只负责传输边界、提取 state、调用业务 owner 和映射 response。
- 业务 owner 持有用例流程和领域不变量，不直接依赖 Axum 类型。
- repository 或 gateway 承载外部存储/系统副作用，错误先映射到稳定边界语义。
- config 在启动或边界处校验，默认值只在一个 owner 建立。
- diagnostics 包含稳定 error code、phase 和 remediation，而不是自由文本总结。
- tests 覆盖成功路径、校验失败、权限/状态错误、外部副作用失败后的状态不变性。
- Architecture 或 README 能让下一位接手者知道入口、owner、状态和验证命令。

坏路径样本：把所有逻辑写进 handler，直接读环境变量，临场构造数据库请求，失败时部分状态已修改，只写 happy path 测试，并在文档中记录“本次新增了接口”。

## 落地边界

- 稳定质量模型进入 Architecture。
- 候选 taxonomy、Rust/Axum 切片和 smell catalog 先留在本 Proposal。
- 具体坏样本和复发误读进入 Experience。
- 当某条 smell 反复出现且跨项目有效时，再提炼进 instruction 或 review skill。
- 当某条规则可机械判断、误报边界清楚、复发成本高时，才进入 checker。

## 实施切片

### 第一切片

状态：已完成。

- 在 [workflow-architecture.md](../../architecture/workflow-architecture.md) 增加 Engineering Quality 稳定模型。
- 将本提案加入 [index.md](../index.md) 当前提案。
- 不改 installer、skills、instructions 或 checker。

### 第二切片

状态：已完成；执行面已提炼到 `engineering-quality` skill，dry-run evidence 记录在 [engineering-quality-dry-run.md](../../experience/engineering-quality-dry-run.md)。

- 将模型中的 evidence fields 接入 `engineering-quality`，并由 `architecture-planner` 的 proposal packet 路由使用。
- 将 smell catalog 的攻击点接入 `engineering-quality`，并由 `black-team-review` 路由使用。
- 用 Rust/Axum dry-run plan 验证 planner 是否能逼出真实工程边界。

### 第三切片

状态：已完成；跨技术栈 examples 记录在 [engineering-quality-examples.md](../../experience/engineering-quality-examples.md)。

- 按场景扩展到 Node service、Python/FastAPI 和 React frontend。
- 形成好/坏方案对照 examples；examples 不强制项目照抄目录，只训练判断。

### 第四切片

状态：已完成；`engineering-quality` 增加 Ousia few-shot examples。

- 用 Ousia 自身的 prompt surface、installer、checker、design docs 和 workflow routes 举例说明 entry boundary、orchestration owner、state owner、validation authority、side-effect boundary、diagnostics contract 和 test contract。
- 防止 Ousia 审查自己时只用 prompt 词汇、文档完整性或术语统一替代真实工程 evidence。
- 示例不新增规则、checker、输出协议或 Ousia 专用 checklist，不改变 installer，不要求项目采用 Ousia 的命名、目录或 policy surface。

## Review Focus

- 是否仍然围绕 Ousia 自身 prompt surface，而不是项目工程质量。
- 是否只堆参考框架术语，没有转成可证明的项目 evidence。
- 是否把某个框架习惯误升级为跨项目硬规则。
- 是否强迫项目采用 Ousia 命名、目录或 policy surface。
- Ousia few-shot examples 是否只是帮助理解通用 evidence，而不是新增一套 parallel checklist。
- Rust/Axum 场景是否足够真实，能暴露 fat handler、状态 owner、配置、诊断和测试问题。

## 验证

- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md`
