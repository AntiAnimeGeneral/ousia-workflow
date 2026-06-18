# Lazy-load Engineering Skills

本提案收敛 language、framework 和 domain engineering 能力的归属。目标是让 Ousia base instructions 只保存跨项目自动生效的规则，让按任务触发的工程能力进入 skills。

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

## 实施切片

1. 删除 `.github/instructions/ousia-rust-implementation.instructions.md`。
2. 新增 `.github/skills/rust-engineering/SKILL.md`，承载 Rust source、Cargo、API、ownership、panic/unwrap、match 和 validation 的任务能力。
3. 新增 `.github/skills/test-engineering/SKILL.md`，承载测试编写、测试层级、fixture、test contract、失败路径和验证选择的任务能力。
4. 精简 `.github/instructions/ousia-testing-evolution.instructions.md`，只保留测试语义、失败无副作用、可测试性和演进底线。
5. 更新 `.github/instructions/ousia-development-standards.instructions.md`，把 language/framework/domain-specific design、implementation 和 review 路由到对应 skill，并把测试工程任务路由到 `test-engineering`。
6. 更新 `.github/skills/prompt-surface/SKILL.md`，明确语言、框架、领域和测试工程能力属于 lazy-load skill。
7. 更新 `.github/skills/black-team-review/SKILL.md`，明确 diff review 的证据源是真实 workspace diff，并在测试质量 review 时读取 `test-engineering`。
8. 更新 `.github/skills/architecture-planner/SKILL.md`，在测试策略、测试树或 fixture 规划时读取 `test-engineering`。
9. 更新 `.ousia/design/architecture/index.md`、`.ousia/design/experience/index.md` 和 extraction proposal，分别保存稳定结论、经验和迁移分类。

## Review Focus

- Rust 是否完全离开 base always-on instructions。
- `rust-engineering` 是否可由 skill description 发现。
- `test-engineering` 是否可由 skill description 发现。
- 测试反 fake-test 语义是否仍留在 base always-on instruction。
- 是否新增 plugin instruction 层或 Architecture 语言清单。
- `prompt-surface` 是否表达通用 skill authoring 规则，而不是 Rust 或 testing 特例。
- `black-team-review` 是否只描述 diff review 的正向证据路径。

## 验证

- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md`

## Handoff

实施后使用 `black-team-review` 审真实 workspace diff。Review 通过后，稳定结论保留在 Architecture，复发教训保留在 Experience。
