import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installOusia } from "../src/installer.js";
import { readSourceSnapshot } from "../src/source.js";

const repoRoot = path.resolve(process.cwd(), "../..");

test("fresh install writes Ousia workflow files", async () => {
  const targetRoot = await makeTempProject();
  const result = await installOusia({ sourceRoot: repoRoot, targetRoot });

  assert.equal(result.plan.blocked, false);
  assert.ok(result.written.includes(".ousia/workflow.json"));
  assert.ok(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
  assert.equal(await exists(path.join(targetRoot, ".ousia/workflow.json")), true);
});

test("dry run reports creates without writing", async () => {
  const targetRoot = await makeTempProject();
  const result = await installOusia({ sourceRoot: repoRoot, targetRoot, dryRun: true });

  assert.equal(result.plan.blocked, false);
  assert.equal(result.written.length, 0);
  assert.equal(await exists(path.join(targetRoot, ".ousia/workflow.json")), false);
});

test("reinstall detects modified Ousia-owned file and writes nothing", async () => {
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const skillPath = path.join(targetRoot, ".github/skills/prompt-surface/SKILL.md");
  await fs.writeFile(skillPath, "local edit\n", "utf8");

  const result = await installOusia({ sourceRoot: repoRoot, targetRoot });

  assert.equal(result.plan.blocked, true);
  assert.equal(result.written.length, 0);
  assert.equal(await fs.readFile(skillPath, "utf8"), "local edit\n");
  assert.ok(result.plan.items.some((item) => item.relativePath === ".github/skills/prompt-surface/SKILL.md" && item.action === "conflict"));
});

test("existing structured project-filled file reports unsupported merge", async () => {
  const targetRoot = await makeTempProject();
  await fs.mkdir(path.join(targetRoot, ".ousia"), { recursive: true });
  await fs.writeFile(path.join(targetRoot, ".ousia/index.md"), "project content\n", "utf8");

  const result = await installOusia({ sourceRoot: repoRoot, targetRoot });

  assert.equal(result.plan.blocked, true);
  assert.ok(result.plan.items.some((item) => item.relativePath === ".ousia/index.md" && item.action === "unsupported-merge"));
  assert.equal(await fs.readFile(path.join(targetRoot, ".ousia/index.md"), "utf8"), "project content\n");
});

test("source snapshot excludes non-index proposal files", async () => {
  const source = await readSourceSnapshot(repoRoot);
  assert.equal(source.files.some((file) => file.relativePath.endsWith("lazy-load-engineering-skills.md")), false);
  assert.equal(source.files.some((file) => file.relativePath === ".ousia/design/proposal/index.md"), true);
});

test("source snapshot keeps support files and excludes repository policy", async () => {
  const source = await readSourceSnapshot(repoRoot);
  assert.equal(source.files.some((file) => file.relativePath === ".github/instructions/ext-ousia-workflow.instructions.md"), false);
  assert.equal(source.files.some((file) => file.relativePath === ".github/skills/doc-validation/scripts/check-docs.ts"), true);
});

async function makeTempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-install-"));
  await fs.writeFile(path.join(root, "README.md"), "# Minimal Project\n", "utf8");
  return root;
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}