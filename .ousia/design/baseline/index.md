# Baseline

Baseline 保存项目为什么存在、目标是什么、需求从哪里来、术语如何稳定。它是所有设计区的共同入口，不承载实现路线或候选方案细节。未来稳定正文应迁入本区域；root `design/**` 中的文件只是迁移来源。

## 迁移来源

| 来源 | 角色 |
| --- | --- |
| [outline.md](../../../design/outline.md) | 当前设计地图、阅读顺序和语义归属表。 |
| [target.md](../../../design/target.md) | 愿景、目标摘要、设计约束和阶段方向。 |
| [requirements.md](../../../design/requirements.md) | 硬需求、推导编号和结论落点。 |
| [pain-points.md](../../../design/pain-points.md) | 问题来源和动机。 |
| [glossary.md](../../../design/glossary.md) | 项目术语定义。 |

## Review Focus

- 新增抽象是否能回溯到需求或明确痛点。
- 术语是否只在 glossary 中定义一次。
- target 是否保持摘要入口，没有吸收完整需求库或实现路线。
- requirements 是否保存硬需求和推导，而不是主设计正文。

## 迁入规则

稳定 baseline 结论迁入本区域后，跨区域引用只链接，不重写。迁移未完成前，新增结论如果暂时落在 legacy docs，也必须能明确归到本区域。
