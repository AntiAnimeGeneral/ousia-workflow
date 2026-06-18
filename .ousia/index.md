# Ousia Adapter Instance

本目录是当前项目安装出来的 Ousia adapter instance。Ousia Workflow owns the structure, lifecycle, validation, and agent reading protocol; this repository fills the workflow-project facts inside those slots.

`.ousia/**` 不是项目自由 overlay。项目只能在这些结构中填写目标、约束、设计结论、验证入口和待归档事项。

## 入口

| 入口                             | 职责                                                     |
| -------------------------------- | -------------------------------------------------------- |
| [workflow.json](./workflow.json) | 当前安装的 ownership classes 和 upgrade policy。         |
| [index.md](./design/index.md)    | Architecture、Proposal 和 Experience 三个 design owner。 |
| [pending.md](./pending.md)       | 尚未归档到唯一 owner 的待处理事项，必须有退出条件。      |

## Slot 规则

- [pending.md](./pending.md) 只保存尚未归档到唯一 owner 的事项；每个条目必须说明 owner question、owner 候选和退出条件。
- 稳定项目结论进入 Architecture；当前方案进入 Proposal；踩坑、证据和 review attacks 进入 Experience。
- 通用规则进入 `.github/instructions/**` 或 Ousia core package。
- Review attacks、evidence routes 和踩坑记录进入 `.ousia/design/experience/**`，并贴近它们攻击的设计区域。
- Facade protocol details 进入 owning `SKILL.md`。

## 边界

- `.ousia/**` 的结构由 Ousia Workflow owning schema 定义。
- `.github/**` owns active editor-facing instructions、skills、workflow triggers 和 validation entry points。
- 稳定项目结论进入 Architecture；当前方案进入 Proposal；经验和证据进入 Experience。尚未确定 owner 的事项进入 [pending.md](./pending.md)，不能长期漂浮。
