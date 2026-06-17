---
applyTo: "**"
description: "Ousia Workflow 仓库策略：完成检查、组合式 skill 使用、subagent 边界、review 闭环和升级边界。"
---

# Ousia Workflow Repository Policy

本仓库是 Ousia Workflow 框架项目。Ousia Workflow owns structure, lifecycle, validation, and agent reading protocol; projects own facts inside Ousia-defined slots.

## 完成检查

按当前任务实际改动的文件选择检查。不要因为某个检查存在就运行无关检查。

- 如果 `.ousia/**/*.md` 改动，运行 `git diff --check -- .ousia`，并检查 `.ousia/design/index.md` 的 design areas、本地链接和 workflow ownership 描述是否仍能路由到存在的 owning sources。
- 如果 `README.md`、`.ousia/**/*.md`、`.github/instructions/**/*.instructions.md` 或 `.github/skills/**/SKILL.md` 改动，运行 `deno task --cwd .github/skills/doc-validation check:docs`，检查 Ousia 文档协议、Markdown 链接、YAML frontmatter、description 和 stale path。
- 如果 `.ousia/workflow.json` 改动，检查 ownership classes、upgrade policy 和路径 glob 是否仍与仓库结构一致。
- 如果 `.github/skills/doc-validation/scripts/**/*.ts`、`.github/skills/doc-validation/deno.json` 或 `.github/skills/doc-validation/tsconfig.json` 改动，运行 `deno task --cwd .github/skills/doc-validation fmt:docs-checker --check`、`deno task --cwd .github/skills/doc-validation check:types`、`deno task --cwd .github/skills/doc-validation lint:docs-checker` 和 `deno task --cwd .github/skills/doc-validation test:docs`。
- `doc-validation` 是一条命令跑好的 Ousia 文档协议检查：`deno task --cwd .github/skills/doc-validation check:docs`。
- 如果只是回答问题、review 文本但不编辑、或讨论设计，除非用户明确要求，否则不运行验证命令。
- 如果某个检查无法运行，说明原因和剩余风险。

## 组合式规范和 Skill 使用规则

- 开发规范放在 `.github/instructions/*.instructions.md` 中。`ousia-development-standards.instructions.md` 是索引，具体规范拆在 `ousia-development-entry`、`ousia-architecture-abstraction`、`ousia-implementation-quality`、`ousia-testing-evolution` 和 `ousia-design-task` 模块。
- 项目元架构规范放在 `.github/instructions/ousia-prompt-architecture.instructions.md` 中；修改代码边界、文档归属、skills、workflow ownership 或 validation policy 前，必须按该规范检查边界性、正交可组合性、简约性和闭环可执行性。
- Ousia-defined `.ousia/**` skeleton 是 workflow 结构，不是项目自由 overlay。项目事实只能填入 Ousia 定义的 slot。
- `.github/skills/_shared/**` 是组合资产，不是规范源本身。它们只负责少量任务维度：architecture planner 的 `mode/target`，black-team review 的 `subject/mode`。输出协议和 handoff 细节归入口 skill 自己声明。
- 入口 skill 负责发现和路由：声明适用场景、外部维度、必须读取的 shared assets 和 focus。入口 skill 不应承载整份开发规范、完整 checklist 或通用输出协议。
- 如果发现某条规则是所有角色都应遵守的规范，把它写入 `.github/instructions/**`；如果只是某个 skill 如何组合规范和输出，把它写入 `.github/skills/_shared/**` 或入口 skill。

## 外部 Skill 接口

- 外部调用优先使用 facade 入口，而不是手动拼接 `_shared` 组合资产。
- 黑队 review 的默认 facade 是 [SKILL.md](../skills/black-team-review/SKILL.md)。调用方提供 `subject`、`mode`、`scope`、`user goal`、`inputs` 和可选 `focus`；入口 skill 内部按 `_shared/index.md` 选择 review mode。
- 不再暴露 implementation/test/proposal 的专项 review skill。专项性由 `black-team-review` 的 `subject`、`mode`、`scope`、instructions 和 installed adapter facts 展开。
- Shared assets 不是外部入口，不应被当作 subagent skill 直接调用。

## Subagent 使用边界

- Subagent 只是可选的执行载体，不是独立规范层、独立 skill 或 review/architecture workflow 的 owner。模型可以按任务复杂度自主决定直接执行 skill，或把 skill 上下文交给只读 subagent 执行。
- 调用 subagent 时，必须显式传入当前主上下文使用的同一个完整模型身份字符串。不要使用裸型号名、`Auto`、空字符串、默认模型、不同档位模型或任何隐式 fallback。
- 如果当前工具上下文没有暴露完整模型身份，或同名模型指定失败，不要用空 `model`、默认模型或降级模型重试。改为不启动该 subagent，并在当前输出或最终报告中说明“未能用同名模型启动 subagent”，把对应 exploration、review 或 planning coverage 标记为 residual risk。
- Subagent prompt 只需要描述任务、scope、必须读取的入口 skill 或证据、只读/禁止修改约束，以及期望返回的报告。review、planning 和输出要求由对应入口 skill 承载，不在 subagent 层重新定义。

## Review/Architect 闭环

- 实现闭环：完成非平凡实现、重构、架构边界调整、workflow ownership 变化或行为变更后，使用 [SKILL.md](../skills/black-team-review/SKILL.md) 审查真实 diff、验证结果和行为风险。review 的 subject、mode、prompt 内容和输出要求由该 skill 声明。
- 测试专项闭环：测试新增、测试重构、用户质疑测试质量、需要全局扫描某个测试/子系统，架构师提案需要审查测试策略，或 implementation review 发现测试可能只是复述实现时，使用 [SKILL.md](../skills/black-team-review/SKILL.md)。
- 架构规划闭环：当新实现、重构、子系统、`.ousia/**` skeleton、验证策略或文档区域需要先明确边界、状态所有权、错误模型、测试策略或设计结论落点时，使用 [SKILL.md](../skills/architecture-planner/SKILL.md) 生成 architecture plan / proposal packet；architect 不直接实施，也不自证正确。
- 提案审查闭环：架构提案进入实施或 owning docs 落地前，使用 [SKILL.md](../skills/black-team-review/SKILL.md) 审查 proposal diff。提案通过或修正后才能实现；实现后再回到 implementation review。
- Handoff：review 发现结构性问题时，按 review skill 的 handoff 要求交给 architecture planner；提案 review 通过后，按 architecture-planner skill 的 implementation handoff 要求进入实施。
- 主 agent 根据 review findings 决定是否继续修复、调整提案并重新验证。
- 纯文案小改、机械改名、格式修正或用户明确跳过 review 时，可以不运行 review。

## 升级边界

- Ousia-owned files 可由 upgrade tooling 在未修改时替换。
- Ousia-structured/project-filled files 按稳定 section 合并，保留项目填充内容。
- Project-owned files 只路由和验证，默认不由 upgrade tooling 改写正文。
- Local overrides 永不静默覆盖，必须说明覆盖规则、原因和退出条件。

## 格式化边界

commit-time automation 可以在 commit 创建前写入格式化结果。如果 formatter 从 hook 运行，应使用 pre-commit hook，只格式化相关 staged files 或项目范围，并在 Git 创建 commit 前重新 stage 这些 formatter edits。

不要使用会在 commit 已存在后修改 worktree 的 post-commit formatter。commit path 之外的手动验证优先使用 check-only 命令，例如 `deno fmt --check` 和 `cargo fmt --check`；如果当前任务正在主动编辑 Rust source，应先运行 `cargo fmt` 落地标准格式化，再用 check-only 命令确认。commit hooks 中应先格式化、重新 stage，再继续检查。

## 报告

最终回复中总结改动文件，并列出已运行的检查及其结果。
