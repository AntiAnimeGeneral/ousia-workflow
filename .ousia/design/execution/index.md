# Execution

Execution 保存从设计走向实现的路线：近期实现草案、proposal packet、阶段计划、验证路径和接手入口。它不拥有长期产品语义。

## 迁移轨道

| 入口                                                               | 角色                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [ousia-workflow-extraction/](./ousia-workflow-extraction/index.md) | 把当前 agent-facing workflow 资产迁出为独立 Ousia workflow core 前的分类清单和执行边界。 |

## Review Focus

- 每个 proposal 是否有目标、非目标、候选方案、迁移策略和验证命令。
- 实现路线是否反向重定义 architecture 或 baseline 语义。
- roadmap 阶段是否能验证真实需求，而不只是验证抽象名称。
- 提案通过和实现后，稳定结论是否回写 owning docs 或代码 rustdoc。

## 填充规则

短期路线进入 Execution；稳定产品结论进入 Baseline 或 Architecture；外部事实和攻击问题进入 Research。过期 proposal 只作为历史记录，不反向定义 Execution 的长期边界。
