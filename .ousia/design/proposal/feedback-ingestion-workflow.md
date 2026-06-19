# Feedback Ingestion Workflow

本提案定义 Ousia Workflow 吸纳用户纠偏和 workflow 失效样本的第一实施切片。目标是让纠偏从对话中的临时修正，进入可归档、可提炼、可 review、可实施的闭环。

## 目标

- 用户指出理念未对齐、workflow 未执行、反复写废话或体系可能有问题时，agent 必须把它识别为 feedback evidence。
- 纠偏样本先进入 Experience，保存未对齐点、错误形态、原因和后续攻击问题。
- 是否升级为 instruction、skill、shared asset、proposal 或 checker 由显式提炼步骤决定。
- 非平凡升级必须经过 proposal 和 black-team review，避免把一次判断过度提炼成硬规则。
- 默认实现不依赖新工具或新存储；先用现有 Architecture、Proposal、Experience 和 review skill 闭环。

## 非目标

- 不把每次用户纠错都自动升级成 instruction。
- 不新增 checker 规则来阻止所有可能的误用。
- 不引入新的 design primitive。
- 不新增长期运行的 memory 或外部数据库。
- 不把 Experience 写成道歉、过程流水或 agent 自我辩护。

## 背景与约束

Architecture 已确认 Feedback evidence 归 Ousia Workflow，具体错位样本先进入 Experience，实施方案进入 Proposal。当前痛点是 agent 容易在用户纠偏后继续补丁式修当前文件，而不是暂停判断这是执行失误还是 workflow 缺口。

现有结构应继承：

- Architecture 保存稳定 owner、路径和升级边界。
- Experience 保存具体错位样本和复发风险。
- Proposal 保存待实施的升级方案。
- Prompt surface skill 保存写作和 review 归属。
- Black-team review 攻击过度泛化、边界漂移和缺失 review。

应停止模仿的模式：

- 用最终回复里的解释替代 Experience 记录。
- 用验证命令替代 review。
- 把用户一次判断直接写成 checker 或 hard rule。
- 默认 subagent 启动没有使用自身同名模型，或把同名模型启动失败误归因为额度、权限或工具不可用。

## 候选方案

### 方案 A：只增加 Experience 记录规则

在文档标准或 prompt surface skill 中要求用户纠偏先写 Experience。

优点：改动小，马上降低样本丢失风险。

缺点：只能记录，不能保证后续提炼、review 和实施；仍可能把 Experience 当作情绪日志。

### 方案 B：新增完整 feedback ingestion skill

新增专门 skill，负责识别纠偏、归档、提炼、生成 proposal 和 review handoff。

优点：职责集中，流程清楚。

缺点：第一阶段会新增入口和 discovery 负担；当前还没有足够样本证明需要新 skill，而 prompt surface 和 architecture-planner 已能承载大部分流程。

### 方案 C：在现有 workflow 中加入反馈吸纳触发器

在 always-on repository policy 和 prompt-surface / architecture-planner / black-team-review 的边界中增加最小触发协议：识别纠偏后暂停惯性执行，先写 Experience，再判断是否需要 Proposal，最后用 review 攻击升级是否过度。

优点：复用现有 owner，不新增抽象；能形成从 Experience 到 Proposal 到 Review 的闭环。

缺点：需要小心避免把规则写散；必须明确每个 owner 只承担自己的部分。

## 推荐方案

采用方案 C。

理由：Feedback ingestion 是横跨 Experience、Proposal、prompt surface 和 review 的 workflow 能力，但当前不需要新 design primitive 或新 skill。最小实现应让现有 owner 协作：repository policy 负责触发停顿，prompt-surface 负责写作归属，architecture-planner 负责提案，black-team-review 负责攻击过度升级。

## 边界与所有权

| 边界 | 职责 |
| ---- | ---- |
| Repository policy | 定义用户纠偏触发时必须暂停惯性执行，并判断执行失误或 workflow 缺口。 |
| Documentation standards | 保持 Experience 写作质量，不让纠偏记录变成道歉或过程流水。 |
| Prompt surface skill | 判断纠偏样本应进入 Experience、instruction、skill、shared asset、checker 还是 pending。 |
| Architecture planner | 当纠偏暴露 workflow 缺口时，生成 proposal 和 implementation handoff。 |
| Black-team review | 攻击是否过度泛化、是否把一次判断写成永久规则、是否把可选字段伪装成必填字段。 |
| Doc checker | 只承载可机械判断、复发成本高、误报边界清楚的规则。 |

## 第一实施切片

目标语义：用户明确指出 agent 没有理解理念、没有按 workflow、反复写废话或体系可能有问题时，agent 不再只修当前错，而是启动 feedback ingestion 路径。

跨越 owner：

- Repository policy：加入 feedback trigger 和暂停判断要求。
- Prompt surface skill：补充纠偏样本归属判断和升级边界。
- Documentation standards：明确 Experience 记录应保存未对齐点、原因、复发条件和待攻击问题。
- Black-team review：补充 review focus，攻击纠偏提炼是否过度。
- Experience：保留当前样本作为证据。

完成条件：

- 用户纠偏触发条件能被 always-on policy 看到。
- 写入 Experience 的内容有结构化要求，不是道歉或即时解释。
- 进入 instruction、skill 或 checker 前必须经过提炼判断。
- Review 明确攻击过度泛化和 owner 错配。

排除范围：

- 不新增 feedback-ingestion skill。
- 不新增 checker。
- 不实现自动分类器。
- 不把当前 Experience 样本迁成硬规则。

## 测试与验证

- 文档变更使用 `deno task --cwd .github/skills/doc-validation check:docs`。
- Prompt surface 变更使用 `git diff --check -- .github .ousia README.md`。
- Review 使用 `black-team-review` 的 `subject: 设计提案`、`mode: diff`，重点攻击过度泛化和 owner 错配。

## 兼容性与回滚

该切片只改变 prompt surface 和 design facts，不改变 installer 行为或 public CLI。若触发条件过宽，可以回滚 repository policy 的触发句，保留 Experience 和 Architecture 事实继续收集样本。

## Review Focus

- 触发条件是否过宽，导致普通用户反馈都被流程化。
- 是否把 Experience、Proposal、Instruction、Skill、Checker 的 owner 混在一起。
- 是否仍允许用最终解释替代 Experience 记录。
- 是否要求每次纠偏都升级成规则。
- 是否能防止“删除冗余文件”被误升级成特化 checker。
- 是否能防止默认 subagent 启动传空 `model`、省略自身同名模型或误归因同名模型启动失败。
