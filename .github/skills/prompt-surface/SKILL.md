---
name: prompt-surface
description: "用于创建、修改、审查或全局启发扫描 Ousia prompt surface：.instructions.md、SKILL.md、Framework Manifest routes、validation routes，或影响 agent reading 的 .ousia design slots。"
argument-hint: "被改动或扫描的 prompt 文件、用户目标、预期 agent 行为和审查/扫描重点"
---

# Prompt Surface

写作和审查共用本入口；抽象边界见
`.github/instructions/ousia-prompt-architecture.instructions.md`。

## 范围

- `.github/agents/**/*.agent.md`
- `.github/instructions/**/*.instructions.md`
- `.github/skills/**/SKILL.md`
- workflow routes 和 validation routes
- 影响 agent reading 的 `.ousia/design/**`

## 写作归属

1. 判断改动是 hard rule、entry interface、task mode、project fact、reference
   evidence、validation route 还是一次性说明。
2. Hard rule 进 instructions。
3. 执行载体身份、模型、工具边界和最小角色说明进 custom agent；任务流程继续路由到 owning skill。
4. 可调用流程、输入维度、输出协议和 reviewer obligation 进 owning skill。
5. Task mode、required inputs和stop conditions进owning entry skill。
6. 稳定项目事实进 `.ousia/design/architecture/**`。
7. 当前方案进 `.ousia/design/proposal/*.md`；已关闭方案按
   `documentation-authoring` 的生命周期进入
   `.ousia/design/proposal/archive/**`。
8. 经验、证据、踩坑和 review attacks 进 `.ousia/design/experience/**`。
9. 归属不清的事项进 `.ousia/pending.md`。

## 写作规则

- 先写 owner、读取时机、输入、输出和退出条件，再写细节。
- 新增或修改规则前，先查相邻instruction、owning skill、manifest
  route、`.ousia/design/**`和checker route；已有owner时改写原规则或路由到它。
- 写规则时显式区分主路径、例外、失败归因和重试边界；不要把多个不同语义压进一句让执行者临场拆解。
- Frontmatter description 负责 discovery 和触发条件；正文不重复 description。
- First-party prompt surface 的 frontmatter description 也应可被本项目维护者直接
  review；除非外部工具要求固定英文触发语，否则用中文写触发条件。
- 让 prompt 资产帮助 agent 路由和行动，不要写背景叙事、迁移过程或读者安抚。
- 用唯一 owner 组织内容：hard rule、entry workflow、mode shape、project
  fact、evidence、validation。其他位置只链接或路由。
- 修改 prompt surface 时必须说明目标使用场景：它会怎样改变 agent
  在真实项目里的设计、实现、review 或验证行为，以及可能影响哪些已有 owner。
- Skill 说明调用者和 reviewer 应做什么；instruction
  说明所有相关任务都必须遵守什么。
- 语言、框架、领域和测试工程能力属于 lazy-load skill；不要再造 plugin
  instruction 或 Architecture 清单。
- 不创建shared prompt层；任务模式直接归entry skill，跨任务硬规则归instruction。
- `.ousia/design/**` 写当前事实、当前方案或经验证据，不写 skill 行为。
- 用户纠偏、理念未对齐、workflow 漏执行和过度规则化样本先进入
  Experience；是否升级为 instruction、skill、manifest route 或 checker
  必须先明确提炼判断，非平凡升级进入 Proposal 和 review。
- 新术语必须能用 owner、输入输出、读取时机和退出条件解释。
- 保留英文术语时，优先限于稳定框架名词、协议字段、命令、文件路径、API、代码符号或外部产品名；自然语言规则和
  review 标准应使用中文。
- 非平凡 prompt/workflow 改动应能进入 proposal -> review -> implementation ->
  review -> archive。

## 审查

Reviewer 读取被改动 surface 的 owning skill。

Check:

- Changed surface 是否只有一个 owner。
- 新增或修改的规则是否与现有 owner
  语义冲突、重复定义或互相覆盖；若文字不同但会驱动同一 agent
  行为，也按冗余处理。
- 新规则是否把局部纠偏写成覆盖更宽语义的硬规则；例外、失败归因和重试边界是否和主路径分开。
- Diff 是否符合 owning skill 的流程和输出协议。
- Diff 是否说明使用场景和行为影响；如果只能解释 prompt
  自身更整齐，却不能说明它会如何改善真实开发任务，应要求收窄或重写。
- Entry skill 是否复制了整份 instruction 或项目 checklist。
- Custom agent 是否只定义执行载体边界并路由到 owning skill，而没有复制任务流程、输出协议或 review 判定。
- Entry skill是否直接拥有自己的mode和stop conditions，而没有依赖隐藏shared层。
- `.ousia/design/**` 是否只保存项目事实，没有保存额外 skill 行为。
- 新 route 是否能投影到已有 `mode`、`target`、`subject`、`scope`、`focus` 或
  `.ousia/**` slot。
- Skill 如果定义写作约束，是否同时定义 reviewer 该如何验证这些约束。
- 文案是否只保留当前规则、当前事实和可执行动作。
- 用户纠偏是否被正确路由：具体样本进 Experience，跨任务规则进
  instructions，任务流程进 owning skill，机械且低误报的规则才进 checker。
- 英文是否只用于稳定术语或外部标识，正文是否仍能被中文 review。
- Prompt 是否帮助 agent 更快找到 owner，而不是增加读取负担。

## 证据

Prompt surface review 收集：

- 用户目标和预期 agent 行为
- changed prompt files
- owning instruction 或 skill
- 相关entry/domain skills
- 相关 `.ousia/design/**` owner
- validation commands and results

## 验证

按 repository policy、validation route 和 owning checker skill 选择验证命令；本
skill 只要求收集 prompt surface 改动对应的验证证据、覆盖风险和剩余风险。
