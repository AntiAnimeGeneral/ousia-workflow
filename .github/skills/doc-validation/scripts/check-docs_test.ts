import { checkDocs } from "./check-docs-lib.ts";
import { deno } from "./deno-runtime.ts";

deno.test("accepts a coherent Ousia documentation tree", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        '---\napplyTo: "**"\ndescription: "Example instruction."\n---\n\n# Example Instruction\n\nSee [index.md](../../.ousia/index.md).\n',
      ".ousia/index.md":
        "# Ousia Adapter Instance\n\nSee [ousia-example.instructions.md](../.github/instructions/ousia-example.instructions.md).\n",
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
      ".ousia/index.md": "# Ousia Adapter Instance\n",
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

deno.test("rejects stale displayed Markdown filenames", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n\nSee [README.md](../../.ousia/index.md).\n",
      ".ousia/index.md": "# Ousia Adapter Instance\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "markdown link text does not match target filename: .github/instructions/ousia-example.instructions.md has [README.md] -> index.md",
        ],
      );
    },
  );
});

deno.test("rejects numbered H1 mismatch", async () => {
  await withTempDocs(
    {
      ".github/instructions/ousia-example.instructions.md":
        "# Example Instruction\n",
      ".ousia/index.md": "# Ousia Adapter Instance\n",
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
      ".ousia/index.md":
        "# Ousia Adapter Instance\n\nOld name 10-compatibility.md should fail.\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "unknown numbered markdown filename reference in .ousia/index.md: 10-compatibility.md",
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
      ".ousia/index.md": "# Ousia Adapter Instance\n",
      ".ousia/design/00-alpha.md": "# 00 Alpha\n",
      ".ousia/design/02-gamma.md": "# 02 Gamma\n",
      ".ousia/profiles/01-late.md": "# 01 Late\n",
    },
    async (root) => {
      const result = await checkDocs(root);
      assertEquals(
        result.errors.map((diagnostic) => diagnostic.message),
        [
          "numbered markdown files are not continuous in .ousia/design: expected 00, 01, got 00, 02",
          "numbered markdown files are not continuous in .ousia/profiles: expected 00, got 01",
        ],
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
