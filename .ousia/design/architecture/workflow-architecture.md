# Workflow Architecture

## 结构摘要

| Component        | Owner              | Role                                                                                     |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Framework core   | Ousia Workflow     | Base instructions、facade skills、shared modes、validation contracts 和 upgrade policy。 |
| Adapter instance | Project            | 已安装的 `.ousia/**` surface，保存项目事实和设计结论。                                   |
| Design primitive | Ousia Workflow     | `.ousia/design/**` 的 architecture、proposal、experience 三个 owner。                    |
| Prompt surface   | Ousia Workflow     | Instructions 提供读取边界；skills 提供任务工作流和审查义务。                             |
| Lazy-load skill  | Ousia Workflow     | 按任务意图加载的工程能力。                                                               |
| Feedback evidence | Ousia Workflow     | 用户纠偏、语义偏移和 workflow 失效样本的归档、提炼和升级闭环。                           |
| Local override   | Project, temporary | 带原因和退出条件的显式偏离。                                                             |

## 稳定结论

- Ousia Workflow 是一个可安装、可升级的 agent workflow 框架。
- Ousia Workflow 拥有结构、生命周期、验证和 agent reading protocol。
- 项目在 Ousia 定义的 slot 内拥有事实。
- `.ousia/**` 是当前项目安装出来的 adapter instance，不再包含独立 source 层。
- Design facts 只通过 Architecture、Proposal 和 Experience 三个原语归档。
- Prompt surface 的抽象边界由 instruction 索引；修改、写作和 review 流程由 owning skill 承载。
- 语言、框架、领域和测试工程能力属于 lazy-load skills，不进入 base always-on instructions，也不需要 plugin instruction 层。
- 测试语义底线仍保持 always-on：测试必须保护真实行为，覆盖失败无副作用，并避免复述实现细节。
- 用户明确要求 subagent review、planning 或 exploration 时，workflow 必须尝试启动对应 subagent；subagent 仍只是执行载体。

## Feedback Ingestion

用户纠偏是 Ousia Workflow 的自我迭代输入，不是对话噪音。它的稳定目标是让 workflow 能吸纳“agent 没有理解理念、没有按流程行动、反复补废话或把一次判断过度提炼成规则”的样本，并把这些样本路由到正确 owner。

反馈吸纳的 owner 是 Ousia Workflow。项目可以在 `.ousia/design/experience/**` 记录当前实例中的错位样本；框架根据样本是否可复发、是否跨任务、是否需要机械阻断，再决定提升到 instruction、skill、shared asset、architecture fact 或 checker。

反馈吸纳路径：

| 阶段 | 输出 | Owner |
| ---- | ---- | ----- |
| 纠偏识别 | 未对齐点、错误形态、用户目标和被偏移的语义。 | Experience |
| 原因分析 | 执行失误、workflow 缺口、prompt 歧义、tool schema 诱导或 review 缺失。 | Experience |
| 提炼判断 | 是否需要升级为 hard rule、entry workflow、review obligation、mode shape 或 validation rule。 | Proposal |
| 实施落点 | 更新 instruction、owning skill、shared mode、checker 或安装实例文档。 | 对应 owner |
| Review 攻击 | 检查是否过度泛化、是否把一次判断写成永久规则、是否把可选字段伪装成必填字段。 | Black-team review |

升级边界：

- 单次错位和具体踩坑先进入 Experience。
- 多次复发、跨任务有效、影响所有实现者的规则才能进入 instructions。
- 任务流程、输入维度、输出协议和 reviewer obligation 进入 owning skill。
- 复用任务形状进入 shared assets。
- 只有可机械判断、复发成本高、误报边界清楚的问题才进入 checker。
- Architecture 记录稳定设计理念和 owner 关系，不记录即时道歉、过程流水或尚未验证的解决方案。
