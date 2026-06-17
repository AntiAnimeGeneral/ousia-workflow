# Ousia Workflow Extraction

本文定义把当前 agent-facing workflow 资产迁出为独立 `ousia` 项目前的迁移清单。这里的 `harness` 只指 Codex、Copilot、subagent runner 等外部 agent runtime；本项目要迁出的不是 runtime，而是运行在 runtime 之上的 Ousia workflow layer：instructions、skills、modes、`.ousia/**` profile definitions、research routes、validation policy 和 handoff conventions。

本清单是 execution track 的迁移计划，不是稳定产品语义 owner。稳定架构结论应回写 Architecture area；迁移过程中发现的未归档事项进入 [.ousia/pending.md](../../../pending.md)。

## 决策：Adapter 不是自由 Overlay

Ousia Workflow 是框架。Profile 是 Ousia-defined adapter skeleton；`.ousia/**` 是该 skeleton 安装到项目后的 adapter instance。`.ousia/**` 目录组织、design area、pending 机制、validation slot 和 agent reading protocol 都由 Ousia Workflow 控制。项目只在 Ousia-defined slots 中填写项目事实。

核心边界是：Ousia Workflow owns structure, lifecycle, validation, and agent reading protocol; projects own facts inside Ousia-defined slots.

## Upgrade Ownership Classes

| Ownership class                 | Owner                                               | Upgrade behavior                                              |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Ousia-owned                     | Ousia Workflow                                      | 未修改时可由 upgrade tooling 替换；本地修改未登记时报告冲突。 |
| Ousia-structured/project-filled | Ousia Workflow owns structure, project owns content | 按稳定 section 合并，保留项目填充内容。                       |
| Profile definitions             | Ousia Workflow                                      | 位于 `.ousia/profiles/**`；按 profile version 升级。          |
| Project-owned                   | Project                                             | 只路由和验证，默认不由 upgrade tooling 改写正文。             |
| Local override                  | Project, temporary                                  | 永不静默覆盖；必须记录覆盖对象、原因和退出条件。              |

## 目标仓库形态

未来独立仓库可以命名为 `ousia`。第一版不要求实现 package；先让目录和 owner 能表达 workflow core、`.ousia/**` profile definitions、installed adapter facts 和 self-adapter 的边界。

| 目录                               | 职责                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `core/instructions/`               | 项目无关的硬规范、读取策略和工程边界。                                                   |
| `core/skills/`                     | 通用 facade contracts、mode selection、output 和 handoff protocol。                      |
| `core/skills/_shared/modes/`       | 任务形状、required inputs 和 stop conditions。                                           |
| `core/validation/doc-checker/`     | 配置驱动 Markdown checker 候选；项目拓扑不能写入 core。                                  |
| `.ousia/**`                        | 唯一 Ousia project directory；profile definitions、installed adapter facts 和 design evidence 都在这里。 |
| `.ousia/profiles/ext-ousia-os/`    | Ousia OS profile definition：kernel/OSTD/tooling 规则、验证矩阵、文档拓扑、research routes。 |
| `.ousia/profiles/ext-ousia-workflow/` | Ousia workflow self rules：发布、版本、dogfood、fixture 和迁移流程。                 |
| `fixtures/minimal-project/`        | 验证 core 不依赖 Ousia OS 的最小项目。                                                   |
| `fixtures/ousia-os-adapter-smoke/` | 验证 Ousia OS adapter 能接入 core workflow 的烟测 fixture。                              |

## 资产分类

### Workflow Core

这些资产可以作为 `core` 候选，因为它们表达项目无关的工程、规划、review 或抽象规则。

| 当前资产                                                              | 迁出目标                            | 说明                                                              |
| --------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `.github/instructions/ousia-architecture-abstraction.instructions.md` | `core/instructions/`                | 架构边界、状态所有权、抽象取舍和命名职责。                        |
| `.github/instructions/ousia-development-entry.instructions.md`        | `core/instructions/`                | 开发入口、需求识别、相邻模块阅读和现有模式判断。                  |
| `.github/instructions/ousia-design-task.instructions.md`              | `core/instructions/`                | 设计任务、候选方案、边界、迁移和验证要求。                        |
| `.github/instructions/ousia-implementation-quality.instructions.md`   | `core/instructions/`                | 主路径、错误边界、性能约束、失败前置检查和 invariant。            |
| `.github/instructions/ousia-testing-evolution.instructions.md`        | `core/instructions/`                | 测试语义、失败无副作用、黑队输入和演进规则。                      |
| `.github/skills/_shared/index.md`                                     | `core/skills/_shared/`              | mode routing index，不含项目事实。                                |
| `.github/skills/_shared/modes/**`                                     | `core/skills/_shared/modes/`        | planning/review mode shapes、required inputs 和 stop conditions。 |
| `architecture-planner/SKILL.md` 的通用 facade 协议                    | `core/skills/architecture-planner/` | `mode`、`target`、`scope`、output 和 handoff 可复用。             |
| `black-team-review/SKILL.md` 的通用 facade 协议                       | `core/skills/black-team-review/`    | `subject`、`mode`、scope、finding 输出和 handoff 可复用。         |

### Language Plugin

这些资产不属于 universal core，但可以作为 core 附带插件。

| 当前资产                                                         | 迁出目标             | 说明                                                                                |
| ---------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `.github/instructions/ousia-rust-implementation.instructions.md` | `core/plugins/rust/` | Rust API、match 完整性、panic/unwrap 边界和导入风格是语言投影，不是 Ousia OS 专属。 |

### Validation Candidate

这些资产可迁入 core validation，但必须保持配置驱动。

| 当前资产                                            | 迁出目标                       | 说明                                                             |
| --------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `.github/skills/doc-validation/scripts/**`          | `core/validation/doc-checker/` | Markdown 链接、编号文档和 section reference checker 可以通用化。 |
| `.github/skills/doc-validation/deno.json`           | `core/validation/doc-checker/` | 工具 runner 可随 checker 迁出。                                  |
| `.github/skills/doc-validation/SKILL.md` 的通用入口 | `core/skills/doc-validation/`  | checker facade 和配置驱动原则可复用。                            |

`design/check-docs.config.json` 不迁入 core；它是 `ext-ousia-os` 的文档拓扑配置。

### Profile Definition: ext-ousia-os

这些资产依赖 Ousia OS 领域语义，必须保留为 `.ousia/profiles/ext-ousia-os/**` 中的 Ousia-controlled profile definition。它们不能留在 active workflow core 中，也不能让项目自由改写 profile architecture。

| 当前资产                                                           | 迁出目标                                                         | 说明                                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `.github/instructions/ext-ousia-kernel-boundaries.instructions.md` | `.ousia/profiles/ext-ousia-os/instructions/`                     | 依赖 kernel、OSTD、tooling、HMP、QEMU 和 capability kernel 边界。                                                    |
| `.github/instructions/ext-ousia-workflow.instructions.md`          | active workflow repository policy                                | 当前作为 Ousia Workflow 仓库策略保留在 active surface；不再归入 Ousia OS profile definition。                         |
| `design/check-docs.config.json`                                    | `.ousia/profiles/ext-ousia-os/validation/`                       | Ousia OS 文档拓扑和 checker 配置。                                                                                   |
| `design/implementation/agent-harness-evidence/**`                  | `.ousia/design/research/**` 或 `.ousia/profiles/ext-ousia-os/research/` | Ousia OS research/review legacy 来源；文件名中的 harness 是历史名。                                           |
| root `design/**`                                                   | Ousia OS project docs                                            | 产品、架构、实现、proposal 和 reference corpus，不进入 workflow core。                                               |
| `.ousia/design/**` 当前内容                                        | Ousia Workflow installed adapter slots                           | 当前仓库的 `.ousia/**` 是 workflow 项目自己的 installed adapter instance，不再作为 Ousia OS legacy design 迁移来源。 |

### Self Profile Definition: ext-ousia-workflow

Ousia workflow 项目也必须作为项目被 workflow 管理。它的规则不能混进 core。

| 未来资产                                    | 职责                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `.ousia/profiles/ext-ousia-workflow/instructions/` | 发布、版本、fixture、dogfood、upgrade tooling、schema 兼容和迁移纪律。 |
| `.ousia/profiles/ext-ousia-workflow/research/`     | Ousia workflow 自身的设计研究、runtime/harness 对比和采用判断。        |
| `.ousia/profiles/ext-ousia-workflow/validation/`   | 新仓库自己的文档、schema、fixture 和 package 检查配置。                |
| `.ousia/design/**` in `ousia` repo          | Ousia workflow 自身的 baseline、architecture、execution 和 research。  |

当前 self-adapter instruction 是 `.ousia/profiles/ext-ousia-workflow/instructions/ext-ousia-workflow-self-evolution.instructions.md`。它承载 Ousia Workflow 自身演进 prompt；通用 prompt 元能力仍由 `.github/instructions/ousia-prompt-architecture.instructions.md` 承载。

### Split Status

这些文件在第一实施切片中已经完成 active surface 清理。表格保留为迁移证据，后续 review 应验证 core 是否再次混入 `.ousia/**` profile definition 或 installed adapter instance 的项目事实。

| 当前资产                                                             | 保留在 workflow core                                                            | 移出 active core 的内容                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.github/instructions/ousia-prompt-architecture.instructions.md`     | 边界优先、正交可组合、流程闭环、pending、自我迭代、prompt review attacks。      | Ousia OS 路径映射、`.ousia/design/**` 当前布局例子、具体 docs 路由。                                 |
| `.github/instructions/ousia-documentation-standards.instructions.md` | 写作标准、历史噪音控制、链接/编号 hygiene、checker 与 config 分离。             | `design/**/*.md`、`target.md §x.y` 和 `design/check-docs.config.json` 规则。                         |
| `.github/instructions/ousia-development-standards.instructions.md`   | 规范索引模式和按任务读取模块的策略。                                            | kernel/OSTD、Markdown、workflow、skills 的 Ousia OS 专用读取路由。                                   |
| `.github/skills/architecture-planner/SKILL.md`                       | facade 外部接口、mode 选择、计划输出、implementation handoff。                  | `.ousia/design/**`、legacy `design/**`、`agent-harness-evidence` 和 Ousia reference source routing。 |
| `.github/skills/black-team-review/SKILL.md`                          | review facade 外部接口、finding 输出、proposal/implementation review protocol。 | Ousia OS design areas、research routes 和领域 attack prompts。                                       |
| `.github/skills/doc-validation/SKILL.md`                             | doc-validation facade 和 checker contract。                                     | 当前 Deno 命令路径、Ousia config 路径和 workflow matrix 接入。                                       |

## 第一实施切片

本仓库中的第一切片建立可升级边界，并清理 active workflow surface。

1. 用本文和 `.ousia/workflow.json` 冻结 ownership classes、profile 归属和 upgrade policy。
2. 将 Ousia OS 专属 rules 移出 active `.github/instructions/**`，保留在 `.ousia/profiles/ext-ousia-os/**` 作为 profile definition。
3. 清理 core instructions 和 facade skills 中对 Ousia OS、kernel、OSTD、QEMU、Cargo target、legacy `design/**` 和 `agent-harness-evidence` 的硬编码路由。
4. 将 `.ousia/**` 改写为 workflow 项目自己的 installed adapter instance，不再链接缺失的 root `design/**` legacy corpus。
5. 新增 README 和 manifest，说明 Ousia owns structure，project fills slots，以及升级时各 ownership class 的处理方式。

## Review Focus

- `core` 是否混入 Ousia kernel、OSTD、HMP、QEMU、capability 或文档拓扑事实。
- `ext-ousia-os` 是否完整保留 Ousia OS 仍需要的约束，而不是被通用化时删除。
- `ext-ousia-workflow` 是否只保存 workflow 项目自己的流程，不把 self-hosting 经验伪装成 core law。
- `.ousia/**` 是否清楚表达 installed adapter instance，而不是项目自由 overlay 或与 adapter 并列的第二职责。
- Upgrade ownership classes 是否足以支持 replace、section merge、route-only 和 override conflict。
- `harness` 是否只用于 runtime/execution carrier，不再指代 instructions、skills 或 modes。
- Doc checker 是否仍是配置驱动，且没有把 Ousia 文档拓扑写进 core。
