# Ousia Design Layout

本目录定义 Ousia Workflow 的 project design skeleton。Area 划分、owner、读取入口和 review focus 由 Ousia Workflow 控制；项目只在这些 area 中填写事实、结论、路线和证据。

## 设计区域

| 区域         | 入口                                             | 目标职责                                                 |
| ------------ | ------------------------------------------------ | -------------------------------------------------------- |
| Baseline     | [index.md](./baseline/index.md)         | 项目目标、需求、痛点、术语和阅读地图。                   |
| Architecture | [index.md](./architecture/index.md) | 长期系统抽象、边界和主线契约。                           |
| Execution    | [index.md](./execution/index.md)       | 实施路线、proposal、阶段计划和验证路径。                 |
| Research     | [index.md](./research/index.md)         | 外部参考、分析笔记、review attacks 和 planning prompts。 |

## 填充规则

稳定结论应进入对应 owning area。每个 area 的结构由 Ousia Workflow 定义；项目事实只填在 area 允许的语义槽位中。Baseline 负责项目理由和术语，Architecture 负责长期语义，Execution 负责实施路线，Research 负责证据和攻击问题。

如果某个结论无法归属到唯一 area，先写入 [pending.md](../pending.md)，记录 owner 候选和退出条件。
