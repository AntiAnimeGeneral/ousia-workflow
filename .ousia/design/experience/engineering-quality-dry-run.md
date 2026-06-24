# Engineering Quality Dry Run

本记录验证 engineering quality evidence 是否能把一个容易写坏的 Rust/Axum API feature 拉回到真实工程边界。它是 Experience evidence，不是新的 baseline 规则；可复用规则归 `engineering-quality`，并由 `architecture-planner` 和 `black-team-review` 路由使用。

## Dry-run 输入

场景：为一个 Rust/Axum 服务新增一个“提交审批请求”的 API。该能力需要读取配置、校验请求、检查当前用户权限、查询并更新审批状态、返回结构化错误，并在失败时保留可诊断 evidence。

坏路径假设：handler 直接读取环境变量、解析请求、查询数据库、执行业务判断、更新状态、映射 HTTP 错误和写日志；测试只覆盖成功响应。

## Planner 输出检查

按 `engineering-quality` 的 evidence catalog，dry-run 应产生以下设计证据：

| Evidence              | Dry-run 期望                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Entry boundary        | Axum handler 只负责 request extraction、authenticated state 读取、调用 use case、response mapping。                              |
| Orchestration owner   | `SubmitApprovalUseCase` 或项目等价 owner 持有流程：权限检查、审批状态读取、状态转换、提交结果。                                  |
| State owner           | 审批聚合或状态机 owner 定义允许的状态转换；repository 只提交已验证转换。                                                         |
| Model boundaries      | HTTP request/response、domain command/result、persistence record 分离；不把 Axum extractor 或 database row 传入领域流程。        |
| Validation authority  | request shape 和基本格式在 transport boundary；业务约束和状态转换在 use case/domain owner；错误映射只在 response boundary。      |
| Side-effect boundary  | database transaction、event publish、clock 或 external notification 只在 repository/gateway 边界；所有外部输入校验先于状态提交。 |
| Configuration owner   | 审批额度、超时、feature flag 或 notification endpoint 在启动/config owner 校验；handler 不读取环境变量。                         |
| Diagnostics contract  | 错误暴露稳定 code、phase、severity、evidence 和 remediation；日志自由文本不能代替诊断契约。                                      |
| Test contract         | 测试覆盖成功、格式校验失败、权限失败、非法状态转换、repository 失败后状态不变、response mapping 和一条 integration smoke。       |
| Handoff documentation | README 或 Architecture 说明 API 入口、use case owner、状态 owner、配置 owner、诊断字段和验证命令。                               |

## Review 攻击结果

这次 dry-run 能暴露以下坏方案：

- Fat handler：如果 handler 同时持有 request parsing、权限、状态查询、状态变更和 error mapping，review 可要求拆出 orchestration owner 和 side-effect boundary。
- Service 垃圾桶：如果新建 `ApprovalService` 但它只是包装 repository 调用，review 可要求说明它拥有的领域流程和状态不变量；说不出则删除或重画边界。
- 模型混用：如果 HTTP DTO、domain command 和 database record 共用一个结构，review 可要求说明每个消费者的不变量；语义不同则必须分开。
- 配置散落：如果 handler 或 use case 临场读取 env，review 可要求配置 owner 和启动期校验。
- 先副作用后校验：如果权限、状态转换或输入校验失败时数据库已部分更新，review 可要求失败无副作用测试。
- 测试复述实现：如果测试只断言内部 helper 或复制错误映射表，review 可要求通过真实 handler/use case/repository boundary 触发行为。
- 文档过程噪音：如果文档只写“新增审批接口”，review 可要求记录当前入口、owner、状态、配置和验证命令。

## 结论

Dry-run 样本显示 planner/reviewer 接入方向有效：这些字段能检查 entry boundary、orchestration owner、state owner、validation authority、side-effect boundary、configuration owner、diagnostics contract、test contract 和 handoff docs 是否存在，而不是只接受目录模板或 service 命名。

剩余风险：dry-run 仍是设计样本，没有真实 Rust/Axum 代码和测试失败证据。第三切片应补跨技术栈 examples，并至少提供一个真实或 fixture 项目的好/坏方案对照。
