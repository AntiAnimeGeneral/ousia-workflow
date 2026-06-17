# Ousia Project Surface

本目录是 Ousia Workflow 定义的 project surface。Ousia Workflow owns the structure, lifecycle, validation, and agent reading protocol; this repository fills the workflow-project facts inside those slots.

`.ousia/**` 不是项目自由 overlay。目录、area、pending 机制和读取协议由 Ousia Workflow 定义，项目只能在这些结构中填写目标、约束、设计结论、验证入口和待归档事项。

## 入口

| 入口 | 职责 |
| --- | --- |
| [workflow.json](./workflow.json) | 当前安装的 ownership classes、profile 和 upgrade policy。 |
| [design/](./design/index.md) | Ousia-defined design areas、owner 和读取入口。 |
| [pending.md](./pending.md) | 尚未归档到唯一 owner 的待处理事项，必须有退出条件。 |

## 边界

- `.ousia/**` 的结构由 Ousia Workflow owning schema 定义。
- `.github/**` owns active editor-facing instructions、skills、workflow triggers 和 validation entry points。
- `adapters/**` 保存 Ousia-controlled profile payload；其中内容不自动进入 active workflow surface。
- 稳定项目结论应进入 `.ousia/design/**` 的 owning area；尚未确定 owner 的事项进入 [pending.md](./pending.md)，不能长期漂浮。
