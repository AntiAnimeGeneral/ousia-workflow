---
applyTo: ".github/instructions/**/*.instructions.md,.github/skills/**/SKILL.md,.github/skills/_shared/**/*.md"
description: "项目元架构规范：边界性、正交可组合性、简约性、流程化闭环和自我迭代，覆盖代码、文档和 prompt 系统。"
---

# 项目元架构规范

这些规则用于设计、review 和演进 Ousia OS 的代码、文档、instructions、skills、shared assets、design-owned evidence 和 workflow。它只规定 prompt 系统也要遵守的通用架构原则；Ousia workflow core 的当前资产映射由 [02-agent-harness-architecture.md](../../design/implementation/02-agent-harness-architecture.md) 维护。该文件名保留 `agent-harness` 是兼容旧链接。

这是一套递归架构规则。项目实现、设计文档、测试策略和 prompt workflow 都是系统构件；任何一层都不能用“只是工具”“只是文档”“只是 prompt”逃避边界和可验证性要求。

## 核心原则

- 边界优先：每个模块、文档、prompt 文件和 workflow 环节都应有清晰职责。实现层、设计层、规范层、reference 层和 validation 层不应互相偷职责。
- 正交可组合：外部维度应少而稳定；新差异优先投影到已有 `scope`、`focus`、模块边界、硬规范或经验/证据库，而不是新增入口、新层级或新维度。
- 简约优雅：能用一个稳定 facade、一个清晰模块边界或少量索引解决的问题，不拆成多套角色、透镜、contracts、中转层或私有框架。
- 概念克制：不要为普通职责发明黑话、品牌化名词或只在当前 prompt 体系内成立的术语。新概念必须降低理解成本，并能用现有职责、owner、输入输出和边界解释；解释不出来时，优先使用普通领域词或直接描述职责。
- 命名前缀：workflow 项目命名为 `ousia`。通用 workflow 实现、通用 instruction、通用 skill、通用 mode 和通用 validation 能力使用 `ousia-` 前缀；项目特化、扩展、插件和 Ousia OS adapter 投影使用 `ext-ousia-` 前缀。`harness` 只指外部 agent runtime 或 execution carrier。
- 流程化闭环：非平凡设计和实现应能进入 proposal -> review -> implementation -> review 的闭环；每一环有输入、输出、停止条件和下一步。
- 纵向闭环：非平凡改动应推进一个可验证的 vertical slice，从用户目标或项目语义穿过 owning doc、状态 owner、边界 API、实现、测试和验证。边界清理、命名修正、模块拆分和 prompt 调整必须服务于声明的纵向切片；如果当前工作只会继续制造横向边界整理，先收窄目标或交回架构规划，不要把边界调整伪装成进度。
- 自我迭代：当用户指出语义偏移、边界错位、过度抽象、实现坏味道或 prompt 失效时，应把可复用教训固化到合适层，而不是只修当前文本或当前代码。
- Project extension：未来 `ousia workflow install` 会生成 `.ousia/**` 作为 project-local extension surface，用于项目特化规范、adapter manifest、project design layout、research/review routing 和 pending area。Ousia OS 当前并行保留既有 `design/**` 作为迁移来源。
- 待归档区：Ousia workflow 需要一个 pending area 承接尚未归档到唯一 owner 的教训、迁移事项和 owner 候选。Ousia 当前实现是 `.ousia/pending.md`；当前为空，新增条目必须有退出条件，不作为长期规范源。

## 递归应用

- Prompt 要求代码实现具备边界和可组合性；prompt 本身作为实现，也必须具备边界和可组合性。
- Workflow 要求代码实现可 review、可验证、可回滚；workflow 本身也必须可 review、可验证、可演进。
- `.ousia/design/**` 的 research/review 区域要求设计和实现避免语义偏移；它自身也要避免职责偏移，不能变成隐藏规范源、skills 扩展层或第二套入口 API。
- Review 要攻击实现中的抽象错位；review prompt 也要攻击自身体系中的抽象错位。
- 如果某条原则同时适用于代码、文档和 prompt，它属于 `.github/instructions/**`；不要只放在 evidence doc 或某个 skill 里。
- 如果某条教训还不能确定归属，先进入暂存区；归属明确后必须移动到唯一 owner，并从暂存区删除。

## 项目实现投影

- 代码模块围绕变化原因和状态所有权划边界，不按文件大小或形式主义分层。
- 公共抽象必须保存语义、稳定边界或减少真实重复决策；不要增加只转发调用的薄辅助层或私有小框架。
- 架构和实现切片应优先垂直穿过真实 owner、调用路径和测试边界。只有当横向边界修正是该切片的必要前置，且有明确停止条件和验证方式时，才把它纳入当前 diff。
- `.ousia/**` 是 project adapter 的标准扩展目录；`.ousia/design/**` 是其中的项目设计目标布局。Ousia OS 当前把既有 `design/**` 作为迁移来源。产品文档、implementation docs、proposal 和 design-owned evidence 要各有 owner，稳定结论最终迁入对应 design area，快速查证经验进入 Research area。Workflow 仍由 `WorkflowPolicy` 拥有。
- 测试和验证是闭环的一部分，不是实现后的装饰；每个非平凡变更都应说明验证覆盖了什么风险。

## 职责分层

- 硬规范、入口界面、任务模式、project design areas 和验证规则必须有不同 owner。
- 硬规范承载跨角色必须遵守的规则；入口界面承载可发现接口、输入维度、流程和输出要求。
- 任务模式只描述任务形状、输入重点和停止条件；不要复制硬规范或项目设计正文。
- `.ousia/design/research/**` 承载查证路线、review attacks 和 planning prompts；不要变成隐藏规范源、skills 扩展层或第二套项目设计文档。
- `.ousia/pending.md` 承载待归档教训、归属候选和退出条件；不要把它当作稳定规范、经验/证据库或第二套 project docs。
- Workflow 只承载闭环编排、验证选择和执行载体边界；某个入口的 prompt 内容、输出协议和 handoff packet 归对应入口。
- Ousia 当前文件路径到这些 owner 的映射由 [02-agent-harness-architecture.md](../../design/implementation/02-agent-harness-architecture.md) 声明，不在本通用 instruction 中重复维护。

## 设计检查

修改项目架构、实现边界、文档归属或 prompt 系统前，先问：

- 这是硬规范、入口界面、任务模式、领域经验、实现模块、验证规则，还是一次性说明？
- 这条规则的 owner 是否唯一；以后改它应该去哪一个文件？
- 如果 owner 还不确定，是否应先进入暂存区，并写清退出条件？
- 新增文件是否真的降低复杂度，还是只是把一个概念拆成更多名字。
- 新文件名是否遵守 `ousia-` / `ext-ousia-` 前缀；如果不能判断归属，是否应先进入暂存区而不是发明第三套命名？
- 新增术语是否真的承载新边界，还是把普通职责包装成更难懂的词。
- 新维度是否会和已有 `mode`、`target`、`subject`、`scope`、`focus` 重叠。
- Reference 正文是否具体到证据和攻击问题，而不是泛泛复述规范。
- Review 是否能发现本次 prompt 设计的边界错位、过度抽象、语义漂移和验证盲区。

## Prompt Review Attacks

- 被动 reference 是否写了 `When To Read`、trigger table、外部调用接口或 subagent contract。
- Entry skill 是否承载了整份规范、完整 checklist 或大量 Ousia-specific 正文。
- Shared asset 是否只是薄中转层，不能保存独立语义。
- 新术语是否需要读者先学习一套私有词表才能理解已有职责。
- Workflow 是否混入领域 checklist，导致 always-on instruction 过重。
- 同一个输出协议、handoff packet、验证规则或 reference 读取规则是否出现在多个权威位置。
- 新增入口是否只是旧入口的 subject/mode/focus 组合，应该收回 facade。
- Reference checklist 是否没有 Evidence To Seek 或 Residual Risk Triggers，导致只能机械打勾。

## 自我迭代规则

- 用户指出体系问题时，先定位失效层：产品设计、代码实现、测试、instructions、entry skill、mode、reference、workflow、validation 或一次性任务说明。
- 如果问题是“经过纠正才对齐”的可复用教训，且归属仍需阶段性整理，先写入暂存区，记录错误形态、正确 owner 候选和退出条件。
- 如果用户指出的是所有实现者、reviewer 或未来协作者都应遵守的项目规则，应写入仓库内的 owning instruction、design doc 或 workflow，而不是只写入单个 agent 的长期记忆。
- 如果用户指出的是领域 baseline、reference 对齐或 review 攻击面缺失，应同步 owning instruction、经验/证据库、review attacks 和 owning design docs；不要把领域长期目标偷放进通用入口 instruction 或 facade skill。
- 能通过调整现有层解决时，不新增层。
- 如果问题会反复出现，优先写入 instruction；如果只是 Ousia-specific 查证经验或 attack，写入 design-owned evidence；如果只是某个入口的输出协议，留在该 skill。
- 每个阶段性整理点必须审查暂存区：能归档的移动到唯一 owner，已经被 owner 覆盖的条目从暂存区删除，仍不确定的条目保留并更新退出条件。
- 每次修改 design-owned evidence 后，运行文档校验流程；每次修改 entry skill 或 workflow 后，检查 frontmatter、链接和 stale 旧路径。
- 非平凡架构、实现或 prompt 体系修改完成后，使用 `black-team-review` 审查真实 diff，重点攻击边界性、正交性、简约性和闭环可执行性。
