# Workflow Lessons

## 经验路线

- Framework extraction proposal 位于 [ousia-workflow-extraction.md](../proposal/ousia-workflow-extraction.md)。
- Runtime 或 editor 专属事实先留在 Experience，直到提升为 Architecture 或提炼成跨项目 instructions。
- Ousia OS 专属规则不是 Ousia Workflow core；它们应在 Ousia OS 项目安装 workflow 后保存在该项目内。

## Lessons

- Adapter/profile 拆分不正交。Ousia 控制 `.ousia/**` skeleton；项目只在 Ousia 定义的 slot 内填充事实。
- Design 只需要 Architecture、Proposal 和 Experience 三个项目原语。Research 可以在别处发生；有用结论进入 Experience。
- Prompt surface instructions 应作为普通 agent 的读取索引。修改工作流属于作者和 reviewer 共用的 skills。
- Language、framework、domain 和 testing engineering 应使用 lazy-load skills。Base instructions 不应预载当前任务不需要的详细工作流。
- 测试编写细节放在 base instructions 会膨胀 always-on 上下文，但反 fake-test 语义必须保持 always-on。
- 新增 plugin instruction 层会重复 skill discovery，并制造不正交抽象。
- First-party prompt surface 和 design docs 混入英文整句会降低 review 质量；应保留必要术语和外部标识，但正文规则默认中文。
- 如果 workflow 只说 subagent 可选，subagent review 容易被漏掉。用户明确要求 subagent review、planning 或 exploration 时，workflow 必须要求尝试启动。
- 用户显式指定 subagent model 时，标识必须来自工具可用模型列表；猜 vendor label 会导致可避免的首次失败。
- Workflow 执行偏移不应只归因于执行者疏忽。若 agent 在完成改动后反复写解释、补防御性规则、或把一次用户判断提炼成永久校验，说明 workflow 没有足够早地要求停下来比较“用户目标、现有协议、最小必要改动和 review 闭环”。
- Review 闭环如果只写在完成阶段，容易被执行者当成事后可选项。非平凡 prompt/workflow 改动需要在进入实现前声明 review 触发条件和启动方式；否则实现者可能用自查、验证命令或总结文字替代真正的 review。
- 用户纠偏本身是高价值 Experience evidence。记录时应保存“未对齐点、错误形态、为什么现有 workflow 没拦住、后续需要攻击的问题”，不要写成道歉、辩护或即时解决方案。
- 删除冗余 skeleton 文件和增加禁止规则不是同一件事。除非存在真实复发路径、外部输入风险或维护者会合理误用的证据，不要把一次结构判断升级成 doc checker 特化规则。
- Subagent model 踩坑的根因是 prompt 没把“默认用自身同名模型启动”写成明确执行协议，又把“显式指定模型时必须精确”和“同名模型不可用时停止”混在一起，导致 agent 传空 `model` 后把工具失败误归因为额度耗尽；后续修正又把“不要无证据降级重试”误写成“调用形状错误也不重试”。避免复发需要把 prompt 闭环写清：默认启动 subagent 时传当前主 agent 的自身同名模型；用户显式指定模型时才改用用户给出的精确标识；启动失败后先确认调用形状是否正确；模型名错误或工具返回可用模型列表时，按证据修正后重试一次；网络、拒绝、额度或其他外部失败按真实失败报告并停止，不降级或循环重试；review 这类改动时必须攻击“默认模型、显式模型、可修正调用错误和真实外部失败是否被混淆”。
- Prompt/workflow 修正不能只局部补一句。连续把“不要空 model”改成“不要归因外部失败”，再改成“外部失败停止”，再改成“模型名错误可重试”，说明 workflow 缺少语义冲突和冗余 gate。避免复发需要在新增规则前先查已有 owner，按 agent 行为判断是否重复或冲突；若只是补例外或拆步骤，应改写原 owner 的规则，并让 review 攻击“新规则是否覆盖、重复或冲突了已有语义”。
- 引入外部成熟架构思想时，不要为 Ousia 自造一套新黑话。优先保留经过社区验证、深入人心的术语，例如 Spring、AOP、IoC、ApplicationContext、Aspect、Pointcut、Advice、Weaving；这些术语能降低人类和 AI 的理解成本。使用外部术语时必须同时说明它们在 Ousia 中对应的现有 owner、触发条件和边界，防止语义漂移；只有当现有术语会误导时，才新增 Ousia 自己的名称。
- Prompt/workflow 改动不能只让 Ousia 自身更整齐。用户目标是让 Ousia Workflow 指挥 agent 在真实项目中产出有工程感的设计，例如 Rust/Axum 也能形成类似 Spring 的上下文边界、生命周期、横切 concern、配置落点、诊断和测试支持。后续 review 应攻击：改动是否说明目标使用场景、真实项目影响和已有 owner 影响；如果只能解释 prompt surface 更规整，说明仍在学其型而非学其神。
- Baseline skills 不能硬依赖本仓库 `.ousia/design/**` 正文；installer 只分发 design indexes，host 项目也可能没有本仓库的 proposal body。跨项目必须生效的 evidence 字段和 review attack 应由 owning skill 自身承载，installed `.ousia/**` 只能作为当前项目的补充事实、约束、reference 或 Experience evidence。后续 review 应攻击 prompt surface diff 是否把 self-hosting proposal 当成 baseline 依赖。
- Engineering quality 接入 planner/reviewer 后必须用场景验证 evidence gate 是否真实工作。Rust/Axum dry-run 已记录在 [engineering-quality-dry-run.md](./engineering-quality-dry-run.md)：样本显示 planner/reviewer 能检查 entry boundary、orchestration owner、state owner、validation authority、side-effect boundary、configuration owner、diagnostics contract、test contract 和 handoff docs，而不是只接受目录模板、service 命名或抽象口号。
