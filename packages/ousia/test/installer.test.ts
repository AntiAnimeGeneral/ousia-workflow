import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installOusia, installSnapshot } from "../src/installer.js";
import { readSourceSnapshot } from "../src/source.js";

const repoRoot = path.resolve(process.cwd(), "../..");

test("fresh install writes Ousia workflow files", async () => {
  const targetRoot = await makeTempProject();
  const result = await installOusia({ sourceRoot: repoRoot, targetRoot });

  assert.equal(result.plan.blocked, false);
  assert.ok(result.written.includes(".ousia/workflow.json"));
  assert.ok(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
  assert.equal(
    await exists(path.join(targetRoot, ".ousia/workflow.json")),
    true,
  );
});

test("dry run reports creates without writing", async () => {
  const targetRoot = await makeTempProject();
  const result = await installOusia({
    sourceRoot: repoRoot,
    targetRoot,
    dryRun: true,
  });

  assert.equal(result.plan.blocked, false);
  assert.deepEqual(result.phases, ["source", "plan", "dry-run", "report"]);
  assert.equal(result.written.length, 0);
  assert.equal(
    await exists(path.join(targetRoot, ".ousia/workflow.json")),
    false,
  );
});

test("dry run reports replaces without writing", async () => {
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const skillPath = path.join(
    targetRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await fs.writeFile(skillPath, "local edit\n", "utf8");

  const result = await installOusia({
    sourceRoot: repoRoot,
    targetRoot,
    dryRun: true,
  });

  assert.equal(result.plan.blocked, false);
  assert.deepEqual(result.phases, ["source", "plan", "dry-run", "report"]);
  assert.equal(result.written.length, 0);
  assert.equal(await fs.readFile(skillPath, "utf8"), "local edit\n");
  assert.ok(
    result.plan.items.some(
      (item) =>
        item.relativePath === ".github/skills/prompt-surface/SKILL.md" &&
        item.action === "replace" &&
        item.diagnostic.code === "target-replace" &&
        item.diagnostic.severity === "info",
    ),
  );
});

test("reinstall overwrites changed Ousia-owned baseline file", async () => {
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const skillPath = path.join(
    targetRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await fs.writeFile(skillPath, "local edit\n", "utf8");

  const result = await installOusia({ sourceRoot: repoRoot, targetRoot });
  const replaceItem = result.plan.items.find(
    (item) =>
      item.relativePath === ".github/skills/prompt-surface/SKILL.md" &&
      item.action === "replace",
  );

  assert.equal(result.plan.blocked, false);
  assert.deepEqual(result.phases, ["source", "plan", "apply", "report"]);
  assert.ok(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
  assert.equal(
    await fs.readFile(skillPath, "utf8"),
    await fs.readFile(
      path.join(repoRoot, ".github/skills/prompt-surface/SKILL.md"),
      "utf8",
    ),
  );
  assert.ok(replaceItem);
  assert.equal(replaceItem.diagnostic.phase, "plan");
  assert.equal(replaceItem.diagnostic.code, "target-replace");
  assert.equal(replaceItem.diagnostic.severity, "info");
});

test("install skips local override path from source snapshot", async () => {
  const targetRoot = await makeTempProject();
  const source = await readSourceSnapshot(repoRoot);
  source.files.push({
    relativePath: ".ousia/overrides/local.md",
    content: Buffer.from("baseline override\n"),
  });

  const result = await installSnapshot(source, targetRoot, false);

  assert.equal(result.plan.blocked, false);
  assert.equal(
    await exists(path.join(targetRoot, ".ousia/overrides/local.md")),
    false,
  );
  assert.equal(
    result.plan.items.some(
      (item) =>
        item.relativePath === ".ousia/overrides/local.md" &&
        item.action === "skip",
    ),
    true,
  );
});

test("upgrade replaces Ousia-owned file unchanged since last install", async () => {
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const updatedRepoRoot = await makeTempSourceRoot();
  const skillPath = path.join(
    updatedRepoRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  const updatedContent = `${await fs.readFile(skillPath, "utf8")}\nupgrade marker\n`;
  await fs.writeFile(skillPath, updatedContent, "utf8");

  const result = await installOusia({
    sourceRoot: updatedRepoRoot,
    targetRoot,
  });
  const replacedItem = result.plan.items.find(
    (item) =>
      item.relativePath === ".github/skills/prompt-surface/SKILL.md" &&
      item.action === "replace",
  );

  assert.equal(result.plan.blocked, false);
  assert.ok(replacedItem);
  assert.equal(replacedItem.diagnostic.code, "target-replace");
  assert.ok(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
  assert.equal(
    await fs.readFile(
      path.join(targetRoot, ".github/skills/prompt-surface/SKILL.md"),
      "utf8",
    ),
    updatedContent,
  );
});

test("upgrade overwrites Ousia-owned file modified after last install", async () => {
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const updatedRepoRoot = await makeTempSourceRoot();
  const sourceSkillPath = path.join(
    updatedRepoRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await fs.writeFile(
    sourceSkillPath,
    `${await fs.readFile(sourceSkillPath, "utf8")}\nupgrade marker\n`,
    "utf8",
  );

  const targetSkillPath = path.join(
    targetRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await fs.writeFile(targetSkillPath, "local edit\n", "utf8");

  const result = await installOusia({
    sourceRoot: updatedRepoRoot,
    targetRoot,
  });

  assert.equal(result.plan.blocked, false);
  assert.ok(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
  assert.equal(
    await fs.readFile(targetSkillPath, "utf8"),
    await fs.readFile(sourceSkillPath, "utf8"),
  );
});

test("upgrade overwrites structured project-filled baseline file", async () => {
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const updatedRepoRoot = await makeTempSourceRoot();
  const pendingPath = path.join(updatedRepoRoot, ".ousia/pending.md");
  await fs.writeFile(
    pendingPath,
    `${await fs.readFile(pendingPath, "utf8")}\nupdated skeleton\n`,
    "utf8",
  );

  const result = await installOusia({
    sourceRoot: updatedRepoRoot,
    targetRoot,
  });
  const replaceItem = result.plan.items.find(
    (item) =>
      item.relativePath === ".ousia/pending.md" &&
      item.action === "replace",
  );

  assert.equal(result.plan.blocked, false);
  assert.ok(replaceItem);
  assert.equal(
    await fs.readFile(path.join(targetRoot, ".ousia/pending.md"), "utf8"),
    await fs.readFile(pendingPath, "utf8"),
  );
});

test("existing structured project-filled file is overwritten by baseline", async () => {
  const targetRoot = await makeTempProject();
  await fs.mkdir(path.join(targetRoot, ".ousia"), { recursive: true });
  await fs.writeFile(
    path.join(targetRoot, ".ousia/pending.md"),
    "project content\n",
    "utf8",
  );

  const result = await installOusia({ sourceRoot: repoRoot, targetRoot });
  const replaceItem = result.plan.items.find(
    (item) =>
      item.relativePath === ".ousia/pending.md" &&
      item.action === "replace",
  );

  assert.equal(result.plan.blocked, false);
  assert.ok(replaceItem);
  assert.equal(replaceItem.diagnostic.phase, "plan");
  assert.equal(replaceItem.diagnostic.code, "target-replace");
  assert.equal(replaceItem.diagnostic.severity, "info");
  assert.equal(
    await fs.readFile(path.join(targetRoot, ".ousia/pending.md"), "utf8"),
    await fs.readFile(path.join(repoRoot, ".ousia/pending.md"), "utf8"),
  );
});

test("source snapshot excludes non-index proposal files", async () => {
  const source = await readSourceSnapshot(repoRoot);
  assert.equal(
    source.files.some((file) =>
      file.relativePath.endsWith("lazy-load-engineering-skills.md"),
    ),
    false,
  );
  assert.equal(
    source.files.some(
      (file) => file.relativePath === ".ousia/design/proposal/index.md",
    ),
    true,
  );
  assert.equal(
    source.files.some((file) => file.relativePath === ".ousia/design/index.md"),
    false,
  );
  assert.equal(
    source.files.some((file) => file.relativePath === ".ousia/index.md"),
    false,
  );
});

test("source snapshot keeps support files and excludes repository policy", async () => {
  const source = await readSourceSnapshot(repoRoot);
  assert.equal(
    source.files.some(
      (file) =>
        file.relativePath ===
        ".github/instructions/ext-ousia-workflow.instructions.md",
    ),
    false,
  );
  assert.equal(
    source.files.some(
      (file) =>
        file.relativePath ===
        ".github/skills/doc-validation/scripts/check-docs.ts",
    ),
    true,
  );
});

async function makeTempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-install-"));
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Minimal Project\n",
    "utf8",
  );
  return root;
}

async function makeTempSourceRoot(): Promise<string> {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-source-"));
  await copyDir(repoRoot, target);
  return target;
}

async function copyDir(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === "dist"
    ) {
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
