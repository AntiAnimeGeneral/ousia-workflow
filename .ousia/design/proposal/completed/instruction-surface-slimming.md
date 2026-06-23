# Instruction Surface Slimming

本提案定义 Ousia instructions 的归属审计和瘦身结果。目标是在不漏读硬边界的前提下，减少 always-on instruction 对上下文的干扰，把任务流程、输出协议和 review checklist 迁到 owning skills。

状态：已完成。稳定结论回写到 [workflow-architecture.md](../../architecture/workflow-architecture.md)。

## 目标

- 保留 instructions 作为跨任务硬底线和读取路由。
- 将任务流程、输入维度、输出协议、handoff 和 review checklist 迁到 entry skills；shared modes 只保存被入口复用的任务形状。
- 保证实现者、planner、reviewer 不会因为瘦身而漏读状态所有权、错误边界、测试语义、prompt surface owner、validation 和 review 闭环。
- 用逐步 proposal -> review -> implementation 的方式迁移，不直接重排 prompt surface。

## 非目标

- 不把所有 instructions 移入 skills。
- 不新增 plugin instruction 层、profile 层或第二套 discovery。
- 不让 shared assets 保存规范正文或项目事实。
- 不改变当前 installer 行为。

## 背景与约束

Ousia 的稳定方向是：instructions 保存跨项目必须自动生效的硬规范和项目读取规则；entry skills 保存可发现入口、输入维度、流程、输出要求和 reviewer obligations；shared assets 只保存被入口 skill 复用的任务形状；项目事实进入 `.ousia/design/**`。

用户指出保证不漏读很重要。因此瘦身不能只追求少上下文。真正目标是让 always-on surface 只承载“漏读会破坏项目语义”的规则，把“进入某类任务后怎么做”的细节交给对应 skill。

## 归属原则

应保留在 instructions：

- 所有任务都必须自动遵守的硬边界。
- 任务开始前必须知道的读取路由。
- 漏读会导致状态所有权、错误边界、测试语义、文档协议、prompt owner 或 review 闭环失效的规则。
- Checker 执行的稳定协议。

应迁到 entry skills：

- 某类任务的执行流程。
- 输入维度、输出格式、handoff packet 和 review prompt shape。
- 任务专属 checklist。
- planner、reviewer、prompt author 或 test author 才需要的详细步骤。

应迁到 shared modes：

- 被多个 entry skill 复用的 mode shape。
- Required inputs、stop conditions 和 task shape。
- 不含产品/代码规范、不含项目事实、不含输出协议。

应迁到 `.ousia/design/**`：

- Ousia 自身的稳定架构事实和采用理由。
- 当前迁移方案、候选路径、经验样本和 review attacks。
- 目标项目形态、Workflow Context 和 Spring-inspired 设计结论。

## 当前 Instruction 归属判断

| Instruction                                      | 判断                                                                                   | 建议                                                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext-ousia-workflow.instructions.md`             | 混合了 repository policy、完成检查、skill 接口、subagent 协议、review 闭环和报告要求。 | 保留完成检查、subagent 硬边界、review/architect 闭环、upgrade 边界和最终报告底线；将 skill 接口细节、review prompt 形状和组合式说明迁到对应 entry skills。 |
| `ousia-development-standards.instructions.md`    | 当前是开发规范索引，但包含较多 planner/reviewer 读取细节。                             | 保留轻量索引和必须读取底线；将 architecture planner、black-team reviewer 的组合读取细节迁到对应 skills。                                                   |
| `ousia-development-entry.instructions.md`        | 实现前的需求识别、依赖复用、相邻模块阅读和纵向切片底线。                               | 保留。它是防止盲目实现和漏读相邻边界的 always-on 入口。                                                                                                    |
| `ousia-architecture-abstraction.instructions.md` | 状态所有权、依赖方向、抽象取舍和命名职责。                                             | 保留。它是所有设计、实现和 review 都需要的工程底线。                                                                                                       |
| `ousia-implementation-quality.instructions.md`   | 主路径、错误边界、性能和临时实现约束。                                                 | 保留，但可后续压缩表达；这些规则漏读会直接破坏实现质量。                                                                                                   |
| `ousia-testing-evolution.instructions.md`        | 测试语义底线。                                                                         | 保留瘦底线；测试编写、fixture、层级和验证命令继续归 `test-engineering` skill。                                                                             |
| `ousia-design-task.instructions.md`              | 设计任务触发和必须覆盖内容，部分与 `architecture-planner` 输出协议重叠。               | 第一优先瘦身：instruction 保留“何时算设计任务”和少量不可省略语义；候选方案、输出包、implementation handoff 和 review focus 归 `architecture-planner`。     |
| `ousia-documentation-standards.instructions.md`  | Markdown 写作质量、文档归属和文档协议。                                                | 保留文档协议和 checker-owned 规则；如果后续新增 documentation authoring skill，再迁写作流程和 review checklist。                                           |
| `ousia-prompt-architecture.instructions.md`      | Prompt surface 的 owner 和读取边界索引。                                               | 保留极瘦版本。它定义 skills/instructions/shared/design/validation 的归属，不能整体移入 skill；具体写作和审查已归 `prompt-surface`。                        |

## 推荐迁移顺序

### 已完成：瘦身设计任务规范

目标语义：`ousia-design-task.instructions.md` 只保留设计任务触发条件和不可省略的语义证明；`architecture-planner` 拥有 proposal packet、implementation handoff、候选方案细节和 review focus。

原因：该 instruction 与 `architecture-planner` 重叠最明显，迁移风险低，能验证“瘦身但不漏读”的方法。

完成状态：

- 设计任务仍会被 always-on 规则识别。
- Planner skill 成为完整 proposal 输出协议 owner。
- Review 仍能攻击 proposal 是否缺候选方案、纵向切片、迁移、验证和回滚。
- Shared modes 不保存输出协议、handoff 或 reviewer checklist。

### 已完成：瘦身 repository policy

目标语义：`ext-ousia-workflow.instructions.md` 只保留仓库级硬边界；skill 外部接口、review prompt shape 和组合细节归 entry skills。

原因：它当前是最大 always-on 文件，也是最容易成为“大总管”的 surface。

完成状态：

- 完成检查仍在 always-on policy 中。
- Subagent 启动失败边界仍 always-on，保证用户显式要求 subagent 时不漏。
- Review/architect 闭环仍 always-on 可见。
- Entry skills 拥有各自输出协议和 handoff。

### 已完成：整理 development standards 索引

目标语义：`ousia-development-standards.instructions.md` 成为真正的开发规范路由索引，不保存 planner/reviewer 的完整读取流程。

原因：它应帮助 agent 找到规则，而不是成为第二套 skill composition。

完成状态：

- 实现者必须读取的底线仍清楚。
- Planner/reviewer 的追加读取逻辑归对应 skills。
- 不复制 prompt architecture 或 workflow policy。

### 已评估：保留 documentation standards

目标语义：文档协议和 checker-owned 规则仍在 instruction；文档写作流程是否迁出取决于是否新增 documentation authoring skill。

原因：目前 doc-validation skill 是验证入口，不是完整 authoring skill。过早拆分会让文档写作规则没有明确入口。

评估状态：

- `ousia-documentation-standards` 仍是 Markdown 写作质量、文档归档语义和 Ousia 文档协议的正确 owner。
- `doc-validation` 只拥有验证命令、checker 路线和 checker 改动验证矩阵，不承载文档 authoring workflow。
- 在新增 documentation authoring/review skill 前，不迁出写作标准，避免把文档规则放入不会被写作任务触发的验证 skill。

## 不漏读保护

每个迁移切片必须满足：

- Always-on instruction 仍能告诉 agent 何时进入对应 skill。
- Entry skill frontmatter description 能被任务发现。
- 被迁移内容在新 owner 中保留输入、输出、退出条件和 reviewer 检查。
- Black-team review 使用真实 diff 攻击是否出现规则重复、owner 错配、漏读硬边界或 hidden norm source。
- 文档验证和 diff hygiene 通过。
- 若迁移影响测试、installer 或 checker，运行对应代码验证。

## 测试与验证

- Prompt surface 和 `.ousia/**` 文档改动：`deno task --cwd .github/skills/doc-validation check:docs`。
- Diff hygiene：`git diff --check -- .github .ousia README.md`。
- 每个非平凡迁移切片使用 `black-team-review`，`subject: 代码实现`，`mode: diff`。

## Review Focus

- 是否为了减少上下文而漏掉必须 always-on 的硬边界。
- 是否把 skill 变成隐藏规范源，导致未触发 skill 时规则失效。
- 是否把 shared assets 变成第二套 instruction。
- 是否把 Architecture 事实写成 agent 行为规则。
- 是否只移动文字，没有减少重复 owner 或改善任务入口。
- 是否能通过一个纵向切片证明迁移后仍能规划、实现、review 和验证。
