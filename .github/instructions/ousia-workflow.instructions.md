---
applyTo: "**"
description: "Ousia Workflow 启动协议：识别任务、按 Framework Manifest 路由能力与项目事实，并完成计划、验证和审查闭环。"
---

# Ousia Workflow 启动协议

- 先识别用户目标、任务类型、可选 mode/subject、目标路径和
  concerns；不清楚且会改变 owner、范围或兼容语义时先澄清。
- `.ousia/framework.json` 是安装 inventory、task/concern route、project fact
  slots、validation route 和 prompt budget 的唯一静态权威；不要在 Markdown
  中维护第二份 route matrix。
- 按 route 读取 entry/domain skills 和必要 project fact slots；项目事实从
  `.ousia/project.json` 与 `.ousia/design/**` owning sources读取，不把 manifest
  当作隐藏规则正文。
- 非平凡实现先说明最小可验证纵向切片；工程硬不变量归
  `ousia-engineering-standards.instructions.md`，设计或边界未闭合时使用
  `architecture-planner`。
- 实现完成后按 manifest validation
  routes运行相关检查；非平凡实现、架构、workflow或行为变更使用
  `black-team-review` 审查真实 diff。
- Compatibility 必须显式取值为 `required`、`forbidden` 或
  `not-applicable`；`forbidden` 时不得创建兼容 facade、迁移桥、旧 schema adapter
  或双写路径。
- Instructions只保存自动适用的短硬规则；任务流程、领域 evidence、输出协议和
  reviewer obligations归 owning skills；项目事实归 `.ousia/**` slots。
