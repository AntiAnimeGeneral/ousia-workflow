# Experience

Experience 保存踩坑记录、外部证据、review attacks 和可复用教训。外部 research 可以由其他框架完成；进入本项目时只保存对 Ousia Workflow 有用的经验结论。

## Current Experience Routes

- Framework extraction proposal lives in [index.md](../proposal/ousia-workflow-extraction/index.md); implementation lessons return here.
- Runtime or editor-specific facts remain experience until promoted into Architecture or distilled into cross-project instructions.
- Ousia OS-specific rules are not Ousia Workflow core; they should live in the Ousia OS project when that project installs the workflow.

## Lessons

- Adapter/profile split was not orthogonal. Ousia controls the `.ousia/**` skeleton; projects fill facts inside Ousia-defined slots.
- Design only needs Architecture, Proposal and Experience as project primitives. Research can happen elsewhere; useful results enter Experience.
- Prompt surface instructions should act as reading indexes for ordinary agents. Modification workflow belongs in skills used by both author and reviewer.
- Language、framework、domain 和 testing engineering 应使用 lazy-load skills。Base instructions 不应预载当前任务不需要的详细工作流。
- 测试编写细节放在 base instructions 会膨胀 always-on 上下文，但反 fake-test 语义必须保持 always-on。
- Adding a plugin instruction layer duplicates skill discovery and creates a non-orthogonal abstraction.
- Subagent review can be missed if workflow only says subagent is optional. When the user explicitly asks for subagent review, planning or exploration, the workflow must require an attempted launch.
- Subagent model identifiers must come from the tool's available model list. Guessing vendor labels causes avoidable first-attempt failures.

## Review Focus

- 经验记录是否说明触发条件、教训和下一次如何避免。
- 稳定结论是否已经回写 Architecture，当前执行路线是否已经回写 Proposal。
- review attacks 是否贴着它攻击的设计区域，而不是变成独立 agent checklist。
- residual risk 是否被带回 proposal 或 implementation review。

## 填充规则

踩坑记录、外部证据、候选判断和 agent-only attacks 进入 Experience；稳定设计结论进入 Architecture；当前执行路线进入 Proposal。
