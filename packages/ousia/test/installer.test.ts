import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  copyDir,
  exists,
  makeManifest,
  makeSourceSnapshot,
  makeTempProject,
  repoRoot,
} from "./helpers.js";
import { ApplyError, applyInstallPlan } from "../src/applier.js";
import { installOusia, installSnapshot } from "../src/installer.js";
import { planInstall } from "../src/planner.js";
import { readSourceSnapshot } from "../src/source.js";

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

test("planner follows manifest upgrade policy instead of ownership name", async () => {
  const targetRoot = await makeTempProject();
  const manifest = makeManifest({
    upgradePolicy: {
      ousiaOwned: "route-and-validate-only",
      ousiaStructuredProjectFilled: "replace-baseline",
      projectOwned: "route-and-validate-only",
      localOverrides: "never-overwrite",
    },
  });
  const source = makeSourceSnapshot(
    { ".github/skills/example/SKILL.md": "skill\n" },
    manifest,
  );

  const plan = await planInstall(source, targetRoot);
  const item = plan.items[0];

  assert.equal(plan.blocked, false);
  assert.equal(item.action, "skip");
  assert.equal(item.ownership, "ousiaOwned");
  assert.equal(item.matchedPattern, ".github/skills/**");
  assert.equal(item.upgradePolicy, "route-and-validate-only");
});

test("planner reports target directory as stable conflict", async () => {
  const targetRoot = await makeTempProject();
  await fs.mkdir(path.join(targetRoot, ".ousia/workflow.json"), {
    recursive: true,
  });
  const source = makeSourceSnapshot({ ".ousia/workflow.json": "{}\n" });

  const plan = await planInstall(source, targetRoot);
  const item = plan.items[0];

  assert.equal(plan.blocked, true);
  assert.equal(item.action, "conflict");
  assert.equal(item.diagnostic.code, "target-directory");
});

test("apply preflight failure leaves planned files unchanged", async () => {
  const targetRoot = await makeTempProject();
  const existingPath = path.join(targetRoot, ".github/skills/a/SKILL.md");
  await fs.mkdir(path.dirname(existingPath), { recursive: true });
  await fs.writeFile(existingPath, "old\n", "utf8");
  await fs.writeFile(path.join(targetRoot, ".ousia"), "blocked\n", "utf8");
  const source = makeSourceSnapshot({
    ".github/skills/a/SKILL.md": "new\n",
    ".ousia/workflow.json": "{}\n",
  });

  await assert.rejects(
    () => installSnapshot(source, targetRoot, false),
    (error) =>
      error instanceof ApplyError &&
      error.diagnostic.code === "apply-parent-blocked",
  );
  assert.equal(await fs.readFile(existingPath, "utf8"), "old\n");
  assert.equal(
    await exists(path.join(targetRoot, ".ousia-install-staging")),
    false,
  );
});

test("apply rollback restores replaced file after commit failure", async () => {
  const targetRoot = await makeTempProject();
  const firstPath = path.join(targetRoot, ".github/skills/a/SKILL.md");
  const secondPath = path.join(targetRoot, ".github/skills/b/SKILL.md");
  await fs.mkdir(path.dirname(firstPath), { recursive: true });
  await fs.writeFile(firstPath, "old-a\n", "utf8");
  const source = makeSourceSnapshot({
    ".github/skills/a/SKILL.md": "new-a\n",
    ".github/skills/b/SKILL.md": "new-b\n",
  });
  const plan = await planInstall(source, targetRoot);
  const fileSystem = {
    async copyFile(oldPath: string, newPath: string, flags?: number) {
      if (newPath === secondPath) {
        throw new Error("injected commit failure");
      }
      await fs.copyFile(oldPath, newPath, flags);
    },
    mkdir: fs.mkdir,
    rm: fs.rm,
    stat: fs.stat,
    writeFile: fs.writeFile,
    rename: fs.rename,
  };

  await assert.rejects(
    () => applyInstallPlan(source, plan, fileSystem),
    (error) =>
      error instanceof ApplyError &&
      error.diagnostic.code === "apply-commit-failed",
  );
  assert.equal(await fs.readFile(firstPath, "utf8"), "old-a\n");
  assert.equal(await exists(secondPath), false);
  assert.equal(
    await exists(path.join(targetRoot, ".ousia-install-staging")),
    false,
  );
});

test("apply keeps commit diagnostic when cleanup also fails", async () => {
  const targetRoot = await makeTempProject();
  const firstPath = path.join(targetRoot, ".github/skills/a/SKILL.md");
  const secondPath = path.join(targetRoot, ".github/skills/b/SKILL.md");
  await fs.mkdir(path.dirname(firstPath), { recursive: true });
  await fs.writeFile(firstPath, "old-a\n", "utf8");
  const source = makeSourceSnapshot({
    ".github/skills/a/SKILL.md": "new-a\n",
    ".github/skills/b/SKILL.md": "new-b\n",
  });
  const plan = await planInstall(source, targetRoot);
  const fileSystem = {
    async copyFile(oldPath: string, newPath: string, flags?: number) {
      if (newPath === secondPath) {
        throw new Error("injected commit failure");
      }
      await fs.copyFile(oldPath, newPath, flags);
    },
    mkdir: fs.mkdir,
    stat: fs.stat,
    writeFile: fs.writeFile,
    rename: fs.rename,
    async rm(targetPath: string, options: { force: true; recursive?: true }) {
      if (targetPath === path.join(targetRoot, ".ousia-install-staging")) {
        throw new Error("injected cleanup failure");
      }
      await fs.rm(targetPath, options);
    },
  };

  await assert.rejects(
    () => applyInstallPlan(source, plan, fileSystem),
    (error) =>
      error instanceof ApplyError &&
      error.diagnostic.code === "apply-commit-failed",
  );
  assert.equal(await fs.readFile(firstPath, "utf8"), "old-a\n");
});

test("apply reports cleanup failure after successful writes", async () => {
  const targetRoot = await makeTempProject();
  const targetPath = path.join(targetRoot, ".github/skills/a/SKILL.md");
  const source = makeSourceSnapshot({
    ".github/skills/a/SKILL.md": "new-a\n",
  });
  const plan = await planInstall(source, targetRoot);
  const fileSystem = {
    copyFile: fs.copyFile,
    mkdir: fs.mkdir,
    rename: fs.rename,
    stat: fs.stat,
    writeFile: fs.writeFile,
    async rm() {
      throw new Error("injected cleanup failure");
    },
  };

  await assert.rejects(
    () => applyInstallPlan(source, plan, fileSystem),
    (error) =>
      error instanceof ApplyError &&
      error.diagnostic.code === "apply-cleanup-failed",
  );
  assert.equal(await fs.readFile(targetPath, "utf8"), "new-a\n");
});

test("apply does not overwrite file created after plan", async () => {
  const targetRoot = await makeTempProject();
  const targetPath = path.join(targetRoot, ".github/skills/a/SKILL.md");
  const source = makeSourceSnapshot({
    ".github/skills/a/SKILL.md": "baseline\n",
  });
  const plan = await planInstall(source, targetRoot);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, "new user file\n", "utf8");

  await assert.rejects(
    () => applyInstallPlan(source, plan),
    (error) =>
      error instanceof ApplyError &&
      error.diagnostic.code === "apply-target-changed",
  );
  assert.equal(await fs.readFile(targetPath, "utf8"), "new user file\n");
  assert.equal(
    await exists(path.join(targetRoot, ".ousia-install-staging")),
    false,
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
      item.relativePath === ".ousia/pending.md" && item.action === "replace",
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
      item.relativePath === ".ousia/pending.md" && item.action === "replace",
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

async function makeTempSourceRoot(): Promise<string> {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-source-"));
  await copyDir(repoRoot, target);
  return target;
}
