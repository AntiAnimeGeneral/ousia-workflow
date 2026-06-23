---
applyTo: "**"
description: "Ousia Workflow 仓库策略：完成检查、组合式 skill 使用、subagent 边界、review 闭环和升级边界。"
---

# Ousia Workflow Repository Policy

本仓库是 Ousia Workflow 框架项目。Ousia Workflow owns structure, lifecycle, validation, and agent reading protocol; projects own facts inside Ousia-defined slots.

## 完成检查

按当前任务实际改动的文件选择检查。不要因为某个检查存在就运行无关检查。

- 如果 `.ousia/**/*.md` 改动，运行 `git diff --check -- .ousia`，并检查 `.ousia/**/index.md` 只作为索引，且本地链接和摘要仍能路由到存在的 owning sources。
- 如果 `README.md`、`.ousia/**/*.md`、`.github/instructions/**/*.instructions.md` 或 `.github/skills/**/SKILL.md` 改动，运行 `deno task --cwd .github/skills/doc-validation check:docs`，检查 Ousia 文档协议、Markdown 链接、YAML frontmatter、description 和 stale path。
- 如果 `.ousia/workflow.json` 改动，检查 ownership classes、upgrade policy 和路径 glob 是否仍与仓库结构一致。
- 如果 `.github/skills/doc-validation/scripts/**/*.ts`、`.github/skills/doc-validation/deno.json` 或 `.github/skills/doc-validation/tsconfig.json` 改动，运行 `deno task --cwd .github/skills/doc-validation fmt:docs-checker --check`、`deno task --cwd .github/skills/doc-validation check:types`、`deno task --cwd .github/skills/doc-validation lint:docs-checker` 和 `deno task --cwd .github/skills/doc-validation test:docs`。
- `doc-validation` 是一条命令跑好的 Ousia 文档协议检查：`deno task --cwd .github/skills/doc-validation check:docs`。
- 如果只是回答问题、review 文本但不编辑、或讨论设计，除非用户明确要求，否则不运行验证命令。
- 如果某个检查无法运行，说明原因和剩余风险。

## 组合式规范和 Skill 路由

- 开发规范放在 `.github/instructions/*.instructions.md` 中。`ousia-development-standards.instructions.md` 是索引，具体规范拆在 `ousia-development-entry`、`ousia-architecture-abstraction`、`ousia-implementation-quality`、`ousia-testing-evolution` 和 `ousia-design-task` 模块。
- Prompt surface 抽象边界索引放在 `.github/instructions/ousia-prompt-architecture.instructions.md` 中；创建、修改或 review instructions、skills、shared assets、workflow routes、validation routes 或影响 agent reading 的 `.ousia/design/**` 时，使用 [SKILL.md](../skills/prompt-surface/SKILL.md)。
- Ousia-defined `.ousia/**` skeleton 是 workflow 结构，不是项目自由 overlay。项目事实只能填入 Ousia 定义的 slot。
- 用户指出理念未对齐、workflow 未执行、反复写废话、过度规则化或体系可能有问题时，先暂停惯性执行，判断这是执行失误还是 workflow 缺口；具体样本先记录到 Experience，只有经过提炼和 review 后才升级为 instruction、skill、shared asset 或 checker。
- 外部调用使用 facade entry skills；不要把 `_shared/**` 当作外部入口或规范源。

## Subagent 使用边界

- Subagent 只是执行载体，不是规范 owner。review、planning 和输出要求归入口 skill。
- 用户明确要求 subagent review、planning 或 exploration 时，必须尝试启动对应 subagent。
- 默认用当前主 agent 的自身同名模型启动 subagent；不要省略 `model`、传空值、传 `Auto` 或猜测 vendor label。
- 如果用户显式指定 subagent `model`，必须使用工具可用列表里的完整精确标识。
- Subagent 启动失败时，先确认默认路径是否使用了自身同名模型，或用户显式模型路径是否使用了完整精确标识。
- 如果工具返回可用模型列表或明确指出模型名错误，可按该证据修正后重试一次；不要无证据降级、换模型或循环重试。
- 调用形状正确但工具返回网络、拒绝、额度或其他外部失败时，按真实失败报告并停止。
- Subagent prompt 只写任务、scope、必须读取的入口 skill 或证据、只读/禁止修改约束和期望返回；diff review 让 subagent 读取真实 workspace diff。

## Review/Architect 闭环

- 实现闭环：完成非平凡实现、重构、架构边界调整、workflow ownership 变化或行为变更后，使用 [SKILL.md](../skills/black-team-review/SKILL.md) 审查真实 diff、验证结果和行为风险。review 的 subject、mode、prompt 内容和输出要求由该 skill 声明。
- 测试专项闭环：测试新增、测试重构、用户质疑测试质量、需要全局扫描某个测试/子系统，架构师提案需要审查测试策略，或 implementation review 发现测试可能只是复述实现时，使用 [SKILL.md](../skills/black-team-review/SKILL.md)。
- 架构规划闭环：当新实现、重构、子系统、`.ousia/**` skeleton、验证策略或文档区域需要先明确边界、状态所有权、错误模型、测试策略或设计结论落点时，使用 [SKILL.md](../skills/architecture-planner/SKILL.md) 生成 architecture plan / proposal packet；architect 不直接实施，也不自证正确。
- 提案审查闭环：架构提案进入实施或 design facts 落地前，使用 [SKILL.md](../skills/black-team-review/SKILL.md) 审查 proposal diff。提案通过或修正后才能实现；实现后再回到 implementation review。
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

不要使用会在 commit 已存在后修改 worktree 的 post-commit formatter。commit path 之外的手动验证优先使用 check-only 命令；主动编辑需要格式化的语言 source 时，按对应 skill 或 project route 先落地格式化，再用 check-only 命令确认。commit hooks 中应先格式化、重新 stage，再继续检查。

## 报告

最终回复中总结改动文件，并列出已运行的检查及其结果。
