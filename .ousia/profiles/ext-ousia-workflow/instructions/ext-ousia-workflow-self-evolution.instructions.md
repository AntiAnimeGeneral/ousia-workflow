---
applyTo: ".github/instructions/**/*.instructions.md,.github/skills/**/SKILL.md,.github/skills/_shared/**/*.md,.ousia/**,README.md,fixtures/**"
description: "Ousia Workflow self-adapter：约束 workflow 项目自身的发布、升级、dogfood、fixture、迁移和自我迭代规则。"
---

# Ousia Workflow Self Adapter

这些规则只用于开发 Ousia Workflow 自身。普通项目安装 Ousia Workflow 后不应加载本 instruction；它们只需要通用 prompt 元能力和自己的 `.ousia/**` adapter instance。

本 adapter 保存 Ousia Workflow 作为项目时的自我演进规则：发布、版本、dogfood、fixture、migration、upgrade tooling、schema 兼容和 workflow 自我验证。不要把这些规则写回通用 `ousia-prompt-architecture.instructions.md`，也不要让普通项目 adapter 继承本项目的仓库治理细节。

## 职责边界

- 通用 prompt 元规则属于 `.github/instructions/ousia-prompt-architecture.instructions.md`。
- Ousia Workflow 自身的发布、迁移、fixture、dogfood、schema 兼容和 upgrade tooling 规则属于本 self-adapter。
- Workflow core 的 active facade、shared modes 和 base instructions 不应知道 Ousia Workflow 仓库如何发布自己。
- `.ousia/**` 在本仓库中是 Ousia Workflow 项目自己的 installed adapter instance；它不是普通项目的示例正文，也不是通用 core 默认内容。
- Profile definition 也必须放在 `.ousia/**` 内的受控 slot 中；不要再建立与 `.ousia/**` 并列的 adapter 目录。

## Self-Evolution Rules

- Ousia Workflow 自身的改动必须同时说明它改变的是 framework core、profile skeleton、installed `.ousia/**` slot、validation behavior、upgrade policy、fixture，还是文档解释。
- 修改 `.ousia/workflow.json`、profile skeleton、ownership class 或 upgrade policy 时，必须说明升级兼容性：现有安装如何迁移、哪些文件可替换、哪些 section merge、哪些 local overrides 会冲突。
- 新增 core instruction、skill、shared mode 或 validation rule 前，先证明它不是某个 profile definition 规则或 `.ousia/**` 项目事实。
- 新增 profile slot 前，先说明它允许哪类项目事实稳定放置，以及 agent 何时读取它。
- 删除或移动 self-adapter 规则时，先确认对应语义已经进入通用 core、profile definition、installed `.ousia/**` owning area 或 pending；不要让可复用教训消失。
- Dogfood 改动必须避免把本仓库的临时迁移状态写成所有项目的默认规范。

## Fixture And Validation Rules

- `fixtures/minimal-project/**` 应证明 core 不依赖 Ousia OS、Ousia Workflow self-adapter、legacy docs 或本仓库发布流程。
- Ousia Workflow self-fixture 应证明本仓库可以作为一个普通 installed adapter instance 使用 Ousia-defined slots。
- Adapter smoke fixtures 应证明 profile definition 安装为 `.ousia/**` 后通过 manifest/profile routing 接入 core，而不是通过 hardcoded paths。
- Validation route 必须声明命令、覆盖风险和剩余风险。Checker 只执行 owning instruction 定义的稳定协议。
- 缺少验证环境时，说明未覆盖的风险；不要用 repo-local config 或 legacy project docs check 作为默认路径。

## Migration And Upgrade Rules

- 每个迁移计划必须标明 ownership class：Ousia-owned、Ousia-structured/project-filled、project-owned、profile definition slot、installed adapter instance 或 local override。
- Ousia-owned assets 可以在未修改时替换；本地修改未登记时必须报告冲突。
- Ousia-structured/project-filled assets 按稳定 section 合并，保留项目填充内容。
- Project-owned assets 只路由和验证，默认不改写正文。
- Local overrides 永不静默覆盖；必须有覆盖对象、原因和退出条件。
- 迁移清单可以保留历史路径作为证据，但 active core 不得重新依赖这些历史路径。

## Review Focus

- 通用 core 是否混入 Ousia Workflow 自身发布、迁仓、dogfood 或 fixture 细节。
- Self-adapter 是否把本仓库历史迁移状态伪装成所有项目的默认规则。
- `.ousia/**` 是否仍表达 Ousia-defined slots，而不是项目自由 overlay。
- Adapter/profile 是否通过 Ousia-defined routing 接入 core，而不是 hardcoded paths。
- Upgrade ownership classes 是否互斥、自洽，并足以支持 replace、section merge、route-only 和 override conflict。
- 新增 validation 是否说明覆盖风险、不覆盖风险和缺少环境时的 residual risk。