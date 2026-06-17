# Ousia Design Layout

本目录定义 Ousia project design 的目标组织方式。`.ousia/design/**` 是未来设计正文的目标位置；各区域先定义 owner、边界、review focus 和迁入规则。根部 `design/**` 只是迁移来源，不是本目录的长期抽象基础。

## 设计区域

| 区域 | 入口 | 目标职责 |
| --- | --- | --- |
| Baseline | [baseline/index.md](./baseline/index.md) | 项目目标、需求、痛点、术语和阅读地图。 |
| Architecture | [architecture/index.md](./architecture/index.md) | 长期系统抽象、边界和主线契约。 |
| Execution | [execution/index.md](./execution/index.md) | 实现路线、proposal、阶段计划和验证路径。 |
| Research | [research/index.md](./research/index.md) | 外部参考、分析笔记、review attacks 和 planning prompts。 |

## 迁入规则

稳定结论应迁入对应 owning area。迁移未完成前，可以继续引用 root `design/**` 的 legacy docs；但新增稳定结论不应只落在 legacy corpus。每次迁入都要保持 owner 唯一：Baseline 负责项目理由和术语，Architecture 负责长期语义，Execution 负责实施路线，Research 负责证据和攻击问题。
