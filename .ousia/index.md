# Ousia Adapter Instance

本目录是当前项目安装出来的 Ousia adapter instance。Ousia Workflow owns the structure, lifecycle, validation, and agent reading protocol; this repository fills the workflow-project facts inside those slots.

`.ousia/**` 不是项目自由 overlay，也不是与 adapter 并列的另一层职责。Profile 是 Ousia-defined skeleton；`.ousia/**` 是该 skeleton 安装到项目后的适配层实例。项目只能在这些结构中填写目标、约束、设计结论、验证入口和待归档事项。

## 入口

| 入口                             | 职责                                                      |
| -------------------------------- | --------------------------------------------------------- |
| [workflow.json](./workflow.json) | 当前安装的 ownership classes、profile 和 upgrade policy。 |
| [index.md](./design/index.md)     | Ousia-defined design areas、owner 和读取入口。            |
| [profiles/](./profiles/)         | Ousia-controlled profile definitions，和 adapter instance 同属本目录树。 |
| [pending.md](./pending.md)       | 尚未归档到唯一 owner 的待处理事项，必须有退出条件。       |

## Slot 规则

- [pending.md](./pending.md) 只保存尚未归档到唯一 owner 的事项；每个条目必须说明 owner question、owner 候选和退出条件。
- 稳定项目结论进入 `.ousia/design/**` 的 owning area。
- 通用规则进入 `.github/instructions/**` 或 Ousia core package。
- Review attacks 和 evidence routes 进入 `.ousia/design/research/**`，并贴近它们攻击的设计区域。
- Facade protocol details 进入 owning `SKILL.md`。

## 边界

- `.ousia/**` 的结构由 Ousia Workflow owning schema/profile 定义。
- `.github/**` owns active editor-facing instructions、skills、workflow triggers 和 validation entry points。
- Profile definitions 必须保存在 `.ousia/profiles/**`；不要再建立与 `.ousia/**` 并列的 adapter 目录。
- 稳定项目结论应进入 `.ousia/design/**` 的 owning area；尚未确定 owner 的事项进入 [pending.md](./pending.md)，不能长期漂浮。
