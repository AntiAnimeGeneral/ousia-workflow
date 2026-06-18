# Ousia Workflow Extraction

本文定义把当前 agent-facing workflow 资产迁出为独立 `ousia` 项目前的迁移提案。这里的 `harness` 只指 Codex、Copilot、subagent runner 等外部 agent runtime；本项目要迁出的不是 runtime，而是运行在 runtime 之上的 Ousia workflow layer：instructions、skills、modes、`.ousia/**` installed instance、experience routes、validation policy 和 handoff conventions。

本清单是 proposal，不是稳定产品语义 owner。稳定架构结论应回写 Architecture；迁移过程中发现的未归档事项进入 [pending.md](../../pending.md)。

## 决策：Adapter 不是自由 Overlay

Ousia Workflow 是框架。`.ousia/**` 是安装到项目后的 adapter instance。`.ousia/**` 目录组织、design primitives、pending 机制、validation slot 和 agent reading protocol 都由 Ousia Workflow 控制。项目只在 Ousia-defined slots 中填写项目事实。

核心边界是：Ousia Workflow owns structure, lifecycle, validation, and agent reading protocol; projects own facts inside Ousia-defined slots.

## Upgrade Ownership Classes

| Ownership class                 | Owner                                               | Upgrade behavior                                              |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Ousia-owned                     | Ousia Workflow                                      | 未修改时可由 upgrade tooling 替换；本地修改未登记时报告冲突。 |
| Ousia-structured/project-filled | Ousia Workflow owns structure, project owns content | 按稳定 section 合并，保留项目填充内容。                       |
| Project-owned                   | Project                                             | 只路由和验证，默认不由 upgrade tooling 改写正文。             |
| Local override                  | Project, temporary                                  | 永不静默覆盖；必须记录覆盖对象、原因和退出条件。              |

## 目标仓库形态

未来独立仓库可以命名为 `ousia`。第一版不要求实现 package；先让目录和 owner 能表达 workflow core、installed adapter facts 和 self-workflow 边界。

| 目录                               | 职责                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `core/instructions/`               | 项目无关的硬规范、读取策略和工程边界。                                              |
| `core/skills/`                     | 通用 facade contracts、mode selection、output 和 handoff protocol。                 |
| `core/skills/_shared/modes/`       | 任务形状、required inputs 和 stop conditions。                                      |
| `core/validation/doc-checker/`     | 固定 Ousia 文档协议 CLI；协议由 documentation instruction 定义。                    |
| `.ousia/**`                        | 唯一 Ousia project directory；installed adapter facts 和 design evidence 都在这里。 |
| `fixtures/minimal-project/`        | 验证 core 不依赖 Ousia OS 的最小项目。                                              |
| `fixtures/ousia-os-adapter-smoke/` | 验证 Ousia OS adapter 能接入 core workflow 的烟测 fixture。                         |

## 资产分类

### Workflow Core

这些资产可以作为 `core` 候选，因为它们表达项目无关的工程、规划、review 或抽象规则。

| 当前资产                                                              | 迁出目标                            | 说明                                                              |
| --------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `.github/instructions/ousia-architecture-abstraction.instructions.md` | `core/instructions/`                | 架构边界、状态所有权、抽象取舍和命名职责。                        |
| `.github/instructions/ousia-development-entry.instructions.md`        | `core/instructions/`                | 开发入口、需求识别、相邻模块阅读和现有模式判断。                  |
| `.github/instructions/ousia-design-task.instructions.md`              | `core/instructions/`                | 设计任务、候选方案、边界、迁移和验证要求。                        |
| `.github/instructions/ousia-implementation-quality.instructions.md`   | `core/instructions/`                | 主路径、错误边界、性能约束、失败前置检查和 invariant。            |
| `.github/instructions/ousia-testing-evolution.instructions.md`        | `core/instructions/`                | 测试语义、失败无副作用、可测试性和演进底线。                      |
| `.github/skills/_shared/index.md`                                     | `core/skills/_shared/`              | mode routing index，不含项目事实。                                |
| `.github/skills/_shared/modes/**`                                     | `core/skills/_shared/modes/`        | planning/review mode shapes、required inputs 和 stop conditions。 |
| `architecture-planner/SKILL.md` 的通用 facade 协议                    | `core/skills/architecture-planner/` | `mode`、`target`、`scope`、output 和 handoff 可复用。             |
| `black-team-review/SKILL.md` 的通用 facade 协议                       | `core/skills/black-team-review/`    | `subject`、`mode`、scope、finding 输出和 handoff 可复用。         |

### Lazy-load Skills

这些资产不属于 universal core。它们按任务由 skill description 触发，不进入 base instructions，也不需要额外 plugin instruction 层。

| 当前资产                                   | 迁出目标                        | 说明                                                                       |
| ------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------- |
| `.github/skills/rust-engineering/SKILL.md` | `core/skills/rust-engineering/` | Rust API、Cargo、ownership、match、panic/unwrap 和 validation 的任务能力。 |
| `.github/skills/test-engineering/SKILL.md` | `core/skills/test-engineering/` | 测试编写、测试层级、fixture、测试契约、失败路径和 validation 的任务能力。  |

### Validation Candidate

这些资产可迁入 core validation。Checker 执行 Ousia documentation instruction 定义的稳定协议；项目事实不进入 checker implementation。

| 当前资产                                            | 迁出目标                       | 说明                            |
| --------------------------------------------------- | ------------------------------ | ------------------------------- |
| `.github/skills/doc-validation/scripts/**`          | `core/validation/doc-checker/` | Ousia 文档协议 CLI 和测试。     |
| `.github/skills/doc-validation/deno.json`           | `core/validation/doc-checker/` | 工具 runner 可随 checker 迁出。 |
| `.github/skills/doc-validation/SKILL.md` 的通用入口 | `core/skills/doc-validation/`  | checker command entry 可复用。  |

Project-specific validation 应通过 validation route 声明命令、覆盖风险和剩余风险，不作为 doc checker config 注入 core。

### Split Status

这些文件在第一实施切片中已经完成 active surface 清理。表格保留为迁移证据，后续 review 应验证 core 是否再次混入 installed adapter instance 的项目事实。

| 当前资产                                                             | 保留在 workflow core                                                            | 移出 active core 的内容                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.github/instructions/ousia-prompt-architecture.instructions.md`     | Prompt surface 抽象边界索引和读取路由。                                         | Prompt surface 修改流程、写作建议和 review 检查。                                                    |
| `.github/skills/prompt-surface/SKILL.md`                             | Prompt surface 写作、审查和验证工作流。                                         | 项目事实、隐藏规范源和独立 review facade。                                                           |
| `.github/skills/rust-engineering/SKILL.md`                           | Rust engineering lazy-load 任务能力。                                           | Base instruction 中的 Rust 工作流细节和 plugin instruction 层。                                      |
| `.github/skills/test-engineering/SKILL.md`                           | 测试工程 lazy-load 任务能力。                                                   | Base instruction 中的测试工作流细节；测试语义底线仍保留在 instruction。                              |
| `.github/instructions/ousia-documentation-standards.instructions.md` | 写作标准、历史噪音控制、Ousia 文档协议和 checker 边界。                         | `design/**/*.md`、`target.md §x.y` 和 `design/check-docs.config.json` 规则。                         |
| `.github/instructions/ousia-development-standards.instructions.md`   | 规范索引模式和按任务读取模块的策略。                                            | kernel/OSTD、Markdown、workflow、skills 的 Ousia OS 专用读取路由。                                   |
| `.github/skills/architecture-planner/SKILL.md`                       | facade 外部接口、mode 选择、计划输出、implementation handoff。                  | `.ousia/design/**`、legacy `design/**`、`agent-harness-evidence` 和 Ousia reference source routing。 |
| `.github/skills/black-team-review/SKILL.md`                          | review facade 外部接口、finding 输出、proposal/implementation review protocol。 | Ousia OS design areas、Experience attacks 和领域 attack prompts。                                    |
| `.github/skills/doc-validation/SKILL.md`                             | doc-validation command entry 和 implementation map。                            | Ousia OS 文档拓扑 config 和 workflow self-hosting 细节。                                             |

## 第一实施切片

本仓库中的第一切片建立可升级边界，并清理 active workflow surface。

1. 用本文和 `.ousia/workflow.json` 冻结 ownership classes 和 upgrade policy。
2. 将 Ousia OS 专属 rules 移出 active `.github/instructions/**`，不保留为当前 workflow 项目的独立 source 层。
3. 清理 core instructions 和 facade skills 中对 Ousia OS、kernel、OSTD、QEMU、Cargo target、legacy `design/**` 和 `agent-harness-evidence` 的硬编码路由。
4. 将 `.ousia/**` 改写为 workflow 项目自己的 installed adapter instance，不再链接缺失的 root `design/**` legacy corpus。
5. 新增 README 和 manifest，说明 Ousia owns structure，project fills slots，以及升级时各 ownership class 的处理方式。

## Review Focus

- `core` 是否混入 Ousia kernel、OSTD、HMP、QEMU、capability 或文档拓扑事实。
- Ousia OS 领域规则是否已经离开 active workflow tree。
- 稳定 workflow 项目事实是否回写 Architecture；修改经验是否回写 Experience。
- `.ousia/**` 是否清楚表达 installed adapter instance，而不是项目自由 overlay。
- Upgrade ownership classes 是否足以支持 replace、section merge、route-only 和 override conflict。
- `harness` 是否只用于 runtime/execution carrier，不再指代 instructions、skills 或 modes。
- Doc checker 是否仍只执行 Ousia 文档协议，且没有把 project facts 写进 implementation。