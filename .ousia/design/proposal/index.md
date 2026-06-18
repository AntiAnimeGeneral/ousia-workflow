# Proposal

Proposal 保存当前可执行工作：proposal packet、迁移计划、阶段切片、handoff 和验证路径。它不拥有长期产品语义。

## 当前提案

| 入口                                                                 | 角色                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [index.md](./ousia-workflow-extraction/index.md)                     | 把当前 agent-facing workflow 资产迁出为独立 Ousia workflow core 前的分类清单和执行边界。 |
| [ousia-release-installer.md](./ousia-release-installer.md)           | 在当前仓库内新增 TypeScript release installer，把 Ousia workflow 安装到目标项目。       |

## 已完成提案

| 入口                                                                 | 结果                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [lazy-load-engineering-skills.md](./lazy-load-engineering-skills.md) | 已将 Rust 和测试工程流程迁入 lazy-load skills；稳定结论已回写 Architecture 和 Experience。 |

## Review Focus

- 每个 proposal 是否有目标、非目标、候选方案、迁移策略和验证命令。
- 实现路线是否反向重定义 Architecture 语义。
- roadmap 阶段是否能验证真实需求，而不只是验证抽象名称。
- 提案通过和实现后，稳定结论是否回写 Architecture，复发教训是否回写 Experience。

## 填充规则

当前路线进入 Proposal；稳定结论进入 Architecture；踩坑、证据和攻击问题进入 Experience。已完成或过期 proposal 只作为历史记录，不反向定义长期边界。
