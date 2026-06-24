# Prompt Surface Owner Convergence

本提案收敛 `.github/instructions/**` 和 `.github/skills/**` 中的 owner 冲突、验证命令重复、hidden rule source 和 lazy-load skill 边界漂移。目标是让 prompt surface 自己也符合 Ousia 的工程质量要求：唯一 owner、可路由入口、无隐藏规则源、无复制 checklist、验证命令由明确 route 拥有。

状态：第三切片已完成；高置信 owner 冲突已做局部收敛，语言命令边界和 Ousia few-shot 语义已明确。

## 背景

全局扫描发现若干 prompt surface 问题：

- 领域 skill 直接列固定验证命令，容易和 repository policy、validation route、doc checker owner 漂移。
- `architecture-planner` 复制 `engineering-quality` 的完整 evidence catalog，削弱 lazy-load owner。
- `ousia-prompt-architecture` 在边界不清时回退到 Architecture 中的 Workflow Context，容易让 `.ousia/design/**` 变成隐藏规则源。
- `test-engineering` 的 description 和 routing 文本看起来拥有验证命令选择，但正文又说命令归项目 route 或语言 skill。
- `engineering-quality` 曾列出当前仓库的具体 Experience 路径，容易被当作 baseline skill 的固定依赖。

这些问题不一定立刻导致行为错误，但会让 agent 在后续维护中复制规则、绕过 owning skill，或把 evidence 文档当成第二套规范源。

## 目标

- 收敛 instructions、entry skills、shared assets、validation routes、design facts 和 Experience evidence 的 owner 边界。
- 让 planner/reviewer 通过 owning skill 路由到 evidence，而不是复制对方 catalog。
- 让验证命令由 repository policy、validation route、语言/领域 skill 或 checker skill 拥有，领域 skill 只收集验证证据和风险。
- 让 `.ousia/design/**` 作为项目事实和 evidence，不成为隐藏 prompt 规则源。
- 保持改动可 review：优先改文字 owner 和路由，不重排目录、不新增 checker。

## 非目标

- 不重写所有 instructions 或 skills。
- 不改变 `black-team-review`、`architecture-planner` 的输出协议。
- 不把 subagent 扫描结果直接升级为永久硬规则。
- 不新增 validation checker。
- 不处理 installer package 的代码结构。

## 候选方案

| 方案 | 做法 | 优点 | 风险 | 结论 |
| ---- | ---- | ---- | ---- | ---- |
| 只保留扫描结果 | 不改文件，只在最终回复中报告问题。 | 零代码 churn。 | 问题继续存在，后续 agent 仍会照旧复制 owner。 | 不采用。 |
| 一次性重构 prompt surface | 大范围重写 instructions 和 skills。 | 可以一次消除很多重复。 | diff 过大，难以 review，容易引入新的 owner 冲突。 | 不采用。 |
| 小切片 owner 收敛 | 针对高置信冲突做局部文字修正，保留现有结构。 | 风险低，可逐项 review，可立即降低漂移。 | 不能一次解决所有潜在重复。 | 采用。 |

## 第一切片

状态：已完成。

已处理：

- `documentation-authoring`、`prompt-surface`、`engineering-quality` 的验证段改为路由句，不再直接拥有固定命令。
- `test-engineering` 从“验证命令选择”收窄为“测试证据和 runner 约束输入”。
- `architecture-planner` 不再复制完整 `engineering-quality` evidence catalog。
- `ousia-prompt-architecture` 不再把 Architecture 中的 Workflow Context 当作边界不清时的 hidden rule source。
- `engineering-quality` 不再硬编码当前仓库具体 Experience 文件为 baseline 必读依赖。
- Architecture 和已完成的 Spring-inspired proposal 同步 testing owner 表述，避免旧 design facts 继续指向“验证命令选择”。

已确认边界：

- 语言相关 runner 和具体命令归语言 skill、项目 route 或 repository policy；`test-engineering` 只保留测试证据、test contract、fixture 和 runner 约束输入。
- `engineering-quality` 保留通用 evidence 规则；Ousia 自身只作为 few-shot example，不新增 Ousia 专用 checklist。

## 第二切片

状态：已完成；只读复查 `black-team-review`、`architecture-planner`、`_shared/**` 和 `doc-validation` 后，没有继续扩大实现改动。

结论：

- `black-team-review` 中的 `Review Prompt 要求` 和输出要求属于 review facade 的输入/输出协议，不是 evidence owner 复制；保留。
- `architecture-planner` 中的 plan/handoff 字段属于 proposal packet 和 implementation handoff 协议；已移除完整 `engineering-quality` catalog 复制，剩余验证命令字段只是计划证据，不是 validation route owner；保留。
- `_shared/**` 仍只描述 mode shape、required inputs 和 stop conditions，没有保存项目事实、领域规则或输出协议；保留。
- `doc-validation` skill 仍是 checker command entry 和 implementation map；documentation protocol instruction 仍拥有 Markdown 协议，未发现重复 owner；保留。
- `rust-engineering` 的验证段是语言投影，不与 repository policy 冲突；保留。

不继续改动的原因：这些 surface 当前承担的是 facade 输入/输出、mode shape 或语言投影。继续把它们改成更抽象的路由句会降低可执行性，而不是减少真实冲突。

## 第三切片

状态：已完成；根据 review 反馈明确 runner/命令边界和 Ousia few-shot 边界。

决策：

- 语言相关特化放到语言 skills 或项目 route；通用测试 skill 不维护具体语言命令矩阵。
- Evidence 是 reviewer 可检查的证明，不是固定字段模板。它证明 owner、输入输出、状态提交点、失败无副作用、验证路径、诊断和接手文档是否成立。
- `engineering-quality` 中保留通用 evidence catalog；Ousia 自身作为元项目可以提供 few-shot 示例，但示例不得变成额外规则、输出协议或 Ousia 专用 checklist。

已处理：

- `engineering-quality` 增加 evidence 定义。
- `Ousia Self-use` 改为 `Examples`，明确 Ousia 表格是 few-shot 示例，不新增规则。
- 移除 `engineering-quality` 读取时机中对 Ousia 自身的专门触发项，避免把通用 skill 变成 Ousia 专属入口。

## 后续切片

- `engineering-quality` 保留通用 evidence 规则；Ousia 自身只作为 few-shot example，不能变成额外 checklist。
- 如果后续出现 agent 不运行必要验证命令的复发样本，优先补 repository policy 或 validation route，而不是让领域 skill 重新拥有命令。
- 如重复问题复发，再考虑 checker 或 lint 规则；当前不新增自动检查。

## Review Focus

- 是否真的减少 owner 冲突，而不是把规则挪成更模糊的路由句。
- 是否把 validation command owner 收敛过度，导致实施者不知道该跑什么。
- 是否仍存在 entry skill 复制 instruction、skill 复制 skill catalog、Experience 变隐藏规则源的问题。
- 是否保留了 repository policy 对最终完成检查的单一权威。
- 是否所有 index 改动仍保持 index-only。

## 验证

- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md`
