import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { makeTempProject } from "./helpers.js";
import { readSourceSnapshot } from "../src/source.js";

test("source snapshot collects installable baseline files", async () => {
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

  assert.ok(paths.includes(".ousia/workflow.json"));
  assert.ok(paths.includes(".ousia/pending.md"));
  assert.ok(paths.includes(".github/instructions/ousia-entry.instructions.md"));
  assert.ok(paths.includes(".github/skills/example/SKILL.md"));
  assert.ok(paths.includes(".ousia/design/proposal/index.md"));
  assert.equal(
    paths.includes(".github/instructions/ext-host.instructions.md"),
    false,
  );
  assert.equal(paths.includes(".ousia/design/proposal/body.md"), false);
});

test("source snapshot rejects collected files not covered by ownership", async () => {
  // Goal: keep source collection and manifest ownership in sync.
  // Scope: unit, source snapshot ownership coverage.
  // Semantics: collected payload files without manifest ownership fail before planning.
  const sourceRoot = await makeSourceRoot({ includeSkillsOwnership: false });
  await writeFile(sourceRoot, ".github/skills/example/SKILL.md", "skill\n");

  await assert.rejects(
    () => readSourceSnapshot(sourceRoot),
    /Source file is not covered by Ousia manifest ownership: \.github\/skills\/example\/SKILL\.md/,
  );
});

test("source snapshot reports missing manifest", async () => {
  // Goal: fail fast when the install source is not an Ousia source root.
  // Scope: unit, source snapshot boundary.
  // Semantics: missing .ousia/workflow.json rejects before collecting payload.
  const sourceRoot = await makeTempProject("ousia-source-missing-");

  await assert.rejects(() => readSourceSnapshot(sourceRoot), /ENOENT/);
});

async function makeSourceRoot(
  options: { includeSkillsOwnership?: boolean } = {},
): Promise<string> {
  const root = await makeTempProject("ousia-source-fixture-");
  const includeSkillsOwnership = options.includeSkillsOwnership ?? true;
  await writeFile(
    root,
    ".ousia/workflow.json",
    JSON.stringify(makeSourceCollectionManifest(includeSkillsOwnership), null, 2),
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
      ousiaStructuredProjectFilled: "replace-baseline",
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
  const absolutePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}
