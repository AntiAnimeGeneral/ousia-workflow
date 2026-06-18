---
name: doc-validation
description: "Use when: running documentation validation selected by the project workflow: Markdown links, numbered document conventions, Deno doc checker changes, workflow instructions, skills, or final reporting after documentation edits."
argument-hint: "changed files or validation goal"
---

# Documentation Validation

Run:

```sh
deno task --cwd .github/skills/doc-validation check:docs
```

For checker changes, run:

- `deno task --cwd .github/skills/doc-validation fmt:docs-checker --check`
- `deno task --cwd .github/skills/doc-validation check:types`
- `deno task --cwd .github/skills/doc-validation lint:docs-checker`
- `deno task --cwd .github/skills/doc-validation test:docs`
- `deno task --cwd .github/skills/doc-validation check:docs`

## Implementation

- [scripts/check-docs.ts](./scripts/check-docs.ts): CLI root discovery, diagnostics output, exit code.
- [scripts/check-docs-lib.ts](./scripts/check-docs-lib.ts): library entry.
- [scripts/protocol.ts](./scripts/protocol.ts): protocol constants.
- [scripts/document-tree.ts](./scripts/document-tree.ts): `.github/**` and `.ousia/**` Markdown traversal.
- [scripts/rules.ts](./scripts/rules.ts): protocol rules.
- [scripts/diagnostics.ts](./scripts/diagnostics.ts): diagnostic collection and formatting.
