---
applyTo: "design/**/*.md,**/README.md,**/*.md"
description: "文档标准：写作风格、文档归属、设计文档和文档结构 hygiene 规则。"
---

# 文档标准

## 职责边界

- 本 instruction 只管 Markdown 写作质量、文档归档语义和 Ousia 文档协议。
- Prompt surface 的 owner、读取路由和 skill 边界由 `.github/instructions/ousia-prompt-architecture.instructions.md` 与 `prompt-surface` skill 负责。

## 写作标准

- 面向第一次接触项目的人写文档。优先呈现当前架构、设计理由、边界和下一步演进，而不是实现流水账。
- 历史过程只有在解释当前兼容入口、删除条件、风险或迁移步骤时才进入长期文档；其他过程记录进入 Experience 或外部 changelog。
- 进度、当前状态和 owning design 文档应默认写“现在是什么样、谁拥有状态、下一步从哪里接手”。不要写“刚从哪里迁来、之前怎么组织、这次 agent 做了什么”，除非这些历史事实解释了仍存在的兼容入口、删除条件、风险或迁移步骤。
- Review 文档改动时，若叙述不能帮助下一位接手者理解当前结构、当前约束、剩余风险或可执行下一步，应作为文档噪音提出 finding；不要把它降级成可选 follow-up。
- 描述外部库或参考实现时，重点写职责、适用边界、不适用原因、license/维护风险和本项目采用策略。不要把“用了某个 crate”写成项目成就。
- 只有当“当前”能帮助读者决策时才使用它，例如当前支持的目标架构、runner 覆盖范围、尚未冻结的 ABI。不要用它记录 agent 刚完成的编辑。
- 候选方案、取舍证据和未采纳理由进入 Proposal 或 Experience；稳定结论进入 Architecture。不要让同一概念在多个 owner 重复定义。
- 用户指出的语义偏移、噪音、边界混乱或复发风险先记录到 Experience。只有已经稳定为跨项目硬规则时，才提炼进 instruction。
- Experience 中的用户纠偏记录应保存未对齐点、错误形态、原因、复发条件和后续需要攻击的问题；不要写成道歉、辩护、即时修复说明或过程流水。
- 设计文档描述临时实现、stub、placeholder、diagnostic scaffolding、固定容量脚手架或 fake/no-op backend 时，必须明确它不是稳定结论，并写出不可依赖语义、最终 owner/状态、退出条件和验证要求。不要把临时实现写成当前架构事实，除非它解释了仍存在的风险和删除条件。
- 架构文档中如果文字难以清楚表达交互、流程、状态、结构或系统边界，应优先使用合适的 Mermaid 图：`sequenceDiagram` 表达时间线交互和线程生命周期，`flowchart` 表达数据流和决策分支，`stateDiagram-v2` 表达状态机，`classDiagram` 表达数据结构关系，`C4Context` 或 `graph` 表达系统架构。
- 面向本项目维护者的正文默认使用中文。允许保留文件名、命令、API、协议字段、skill/instruction 名称和已经定义为框架术语的英文；不要用整句英文、半英半中的说明或迁移口号表达可用中文说明的规则。
- 新增或保留英文术语时，必须能说明它是稳定术语、外部接口名、代码/文件标识，或比中文翻译更不容易歧义；否则用中文表达。

## Ousia 文档协议

- 默认文档根是 `.github/**` 和 `.ousia/**`。
- Markdown 链接必须可解析。
- 指向 Markdown 文件的链接文本必须等于目标文件名，例如 `[index.md](./index.md)`。
- 编号 Markdown 文件使用 `NN-*.md` 文件名。
- 编号 Markdown 文件的 H1 必须以相同编号开头。
- 同一目录内的编号 Markdown 文件必须从 `00` 开始连续递增，不能跳号或重复。
- 裸露的 `NN-*.md` 文本引用必须指向当前存在的 Markdown 文件。
- `.ousia/**/index.md` 只能作为索引：允许 H1/H2、空行和 Markdown 表格；不写规则、职责边界、填充规则、review focus、项目事实正文、段落或列表。
- 示例 Markdown link 写在 code span 中。

协议变化顺序：instruction -> checker -> tests。

## 校验

- `deno task --cwd .github/skills/doc-validation check:docs`
- 扫描 `.github/**` 和 `.ousia/**`。
