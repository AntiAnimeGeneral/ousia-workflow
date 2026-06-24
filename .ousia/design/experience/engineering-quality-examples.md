# Engineering Quality Examples

本记录保存 engineering quality 的跨技术栈 examples。它们用于训练 planner/reviewer 判断，不是目录模板、框架规范或项目必须采用的命名。

## 使用边界

- Example 只说明 owner、边界、状态、副作用、诊断和测试如何落地。
- 项目可以使用不同目录、类型名、框架或分层命名；只要 evidence 能被证明即可。
- 当 example 与项目既有架构冲突时，优先按 installed `.ousia/**` facts 和现有代码 owner 判断。
- Example 不能替代 proposal、review 或真实测试；它只提供好/坏方案对照。

## Rust/Axum API

场景：提交审批请求。

坏方案：

- Axum handler 读取环境变量、解析 JSON、检查权限、查询数据库、修改审批状态、发通知、映射 HTTP 错误和写日志。
- HTTP request、domain command 和 database row 共用一个结构。
- 配置默认值散落在 handler 和 repository。
- 测试只断言 `POST /approvals` 返回 200。

好方案：

- Handler 只做 transport boundary：提取 authenticated user、解析 request、调用 use case、映射 response。
- Use case 持有 orchestration：权限、状态读取、领域转换和提交顺序。
- Approval aggregate 或状态机 owner 定义允许转换；repository 只提交已验证状态。
- Config owner 在启动期校验额度、超时和 notification endpoint。
- Diagnostics 暴露稳定 code、phase、severity、evidence 和 remediation。
- Tests 覆盖成功、格式错误、权限失败、非法状态转换、repository 失败后状态不变和 response mapping。

Review attack：如果计划只能说“新增 handler/service/repository 三层”，但说不清状态 owner、校验权威层、失败无副作用和诊断契约，应要求重画边界。

## Node Service

场景：为后台任务新增“重新同步客户账单”能力。

坏方案：

- Controller 直接读取 request、拉取账单 API、写数据库、重试失败项和拼接日志。
- Retry policy、rate limit、external API mapping 和 persistence transaction 混在一个函数。
- 测试 mock 掉所有内部 helper，只断言 helper 被调用。

好方案：

- HTTP 或 queue handler 只建立 entry boundary 和 correlation id。
- `BillingResyncJob` 或 host 等价 owner 持有 orchestration、retry decision 和 idempotency key。
- Gateway owner 映射外部 billing API 错误；repository owner 保证 transaction 边界。
- Rate limit、batch size 和 retry policy 由 config owner 校验。
- Diagnostics 区分 external API failure、validation failure、partial retry 和 persistence failure。
- Tests 覆盖 idempotency、partial failure、retry exhaustion、transaction rollback 和 one smoke path。

Review attack：如果实现把 retry 写成散落的 `try/catch`，或把 external API 错误直接暴露给 controller，应要求找到 gateway/error mapping owner。

## Python/FastAPI

场景：新增“导入 CSV 用户列表”接口。

坏方案：

- FastAPI endpoint 直接解析 multipart、读取 CSV、创建用户、发送 welcome email。
- 行级校验、重复用户策略、事务提交和邮件副作用混在 endpoint。
- 失败时一部分用户已创建，但错误响应只说 import failed。

好方案：

- Endpoint 只负责 upload boundary、request id、调用 import use case 和 response mapping。
- Parser owner 只产出 typed rows 和 parse diagnostics。
- Import use case 决定 duplicate policy、batch validation 和 commit plan。
- Repository 在提交前拿到已验证 command；email gateway 在状态提交后由明确 outbox 或 post-commit boundary 触发。
- Diagnostics 能定位 row number、phase、code 和 remediation。
- Tests 覆盖 parse failure、duplicate policy、partial invalid rows、repository failure 后无用户创建、post-commit email failure 的可恢复语义。

Review attack：如果 endpoint 同时处理 CSV、业务规则和邮件，或失败响应无法定位 row/phase，应阻塞进入实现。

## React Frontend

场景：新增审批队列页面。

坏方案：

- Component 同时发请求、拼 query params、管理 optimistic update、解释权限错误、控制 toast、保存筛选状态和渲染表格。
- API response shape 直接作为 view model；错误文案由多个 component 各自拼接。
- 测试只 snapshot 页面初始渲染。

好方案：

- Route/page owner 只负责页面 entry、数据 hook 组合和布局。
- Query/filter state 有单一 owner，URL state、local state 或 server state 的归属清楚。
- API adapter 映射 transport response/error；view model owner 提供页面可消费字段。
- Mutation owner 定义 optimistic update、rollback 和 error recovery。
- Diagnostics 或 user-facing error mapping 使用稳定 error code，不在每个 component 自由翻译。
- Tests 覆盖筛选状态、加载/空/错误/权限状态、mutation rollback、adapter mapping 和一条用户交互 smoke。

Review attack：如果页面组件变成所有状态和副作用的 owner，或 view model 与 API model 混用，应要求拆出状态 owner 和 adapter boundary。

## Approval API Fixture 对照

这个 fixture-style 对照用于 review 一个方案是否真的通过 evidence gate。

| Evidence              | 坏方案信号                                           | 好方案信号                                                   |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| Entry boundary        | Handler/endpoint/page component 是所有逻辑 owner。   | Entry 只做 transport 或 UI boundary。                        |
| Orchestration owner   | 业务流程散在 handler、repository、gateway 和 tests。 | 一个 use case/job/import flow/mutation owner 持有流程。      |
| State owner           | 状态转换靠 if/else 临场判断。                        | Aggregate/state machine/query state owner 定义转换和不变量。 |
| Model boundaries      | DTO、domain、database、view model 共用结构。         | 模型按消费者和不变量分开。                                   |
| Validation authority  | 多层重复校验或多处补默认值。                         | 校验、默认值和错误映射有唯一权威层。                         |
| Side-effect boundary  | 校验失败后已写数据库、发消息或更新 UI 状态。         | 外部输入检查先于状态提交；失败无副作用可测试。               |
| Configuration owner   | handler/component/use case 直接读 env 或散落默认值。 | config owner 在启动或边界处校验并提供已验证配置。            |
| Diagnostics contract  | 只有自由文本日志或 toast。                           | 稳定 code、phase、severity、evidence、remediation。          |
| Test contract         | 只测 happy path 或内部 helper。                      | 测真实边界、失败路径、rollback/no-op 和 smoke path。         |
| Handoff documentation | 文档写“新增某功能”。                                 | 文档说明入口、owner、状态、配置、诊断和验证命令。            |

## 结论

这些 examples 覆盖了 API、后台任务、导入流程和 frontend workflow 四种常见失控形态。它们支持第三切片完成，但仍不构成机械 checker 条件。只有当某个坏味道在多个真实项目中复发、误报边界清楚、且能用低噪音方式检测时，才应进入 checker。
