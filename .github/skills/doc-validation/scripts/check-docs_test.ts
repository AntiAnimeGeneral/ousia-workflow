import { checkDocs } from "./check-docs-lib.ts";
import { deno } from "./deno-runtime.ts";

deno.test("accepts a coherent Ousia documentation tree", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        '---\napplyTo: "**"\ndescription: "Example instruction."\n---\n\n# Example Instruction\n\nSee [pending.md](../../.ousia/pending.md).\n',
      ".ousia/pending.md": "# Pending\n",
      ".ousia/design/00-alpha.md":
        "# 00 Alpha\n\nSee [01-beta.md](./01-beta.md).\n",
      ".ousia/design/01-beta.md": "# 01 Beta\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [],
      );
    },
  );
});

deno.test("rejects a missing Ousia documentation root", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        ["document root not found: .ousia"],
      );
    },
  );
});

deno.test("rejects broken markdown links", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n\nSee [missing.md](./missing.md).\n",
      ".ousia/pending.md": "# Pending\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "broken markdown link: .github/instructions/ousia-example.instructions.md -> ./missing.md",
        ],
      );
    },
  );
});

deno.test("rejects Markdown links whose text is not the target filename", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n\nSee [Pending](../../.ousia/pending.md).\n",
      ".ousia/pending.md": "# Pending\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "markdown link text does not match target filename: .github/instructions/ousia-example.instructions.md has [Pending] -> pending.md",
        ],
      );
    },
  );
});

deno.test("ignores protocol examples inside Markdown code spans", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n\nUse `[label](./missing.md)` and ``[index.md](./index.md)`` only as prose. Example `10-old.md` is also prose.\n",
      ".ousia/pending.md": "# Pending\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [],
      );
    },
  );
});

deno.test("rejects numbered H1 mismatch", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n",
      ".ousia/pending.md": "# Pending\n",
      ".ousia/design/00-alpha.md": "# 01 Alpha\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        ["filename/H1 number mismatch: .ousia/design/00-alpha.md has H1 01"],
      );
    },
  );
});

deno.test("rejects unknown bare numbered Markdown filenames", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n",
      ".ousia/pending.md":
        "# Pending\n\nOld name 10-compatibility.md should fail.\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "unknown numbered markdown filename reference in .ousia/pending.md: 10-compatibility.md",
        ],
      );
    },
  );
});

deno.test("rejects non-continuous numbered files in every directory", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n",
      ".ousia/pending.md": "# Pending\n",
      ".ousia/design/00-alpha.md": "# 00 Alpha\n",
      ".ousia/design/02-gamma.md": "# 02 Gamma\n",
      ".ousia/experience/01-late.md": "# 01 Late\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "numbered markdown files are not continuous in .ousia/design: expected 00, 01, got 00, 02",
          "numbered markdown files are not continuous in .ousia/experience: expected 00, got 01",
        ],
      );
    },
  );
});

deno.test("rejects prose or rules in Ousia index files", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n",
      ".ousia/design/architecture/index.md":
        "# Architecture Index\n\nThis is a rule paragraph.\n\n## 入口\n\n| 入口 | 摘要 |\n| ---- | ---- |\n| [workflow.md](./workflow.md) | 当前架构事实。 |\n\n- rules are not index content\n",
      ".ousia/design/architecture/workflow.md": "# Workflow\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "non-index content in .ousia index file: .ousia/design/architecture/index.md:3",
          "non-index content in .ousia index file: .ousia/design/architecture/index.md:11",
        ],
      );
    },
  );
});

deno.test("rejects redundant Ousia root index", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n",
      ".ousia/index.md":
        "# Ousia Adapter Instance\n\n## 入口\n\n| 入口 | 摘要 |\n| ---- | ---- |\n| [pending.md](./pending.md) | 当前未归档事项。 |\n",
      ".ousia/pending.md": "# Pending\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        ["redundant Ousia skeleton index is not allowed: .ousia/index.md"],
      );
    },
  );
});

async function withTempDocs(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await deno.makeTempDir();
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const path = `${root}/${relativePath}`;
      await deno.mkdir(dirname(path), { recursive: true });
      await deno.writeTextFile(path, content);
    }
    await run(root);
  } finally {
    await deno.remove(root, { recursive: true });
  }
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

function assertEquals<T>(actual: T, expected: T): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}
