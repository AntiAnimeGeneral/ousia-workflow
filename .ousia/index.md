# Ousia Extension

本目录是 `ousia workflow install` 生成的 project-local extension surface。它保存本项目对 Ousia workflow 的特化：项目设计组织、待归档事项和从既有 `design/**` 迁入 `.ousia/design/**` 的路线。

本仓库的根部 `design/**` 已经推进一段时间，可以作为成熟但不一定最佳的 legacy design corpus。`.ousia/design/**` 是未来设计正文的目标位置；在迁移完成前，它只记录目标 owner、边界和迁入规则，不把 `design/**` 的路径映射当作长期抽象。

## 入口

| 入口 | 职责 |
| --- | --- |
| [design/](./design/index.md) | Ousia project design 的目标组织方式、区域 owner 和迁入规则。 |
| [pending.md](./pending.md) | 尚未归档到唯一 owner 的待处理事项。 |

## 边界

- `.ousia/**` owns Ousia project extension structure 和目标组织方式。
- 根部 `design/**` 是迁移来源；它不是长期 extension surface，也不应反向定义 `.ousia/design/**` 的抽象。
- `.github/**` owns editor-facing instructions、skills、workflow triggers 和 validation entry points。
- 稳定产品结论最终应进入 `.ousia/design/**` 的 owning area；迁移未完成前，仍可停留在 root `design/**` 的 legacy owning docs。
