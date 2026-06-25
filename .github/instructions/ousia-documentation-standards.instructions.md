---
applyTo: "design/**/*.md,**/README.md,**/*.md"
description: "文档协议：Markdown 链接、编号文档、index-only 约束、checker 路线和 documentation-authoring 路由。"
---

# 文档协议

## 职责边界

- 本 instruction 只管 Markdown 协议、checker-owned 规则、验证路线和文档写作入口路由。
- 文档正文的写作目标、Architecture/Proposal/Experience/README 归属、Mermaid 图、文档噪音和 reviewer obligation 归 [SKILL.md](../skills/documentation-authoring/SKILL.md)。
- Prompt surface 的 owner、读取路由和 skill 边界由 `.github/instructions/ousia-prompt-architecture.instructions.md` 与 `prompt-surface` skill 负责。

## 读取路由

- 编写或审查 Markdown、README、`.ousia/design/**` 或其他项目文档正文时，读取 [SKILL.md](../skills/documentation-authoring/SKILL.md)。
- 修改 prompt surface Markdown 时，同时读取 `ousia-prompt-architecture` 和 `prompt-surface`；documentation-authoring 只约束文档表达质量，不拥有 prompt owner、输入输出或读取时机。
- 修改文档协议或 checker-owned 规则时，必须同步检查 [SKILL.md](../skills/doc-validation/SKILL.md) 和 checker tests。

## Ousia 文档协议

- 默认文档根是 `.github/**` 和 `.ousia/**`。
- Markdown 链接必须可解析。
- 指向 Markdown 文件的链接文本必须等于目标文件名，例如 `[index.md](./index.md)`。
- 编号 Markdown 文件使用 `NN-*.md` 文件名。
- 编号 Markdown 文件的 H1 必须以相同编号开头。
- 同一目录内的编号 Markdown 文件必须从 `00` 开始连续递增，不能跳号或重复。
- 裸露的 `NN-*.md` 文本引用必须指向当前存在的 Markdown 文件。
- `.ousia/**/index.md` 只能作为索引：允许 H1/H2、空行、Markdown 表格和 Ousia managed region HTML marker；不写规则、职责边界、填充规则、review focus、项目事实正文、段落或列表。
- 示例 Markdown link 写在 code span 中。

协议变化顺序：instruction -> checker -> tests。

## 校验

- `deno task --cwd .github/skills/doc-validation check:docs`
- 扫描 `.github/**` 和 `.ousia/**`。
