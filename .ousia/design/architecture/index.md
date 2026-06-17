# Architecture

Architecture 保存长期稳定的系统抽象、owner、边界和升级模型。它是 Ousia Workflow design facts 的稳定语义 owner。

## Current Architecture

| Component        | Owner              | Role                                                                                  |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------- |
| Framework core   | Ousia Workflow     | Base instructions、facade skills、shared modes、validation contracts 和 upgrade policy。 |
| Adapter instance | Project            | Installed `.ousia/**` surface containing project facts and design conclusions.         |
| Design primitive | Ousia Workflow     | `.ousia/design/**` 的 architecture、proposal、experience 三个 owner。                  |
| Local override   | Project, temporary | Explicit deviation with reason and exit condition.                                    |

## Project Facts

- Ousia Workflow 是一个可安装、可升级的 agent workflow 框架。
- Ousia Workflow owns structure, lifecycle, validation, and agent reading protocol.
- Projects own facts inside Ousia-defined slots.
- `.ousia/**` 是当前项目安装出来的 adapter instance，不再包含独立 source layer。
- Design facts 只通过 Architecture、Proposal 和 Experience 三个原语归档。

## Review Focus

- 稳定抽象是否有唯一 owner，引用方是否只消费不重定义。
- 跨切面 topic 中已经稳定的设计结论是否应回写到 Architecture。
- 兼容层、POSIX、VFS、file/path 等概念是否污染 Ousia 原生 API。
- 同步和异步是否都保持 first-class。

## 填充规则

稳定架构结论进入本区域。当前执行方案进入 Proposal；踩坑、外部证据和 review attack 进入 Experience。
