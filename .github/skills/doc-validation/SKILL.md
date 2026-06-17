---
name: doc-validation
description: "Use when: running documentation validation selected by the project workflow: Markdown links, numbered document conventions, Deno doc checker changes, workflow instructions, skills, or final reporting after documentation edits."
argument-hint: "changed files or validation goal"
---

# Ousia Documentation Validation

This skill is the command entry for the Ousia documentation protocol. The protocol is defined by [ousia-documentation-standards.instructions.md](../../instructions/ousia-documentation-standards.instructions.md); this skill only owns the CLI command and checker implementation boundaries.

Run the protocol check with one command:

```sh
deno task --cwd .github/skills/doc-validation check:docs
```

The CLI finds the nearest Ousia project root containing `.github/` and `.ousia/`, then scans Markdown under those roots.

## Procedure

1. Inspect the changed files with `git diff --name-only` and, when needed, `git diff --cached --name-only`.
2. Use the completion-check matrix in [.github/instructions/ext-ousia-workflow.instructions.md](../../instructions/ext-ousia-workflow.instructions.md) to decide whether documentation validation applies.
3. Run `deno task --cwd .github/skills/doc-validation check:docs`.
4. If a deterministic check fails, fix the cause and rerun the affected check.
5. In the final response, list the changed surfaces and every check that was run with its result.

## Common Commands

- `deno task --cwd .github/skills/doc-validation fmt:docs-checker --check`
- `deno task --cwd .github/skills/doc-validation check:types`
- `deno task --cwd .github/skills/doc-validation lint:docs-checker`
- `deno task --cwd .github/skills/doc-validation test:docs`
- `deno task --cwd .github/skills/doc-validation check:docs`

## Implementation Boundaries

- [scripts/check-docs.ts](./scripts/check-docs.ts) is only the CLI boundary: find the Ousia project root, print diagnostics, and choose the exit code.
- [scripts/check-docs-lib.ts](./scripts/check-docs-lib.ts) is the public library boundary: read the document tree, run protocol rules, and return a result.
- [scripts/protocol.ts](./scripts/protocol.ts) owns parser constants for the protocol defined in the documentation instruction.
- [scripts/document-tree.ts](./scripts/document-tree.ts) owns filesystem traversal across `.github/**` and `.ousia/**` and path normalization.
- [scripts/rules.ts](./scripts/rules.ts) owns validation rules. Rules consume the scanned document tree; they should not perform broad filesystem traversal.
- [scripts/diagnostics.ts](./scripts/diagnostics.ts) owns diagnostic collection and output formatting.

Change checker TypeScript only after changing the protocol in the documentation instruction. Keep project-specific history, migration exceptions, and one-off topology out of the checker.
