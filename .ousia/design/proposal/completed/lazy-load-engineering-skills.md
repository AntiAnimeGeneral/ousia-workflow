# Lazy-load Engineering Skills（已实施）

本记录保存 lazy-load engineering skills 提案的已实施结果。稳定结论归 Architecture；复发教训归 Experience；本文件只保留实施边界、验证和后续审查入口。

## 目标

- Rust 工程规则从 base instruction 迁入 lazy-load skill。
- 测试编写、测试重构和测试 review 流程从 base instruction 下放到 lazy-load skill。
- 非 Rust 项目不通过 Ousia base 接收 Rust 规则；非测试任务不预载测试工程流程。
- 不新增 plugin instruction 层。
- 不在 Architecture 维护语言或框架 skill 清单。
- Diff review 使用真实 workspace diff 作为证据源。

## 非目标

- 不设计完整插件系统。
- 不把 Rust skill 写成 Rust 教程。
- 不为 TypeScript、frontend 或其他语言预建清单。
- 不把测试语义底线移出 always-on instruction。
- 不把 migration 过程写入长期 Architecture。

## 实施结果

1. `.github/instructions/ousia-rust-implementation.instructions.md` 已删除。
2. `.github/skills/rust-engineering/SKILL.md` 承载 Rust source、Cargo、API、ownership、panic/unwrap、match 和 validation 的任务能力。
3. `.github/skills/test-engineering/SKILL.md` 承载测试编写、测试层级、fixture、测试契约、失败路径和验证选择的任务能力。
4. `.github/instructions/ousia-testing-evolution.instructions.md` 只保留测试语义、失败无副作用、可测试性和演进底线。
5. `.github/instructions/ousia-development-standards.instructions.md` 将语言、框架、领域和测试工程任务路由到对应 skill。
6. `.github/skills/prompt-surface/SKILL.md` 明确语言、框架、领域和测试工程能力属于 lazy-load skill。
7. `.github/skills/black-team-review/SKILL.md` 使用真实 workspace diff 作为 diff review 证据源，并在测试质量 review 时读取 `test-engineering`。
8. `.github/skills/architecture-planner/SKILL.md` 在测试策略、测试树或 fixture 规划时读取 `test-engineering`。
9. `.ousia/design/architecture/workflow-architecture.md` 和 `.ousia/design/experience/workflow-lessons.md` 分别保存稳定结论和经验。

## Review Focus

- Rust 是否完全离开 base always-on instructions。
- `rust-engineering` 是否可由 skill description 发现。
- `test-engineering` 是否可由 skill description 发现。
- 测试反 fake-test 语义是否仍留在 base always-on instruction。
- 是否新增 plugin instruction 层或 Architecture 语言清单。
- `prompt-surface` 是否表达通用 skill 写作规则，而不是 Rust 或 testing 特例。
- `black-team-review` 是否只描述 diff review 的正向证据路径。

## 验证

- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md`

## 收口

本提案不再作为当前执行路线。后续如果发现 lazy-load skill 路由、测试语义底线或 prompt surface owner 漂移，应以新的 proposal 或 review finding 进入当前工作流。
