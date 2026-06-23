# Shared Index

只保存入口 skill 的通用路由。规范在 `.github/instructions/**` 和 owning skills；项目语义、证据和约束在 installed `.ousia/**` design facts。

## Architecture Planner

入口：`.github/skills/architecture-planner/SKILL.md`

调用维度：

- `mode`：`重构` 或 `新模块`。
- `target`：`产品层` 或 `代码`。

路由：

- Mode：读取 `.github/skills/_shared/modes/planning/refactor.md` 或 `.github/skills/_shared/modes/planning/new-module.md`。
- Target：由入口 skill 根据 `target` 和相关 instructions 投影；不单独拆组件。
- 输出协议由 `architecture-planner` skill 自己声明。

- `产品层` 指设计事实、理念、目标/非目标、能力归属和采用理由。
- `代码` 指具体实现结构、模块/API、依赖方向、状态所有权、错误边界、测试切入点和最佳实践。
- 当 `mode` 或 `target` 不明确时，先按用户目标推断；推断不可靠时只问这一处，不展开更多选项。

## Black-Team Review

入口：`.github/skills/black-team-review/SKILL.md`

调用维度：

- `subject`：`设计提案` 或 `代码实现`。
- `mode`：`diff` 或 `全局启发扫描`。

路由：

- Mode：读取 `.github/skills/_shared/modes/review/diff.md` 或 `.github/skills/_shared/modes/review/heuristic-scan.md`。
- Subject：由入口 skill 根据 `subject` 和相关 instructions 投影；不单独拆组件。
- 输出协议由 `black-team-review` skill 自己声明。
- Subagent 只是可选执行载体，不是 review 或 planning owner；review prompt、输出协议和 handoff 由 `black-team-review` skill 自己声明。

- `设计提案 + diff`：审刚写出的 proposal/doc diff 是否能进入实施。
- `设计提案 + 全局启发扫描`：扫描设计文档、概念区域或 proposal set 的漂移、空洞、冲突和归属问题。
- `代码实现 + diff`：审真实实现 diff、测试和验证结果。
- `代码实现 + 全局启发扫描`：扫描子系统、测试树或代码区域的长期边界问题。

## Shared Rules

- Shared 组件只描述任务形状，不写具体产品/代码规范或输出协议。
- 需要项目证据、领域 review attacks 或项目约束时，由入口 skill 按当前任务 scope 读取 `.ousia/workflow.json` 和 `.ousia/design/**`；本 shared index 不维护项目扩展路由。
- 不要新增过多 mode、target 或 subject；优先把差异交给 instructions 和当前任务 scope。
- Shared assets 不是外部入口，不应被当作 subagent skill 直接调用。
