---
name: doc-validation
description: "用于运行项目 workflow 选择的文档验证：Markdown 链接、编号文档约定、Deno doc checker 改动、workflow instructions、skills，或文档改动后的最终报告。"
argument-hint: "被改动文件或验证目标"
---

# 文档验证

运行：

```sh
deno task --cwd .github/skills/doc-validation check:docs
```

修改 checker 时运行：

- `deno task --cwd .github/skills/doc-validation fmt:docs-checker --check`
- `deno task --cwd .github/skills/doc-validation check:types`
- `deno task --cwd .github/skills/doc-validation lint:docs-checker`
- `deno task --cwd .github/skills/doc-validation test:docs`
- `deno task --cwd .github/skills/doc-validation check:docs`

## 实现

- [scripts/check-docs.ts](./scripts/check-docs.ts)：CLI root discovery、diagnostics output 和 exit code。
- [scripts/check-docs-lib.ts](./scripts/check-docs-lib.ts)：library entry。
- [scripts/protocol.ts](./scripts/protocol.ts)：protocol constants。
- [scripts/document-tree.ts](./scripts/document-tree.ts)：`.github/**` 和 `.ousia/**` Markdown traversal。
- [scripts/rules.ts](./scripts/rules.ts)：protocol rules。
- [scripts/diagnostics.ts](./scripts/diagnostics.ts)：diagnostic collection 和 formatting。
