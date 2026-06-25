import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { makeTempProject } from "./helpers.ts";
import { readSourceSnapshot } from "../src/source.ts";

Deno.test("source snapshot collects installable baseline files", async () => {
  // Goal: protect the installer payload surface.
  // Scope: unit, source snapshot collection rules with a fixture source root.
  // Semantics: baseline instructions, skills, skeleton, and design indexes are collected.
  const sourceRoot = await makeSourceRoot();
  await writeFile(
    sourceRoot,
    ".github/instructions/ousia-entry.instructions.md",
    "entry\n",
  );
  await writeFile(
    sourceRoot,
    ".github/instructions/ext-host.instructions.md",
    "host\n",
  );
  await writeFile(sourceRoot, ".github/skills/example/SKILL.md", "skill\n");
  await writeFile(
    sourceRoot,
    ".ousia/design/proposal/index.md",
    "# Proposal\n",
  );
  await writeFile(sourceRoot, ".ousia/design/proposal/body.md", "body\n");

  const source = await readSourceSnapshot(sourceRoot);
  const paths = source.files.map((file) => file.relativePath);

  assert(paths.includes(".ousia/workflow.json"));
  assert(paths.includes(".ousia/pending.md"));
  assert(paths.includes(".github/instructions/ousia-entry.instructions.md"));
  assert(paths.includes(".github/skills/example/SKILL.md"));
  assert(paths.includes(".ousia/design/proposal/index.md"));
  assertEquals(
    paths.includes(".github/instructions/ext-host.instructions.md"),
    false,
  );
  assertEquals(paths.includes(".ousia/design/proposal/body.md"), false);
});

Deno.test("source snapshot installs clean Ousia skeleton content", async () => {
  // Goal: prevent project facts from leaking into target project skeleton files.
  // Scope: unit, source snapshot content normalization.
  // Semantics: pending and design indexes are installed as clean skeletons, not copied source bodies.
  const sourceRoot = await makeSourceRoot();
  await writeFile(
    sourceRoot,
    ".ousia/pending.md",
    "# Pending\n\n## 条目\n\n当前没有 active pending items。\n",
  );
  await writeFile(
    sourceRoot,
    ".ousia/design/proposal/index.md",
    "# Proposal\n\n## 当前提案\n\n| 入口 | 摘要 |\n",
  );

  const source = await readSourceSnapshot(sourceRoot);
  const contentByPath = new Map(
    source.files.map((file) => [
      file.relativePath,
      new TextDecoder().decode(file.content),
    ]),
  );

  assertEquals(
    contentByPath.get(".ousia/pending.md"),
    '# Pending\n\n<!-- ousia:managed:start id="pending-items" -->\n## 条目\n<!-- ousia:managed:end id="pending-items" -->\n',
  );
  assertEquals(
    contentByPath.get(".ousia/design/proposal/index.md"),
    '# Proposal\n\n<!-- ousia:managed:start id="proposal-current" -->\n## 当前提案\n<!-- ousia:managed:end id="proposal-current" -->\n\n<!-- ousia:managed:start id="proposal-completed" -->\n## 已完成提案\n<!-- ousia:managed:end id="proposal-completed" -->\n',
  );
});

Deno.test(
  "source snapshot rejects collected files not covered by ownership",
  async () => {
    // Goal: keep source collection and manifest ownership in sync.
    // Scope: unit, source snapshot ownership coverage.
    // Semantics: collected payload files without manifest ownership fail before planning.
    const sourceRoot = await makeSourceRoot({ includeSkillsOwnership: false });
    await writeFile(sourceRoot, ".github/skills/example/SKILL.md", "skill\n");

    await assertRejects(
      () => readSourceSnapshot(sourceRoot),
      Error,
      "Source file is not covered by Ousia manifest ownership: .github/skills/example/SKILL.md",
    );
  },
);

Deno.test("source snapshot reports missing manifest", async () => {
  // Goal: fail fast when the install source is not an Ousia source root.
  // Scope: unit, source snapshot boundary.
  // Semantics: missing .ousia/workflow.json rejects before collecting payload.
  const sourceRoot = await makeTempProject("ousia-source-missing-");

  await assertRejects(
    () => readSourceSnapshot(sourceRoot),
    Deno.errors.NotFound,
  );
});

async function makeSourceRoot(
  options: { includeSkillsOwnership?: boolean } = {},
): Promise<string> {
  const root = await makeTempProject("ousia-source-fixture-");
  const includeSkillsOwnership = options.includeSkillsOwnership ?? true;
  await writeFile(
    root,
    ".ousia/workflow.json",
    JSON.stringify(
      makeSourceCollectionManifest(includeSkillsOwnership),
      null,
      2,
    ),
  );
  await writeFile(root, ".ousia/pending.md", "pending\n");
  return root;
}

function makeSourceCollectionManifest(includeSkillsOwnership: boolean) {
  return {
    schemaVersion: "0.1.0",
    workflow: { name: "ousia-workflow", version: "0.1.0" },
    project: { name: "test" },
    ownership: {
      ousiaOwned: [
        ".github/instructions/ousia-*.instructions.md",
        ...(includeSkillsOwnership ? [".github/skills/**"] : []),
        ".ousia/workflow.json",
      ],
      ousiaStructuredProjectFilled: [
        ".ousia/pending.md",
        ".ousia/design/*/index.md",
      ],
      projectOwned: [],
      localOverrides: [".ousia/overrides/**"],
    },
    upgradePolicy: {
      ousiaOwned: "replace-baseline",
      ousiaStructuredProjectFilled: "replace-managed-regions",
      projectOwned: "route-and-validate-only",
      localOverrides: "never-overwrite",
    },
    validation: {
      docValidationConfig: null,
      requiredChecks: ["git diff --check"],
    },
  };
}

async function writeFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = join(root, relativePath);
  await Deno.mkdir(dirname(absolutePath), { recursive: true });
  await Deno.writeTextFile(absolutePath, content);
}
