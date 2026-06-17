# Execution

Execution 保存从设计走向实现的路线：近期实现草案、proposal packet、阶段计划、验证路径和接手入口。它不拥有长期产品语义。root `design/implementation/**`、`design/proposals/**` 和相关 topics 只是迁移来源。

## 迁移来源

| 来源 | 角色 |
| --- | --- |
| [implementation/](../../../design/implementation/) | 短期实现路线、代码演进草案和 reviewer 入口。 |
| [proposals/](../../../design/proposals/) | 进入实施前的 proposal packet、取舍和 handoff。 |
| [topics/06-roadmap.md](../../../design/topics/06-roadmap.md) | 阶段顺序、非目标和验收闭环。 |
| [topics/02-engineering.md](../../../design/topics/02-engineering.md) | 工程化、构建、测试、更新和硬件支持边界。 |
| [topics/03-shell-and-tools.md](../../../design/topics/03-shell-and-tools.md) | Shell、工具和开发体验路线。 |

## 迁移轨道

| 入口 | 角色 |
| --- | --- |
| [ousia-workflow-extraction/](./ousia-workflow-extraction/index.md) | 把当前 agent-facing workflow 资产迁出为独立 Ousia workflow core 前的分类清单和执行边界。 |

## Review Focus

- 每个 proposal 是否有目标、非目标、候选方案、迁移策略和验证命令。
- 实现路线是否反向重定义 architecture 或 baseline 语义。
- roadmap 阶段是否能验证真实需求，而不只是验证抽象名称。
- 提案通过和实现后，稳定结论是否回写 owning docs 或代码 rustdoc。

## 迁入规则

短期路线迁入 execution；稳定产品结论迁入 baseline 或 architecture；过期 proposal 只作为历史记录。迁移未完成前，legacy docs 可以继续承载正文，但不能反向定义 execution 的长期边界。
