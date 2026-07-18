---
name: documentation-authoring
description: "用于编写、审查或全局启发扫描 Ousia 文档正文：README、Architecture、Proposal、Experience、设计文档、项目文档、Mermaid 图和文档噪音控制；review 文档 diff 或文档区域时必须参考。"
argument-hint: "文档路径或扫描范围、用户目标、文档 owner、预期读者、审查/扫描重点和当前事实"
---

# 文档编写

本 skill 拥有文档正文的写作流程、内容归属和 reviewer obligation。Markdown
协议、链接规则、编号规则、index-only 规则和 checker 路线仍归
`.github/instructions/ousia-documentation-standards.instructions.md`。

## 范围

- `README.md`
- `.ousia/design/architecture/**/*.md`
- `.ousia/design/proposal/**/*.md`
- `.ousia/design/experience/**/*.md`
- 其他设计文档和项目文档正文
- Prompt surface Markdown 的写作质量；prompt owner 和读取边界仍归
  `prompt-surface`

## 写作目标

- 面向第一次接触项目的人写文档。
- 优先呈现当前架构、设计理由、边界和下一步演进。
- 写“现在是什么样、谁拥有状态、下一步从哪里接手”。
- 历史过程只有在解释当前兼容入口、删除条件、风险或迁移步骤时进入长期文档；其他过程记录进入
  Experience 或外部 changelog。
- 只有当“当前”能帮助读者决策时才使用它，例如当前支持的目标架构、runner
  覆盖范围或尚未冻结的 ABI。

## 内容归属

- Architecture 保存稳定结构、owner、长期设计结论和目标项目形态。
- Proposal 保存候选方案、取舍证据、未采纳理由、实施切片、review focus
  和迁移/回滚计划。
- Proposal 根目录保存仍参与当前决策的提案；`proposal/archive/**`
  保存已关闭提案的决策与结局，只在追溯历史、比较旧决策或查证关闭证据时读取。
- Experience 保存用户纠偏、误读样本、查证路线、review
  attacks、噪音模式和复发风险。
- README 面向入口读者，说明项目用途、结构、常用命令和接手路径。
- `.ousia/**/index.md` 只作为索引；正文事实进入 owning document。

## Proposal 关闭与归档

Proposal
被采纳实施、拒绝、撤回、替代或因前提失效而结束时进入关闭流程。已实施提案只有在声明切片完成、相关验证通过且
implementation review 无阻塞 finding 后才能关闭。

关闭前必须完成以下交接：

- 将稳定结构、owner 和长期设计结论写回 Architecture。
- 将可复用纠偏、失败证据和 review attacks 写回 Experience。
- 将仍需执行的事项移入新 Proposal 或 `.ousia/pending.md`，不得随归档静默丢失。
- 在提案正文保留关闭结局及必要证据；从 Proposal 根索引移除当前入口，将文件移入
  `proposal/archive/**` 并加入归档索引。
- 归档保留原文件名和 H1 编号；Proposal 根目录与 archive
  目录中的编号文件共同组成文档协议定义的连续序列。归档时只移动正文并更新两个索引和指向该文件的链接，不重命名或重排提案。

归档提案不再是当前方案权威，也不默认进入 planning、implementation 或 review
context。需要历史比较或关闭证据时定向读取归档正文。

## 写作规则

- 候选方案、取舍证据和未采纳理由进入 Proposal 或 Experience；稳定结论进入
  Architecture。不要让同一概念在多个 owner 重复定义。
- 用户指出的语义偏移、噪音、边界混乱或复发风险先记录到
  Experience。只有已经稳定为跨项目硬规则时，才提炼进 instruction。
- Experience
  中的用户纠偏记录应保存未对齐点、错误形态、原因、复发条件和后续需要攻击的问题；不要写成道歉、辩护、即时修复说明或过程流水。
- 描述外部库或参考实现时，重点写职责、适用边界、不适用原因、license/维护风险和本项目采用策略。不要把“用了某个
  crate”写成项目成就。
- 设计文档描述临时实现、stub、placeholder、diagnostic
  scaffolding、固定容量脚手架或 fake/no-op backend
  时，必须明确它不是稳定结论，并写出不可依赖语义、最终
  owner/状态、退出条件和验证要求。不要把临时实现写成当前架构事实，除非它解释了仍存在的风险和删除条件。
- 面向本项目维护者的正文默认使用中文。允许保留文件名、命令、API、协议字段、skill/instruction
  名称和已经定义为框架术语的英文；不要用整句英文、半英半中的说明或迁移口号表达可用中文说明的规则。
- 新增或保留英文术语时，必须能说明它是稳定术语、外部接口名、代码/文件标识，或比中文翻译更不容易歧义；否则用中文表达。

## Mermaid 图

架构文档中如果文字难以清楚表达交互、流程、状态、结构或系统边界，应优先使用合适的
Mermaid 图：

- `sequenceDiagram`：时间线交互和线程生命周期。
- `flowchart`：数据流和决策分支。
- `stateDiagram-v2`：状态机。
- `classDiagram`：数据结构关系。
- `C4Context` 或 `graph`：系统架构。

Mermaid 图应服务读者理解，不作为装饰；图中节点和边必须能对应正文中的
owner、状态、数据流、阶段或边界。

## 审查

Reviewer 读取本 skill 后检查：

- 文档是否帮助下一位接手者理解当前结构、当前约束、剩余风险或可执行下一步；否则作为文档噪音提出
  finding。
- 文档是否把实现过程、迁移流水账或 agent 刚完成的步骤写成长期事实。
- Architecture、Proposal、Experience 和 README
  的归属是否清楚，是否重复保存同一概念。
- 临时实现是否明确不可依赖语义、最终 owner、退出条件和验证要求。
- Mermaid 图是否选择了合适图类型，并且确实表达交互、流程、状态、结构或系统边界。
- 英文是否只用于稳定术语或外部标识，正文是否仍能被中文 review。
- Prompt surface Markdown 是否同时遵守 `prompt-surface` 的
  owner、读取时机、输入、输出和退出条件边界。

## 验证

按 repository policy、documentation protocol 和 `doc-validation`
路线选择验证命令；本 skill
只要求收集文档正文改动对应的验证证据、覆盖风险和剩余风险。
