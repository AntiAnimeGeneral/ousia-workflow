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
- Subagent model 标识必须来自工具可用模型列表。猜 vendor label 会导致可避免的首次失败。