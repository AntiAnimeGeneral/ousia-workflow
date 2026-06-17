# Architecture

Architecture 保存长期稳定的系统抽象、边界和主线契约。它 owns Ousia Workflow 的 framework core、`.ousia/**` profile definitions、installed adapter instance、override 和 upgrade boundary 的稳定语义。

## Current Architecture

| Component        | Owner              | Role                                                                                     |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Framework core   | Ousia Workflow     | Base instructions、facade skills、shared modes、validation contracts 和 upgrade policy。 |
| Project profile  | Ousia Workflow     | Ousia-controlled skeleton for a class of projects.                                       |
| Adapter instance | Project            | Installed `.ousia/**` surface that carries project facts in profile-defined slots.       |
| Local override   | Project, temporary | Explicit deviation with reason and exit condition.                                       |

## Review Focus

- 稳定抽象是否有唯一 owner，引用方是否只消费不重定义。
- 跨切面 topic 中已经稳定的设计结论是否应回写到 architecture owning docs。
- 兼容层、POSIX、VFS、file/path 等概念是否污染 Ousia 原生 API。
- 同步和异步是否都保持 first-class。

## 填充规则

稳定架构结论进入本区域；研究、候选方案和外部参考不直接进入本区域。`.ousia/**` profile definition 的结构规则只有在 Ousia Workflow owns it 时才能进入 Architecture；项目事实应停留在 installed `.ousia/**` adapter instance 的对应 slot。
