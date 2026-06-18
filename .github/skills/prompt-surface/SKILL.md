---
name: prompt-surface
description: "用于创建、修改或审查 Ousia prompt surface 文件：.instructions.md、SKILL.md、shared skill assets、workflow routes、validation routes，或影响 agent reading 的 .ousia design slots。"
argument-hint: "被改动的 prompt 文件、用户目标和审查重点"
---

# Prompt Surface

写作和审查共用本入口；抽象边界见 `.github/instructions/ousia-prompt-architecture.instructions.md`。

## 范围

- `.github/instructions/**/*.instructions.md`
- `.github/skills/**/SKILL.md`
- `.github/skills/_shared/**`
- workflow routes 和 validation routes
- 影响 agent reading 的 `.ousia/design/**`

## 写作归属

1. 判断改动是 hard rule、entry interface、task mode、project fact、reference evidence、validation route 还是一次性说明。
2. Hard rule 进 instructions。
3. 可调用流程、输入维度、输出协议和 reviewer obligation 进 owning skill。
4. 可复用任务形状进 `_shared/**`，且必须被入口 skill 使用。
5. 稳定项目事实进 `.ousia/design/architecture/**`。
6. 当前方案进 `.ousia/design/proposal/**`。
7. 经验、证据、踩坑和 review attacks 进 `.ousia/design/experience/**`。
8. 归属不清的事项进 `.ousia/pending.md`。

## 写作规则

- 先写 owner、读取时机、输入、输出和退出条件，再写细节。
- Frontmatter description 负责 discovery 和触发条件；正文不重复 description。
- First-party prompt surface 的 frontmatter description 也应可被本项目维护者直接 review；除非外部工具要求固定英文触发语，否则用中文写触发条件。
- 让 prompt 资产帮助 agent 路由和行动，不要写背景叙事、迁移过程或读者安抚。
- 用任务边界组织内容：hard rule、entry workflow、mode shape、project fact、evidence、validation。
- 每条规则只保留在一个 owner，其他位置只链接或路由。
- Skill 说明调用者和 reviewer 应做什么；instruction 说明所有相关任务都必须遵守什么。
- 语言、框架、领域和测试工程能力属于 lazy-load skill；不要再造 plugin instruction 或 Architecture 清单。
- Shared asset 只承载复用任务形状；没有入口 skill 使用时不要创建。
- `.ousia/design/**` 写当前事实、当前方案或经验证据，不写 skill 行为。
- 新术语必须能用 owner、输入输出、读取时机和退出条件解释。
- 保留英文术语时，优先限于稳定框架名词、协议字段、命令、文件路径、API、代码符号或外部产品名；自然语言规则和 review 标准应使用中文。
- 非平凡 prompt/workflow 改动应能进入 proposal -> review -> implementation -> review。

## 审查

Reviewer 读取被改动 surface 的 owning skill。

Check:

- Changed surface 是否只有一个 owner。
- Diff 是否符合 owning skill 的流程和输出协议。
- Entry skill 是否复制了整份 instruction 或项目 checklist。
- Shared asset 是否只是可复用任务形状，而不是隐藏规则。
- `.ousia/design/**` 是否只保存项目事实，没有保存额外 skill 行为。
- 新 route 是否能投影到已有 `mode`、`target`、`subject`、`scope`、`focus` 或 `.ousia/**` slot。
- Skill 如果定义写作约束，是否同时定义 reviewer 该如何验证这些约束。
- 文案是否只保留当前规则、当前事实和可执行动作。
- 英文是否只用于稳定术语或外部标识，正文是否仍能被中文 review。
- Prompt 是否帮助 agent 更快找到 owner，而不是增加读取负担。

## 证据

Prompt surface review 收集：

- 用户目标和预期 agent 行为
- changed prompt files
- owning instruction 或 skill
- 相关 `_shared/**` 组件
- 相关 `.ousia/design/**` owner
- validation commands and results

## 验证

- `deno task --cwd .github/skills/doc-validation check:docs`
- `git diff --check -- .github .ousia README.md`
