# Architecture

Architecture 保存长期稳定的系统抽象、owner、边界和升级模型。它是 Ousia Workflow design facts 的稳定语义 owner。

## Current Architecture

| Component        | Owner              | Role                                                                                     |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Framework core   | Ousia Workflow     | Base instructions、facade skills、shared modes、validation contracts 和 upgrade policy。 |
| Adapter instance | Project            | 已安装的 `.ousia/**` surface，保存项目事实和设计结论。                                   |
| Design primitive | Ousia Workflow     | `.ousia/design/**` 的 architecture、proposal、experience 三个 owner。                    |
| Prompt surface   | Ousia Workflow     | Instructions 提供读取边界；skills 提供任务工作流和审查义务。                             |
| Lazy-load skill  | Ousia Workflow     | 按任务意图加载的工程能力。                                                               |
| Local override   | Project, temporary | 带原因和退出条件的显式偏离。                                                             |

## Project Facts

- Ousia Workflow 是一个可安装、可升级的 agent workflow 框架。
- Ousia Workflow 拥有结构、生命周期、验证和 agent reading protocol。
- 项目在 Ousia 定义的 slot 内拥有事实。
- `.ousia/**` 是当前项目安装出来的 adapter instance，不再包含独立 source 层。
- Design facts 只通过 Architecture、Proposal 和 Experience 三个原语归档。
- Prompt surface 的抽象边界由 instruction 索引；修改、写作和 review 流程由 owning skill 承载。
- 语言、框架、领域和测试工程能力属于 lazy-load skills，不进入 base always-on instructions，也不需要 plugin instruction 层。
- 测试语义底线仍保持 always-on：测试必须保护真实行为，覆盖失败无副作用，并避免复述实现细节。
- 用户明确要求 subagent review、planning 或 exploration 时，workflow 必须尝试启动对应 subagent；subagent 仍只是执行载体。

## Review Focus

- 稳定抽象是否有唯一 owner，引用方是否只消费不重定义。
- 跨切面 topic 中已经稳定的设计结论是否应回写到 Architecture。
- Active workflow surface 是否混入项目专属事实或 runtime/harness 细节。
- Prompt surface 修改流程是否仍由 skill 承载，而不是回流到普通读取 instruction。

## 填充规则

稳定架构结论进入本区域。当前执行方案进入 Proposal；踩坑、外部证据和 review attack 进入 Experience。
