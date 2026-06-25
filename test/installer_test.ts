import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  copyDir,
  exists,
  makeMinimalPolicyManifest,
  makePlannerSourceSnapshot,
  makeTempProject,
  readText,
  repoRoot,
} from "./helpers.ts";
import { ApplyError, applyInstallPlan } from "../src/applier.ts";
import { installOusia, installSnapshot } from "../src/installer.ts";
import { planInstall } from "../src/planner.ts";
import { readSourceSnapshot } from "../src/source.ts";

Deno.test("fresh install writes Ousia workflow files", async () => {
  // Goal: prove the default installer path creates the workflow entry surface.
  // Scope: integration, installOusia source->plan->apply.
  // Semantics: a fresh target receives baseline files and is not blocked.
  const targetRoot = await makeTempProject();
  const result = await installOusia({ sourceRoot: repoRoot, targetRoot });

  assertEquals(result.plan.blocked, false);
  assert(result.written.includes(".ousia/workflow.json"));
  assert(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
  assertEquals(await exists(join(targetRoot, ".ousia/workflow.json")), true);
  assertEquals(
    await readText(join(targetRoot, ".ousia/pending.md")),
    '# Pending\n\n<!-- ousia:managed:start id="pending-items" -->\n## 条目\n<!-- ousia:managed:end id="pending-items" -->\n',
  );
  assertEquals(
    await readText(join(targetRoot, ".ousia/design/proposal/index.md")),
    '# Proposal\n\n<!-- ousia:managed:start id="proposal-current" -->\n## 当前提案\n<!-- ousia:managed:end id="proposal-current" -->\n\n<!-- ousia:managed:start id="proposal-completed" -->\n## 已完成提案\n<!-- ousia:managed:end id="proposal-completed" -->\n',
  );
});

Deno.test("dry run reports creates without writing", async () => {
  // Goal: protect dry-run as a no-side-effect planning boundary.
  // Scope: integration, installOusia source->plan->dry-run.
  // Semantics: create actions are reported while target state stays unchanged.
  const targetRoot = await makeTempProject();
  const result = await installOusia({
    sourceRoot: repoRoot,
    targetRoot,
    dryRun: true,
  });

  assertEquals(result.plan.blocked, false);
  assertEquals(result.phases, ["source", "plan", "dry-run", "report"]);
  assertEquals(result.written.length, 0);
  assertEquals(await exists(join(targetRoot, ".ousia/workflow.json")), false);
});

Deno.test("dry run reports replaces without writing", async () => {
  // Goal: protect dry-run replacement reporting without touching local files.
  // Scope: integration, installOusia reinstall planning.
  // Semantics: changed baseline files are planned as replace and left unchanged.
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const skillPath = join(targetRoot, ".github/skills/prompt-surface/SKILL.md");
  await Deno.writeTextFile(skillPath, "local edit\n");

  const result = await installOusia({
    sourceRoot: repoRoot,
    targetRoot,
    dryRun: true,
  });

  assertEquals(result.plan.blocked, false);
  assertEquals(result.phases, ["source", "plan", "dry-run", "report"]);
  assertEquals(result.written.length, 0);
  assertEquals(await readText(skillPath), "local edit\n");
  assert(
    result.plan.items.some(
      (item) =>
        item.relativePath === ".github/skills/prompt-surface/SKILL.md" &&
        item.action === "replace" &&
        item.diagnostic.code === "target-replace" &&
        item.diagnostic.severity === "info",
    ),
  );
});

Deno.test(
  "reinstall overwrites changed Ousia-owned baseline file",
  async () => {
    // Goal: enforce baseline overwrite semantics delegated to Git for acceptance.
    // Scope: integration, installOusia source->plan->apply.
    // Semantics: Ousia-owned drift is replaced with current baseline content.
    const targetRoot = await makeTempProject();
    await installOusia({ sourceRoot: repoRoot, targetRoot });

    const skillPath = join(
      targetRoot,
      ".github/skills/prompt-surface/SKILL.md",
    );
    await Deno.writeTextFile(skillPath, "local edit\n");

    const result = await installOusia({ sourceRoot: repoRoot, targetRoot });
    const replaceItem = result.plan.items.find(
      (item) =>
        item.relativePath === ".github/skills/prompt-surface/SKILL.md" &&
        item.action === "replace",
    );

    assertEquals(result.plan.blocked, false);
    assertEquals(result.phases, ["source", "plan", "apply", "report"]);
    assert(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
    assertEquals(
      await readText(skillPath),
      await readText(join(repoRoot, ".github/skills/prompt-surface/SKILL.md")),
    );
    assert(replaceItem);
    assertEquals(replaceItem.diagnostic.phase, "plan");
    assertEquals(replaceItem.diagnostic.code, "target-replace");
    assertEquals(replaceItem.diagnostic.severity, "info");
  },
);

Deno.test(
  "source snapshot excludes local override files from install payload",
  async () => {
    // Goal: protect local overrides from entering the installer write set.
    // Scope: integration, readSourceSnapshot collection rules.
    // Semantics: real source roots do not collect local override bodies.
    const sourceRoot = await makeTempSourceRoot();
    await Deno.mkdir(join(sourceRoot, ".ousia/overrides"), { recursive: true });
    await Deno.writeTextFile(
      join(sourceRoot, ".ousia/overrides/local.md"),
      "baseline override\n",
    );

    const source = await readSourceSnapshot(sourceRoot);

    assertEquals(
      source.files.some(
        (file) => file.relativePath === ".ousia/overrides/local.md",
      ),
      false,
    );
  },
);

Deno.test(
  "reinstall updates managed regions and preserves project content",
  async () => {
    // Goal: prove structured project-filled files support explicit Ousia-owned regions.
    // Scope: integration, installOusia source->plan->apply.
    // Semantics: marker contents are updated while text outside markers remains project-owned.
    const targetRoot = await makeTempProject();
    await installOusia({ sourceRoot: repoRoot, targetRoot });

    const pendingPath = join(targetRoot, ".ousia/pending.md");
    await Deno.writeTextFile(
      pendingPath,
      '# Pending\n\nProject note.\n\n<!-- ousia:managed:start id="pending-items" -->\n## Old\n<!-- ousia:managed:end id="pending-items" -->\n\nProject footer.\n',
    );

    const result = await installOusia({ sourceRoot: repoRoot, targetRoot });

    assertEquals(result.plan.blocked, false);
    assert(result.written.includes(".ousia/pending.md"));
    assertEquals(
      await readText(pendingPath),
      '# Pending\n\nProject note.\n\n<!-- ousia:managed:start id="pending-items" -->\n## 条目\n<!-- ousia:managed:end id="pending-items" -->\n\nProject footer.\n',
    );
    assert(
      result.plan.items.some(
        (item) =>
          item.relativePath === ".ousia/pending.md" &&
          item.action === "replace" &&
          item.diagnostic.code === "target-managed-regions",
      ),
    );
  },
);

Deno.test(
  "malformed managed region blocks apply and leaves target unchanged",
  async () => {
    // Goal: prove marker conflicts fail before filesystem side effects.
    // Scope: integration, installOusia plan blocked path.
    // Semantics: invalid target markers block all writes and preserve target content.
    const targetRoot = await makeTempProject();
    await installOusia({ sourceRoot: repoRoot, targetRoot });

    const pendingPath = join(targetRoot, ".ousia/pending.md");
    const invalidContent =
      '# Pending\n\n<!-- ousia:managed:start id="pending-items" -->\n## Broken\n';
    await Deno.writeTextFile(pendingPath, invalidContent);

    const result = await installOusia({ sourceRoot: repoRoot, targetRoot });

    assertEquals(result.plan.blocked, true);
    assertEquals(result.written.length, 0);
    assertEquals(await readText(pendingPath), invalidContent);
    assert(
      result.plan.items.some(
        (item) =>
          item.relativePath === ".ousia/pending.md" &&
          item.action === "conflict" &&
          item.diagnostic.code === "target-managed-region-conflict",
      ),
    );
  },
);

Deno.test(
  "planner follows manifest upgrade policy instead of ownership name",
  async () => {
    // Goal: keep upgradePolicy as the action authority.
    // Scope: unit, planner consuming manifest match evidence.
    // Semantics: ownership names alone do not decide write behavior.
    const targetRoot = await makeTempProject();
    const manifest = makeMinimalPolicyManifest({
      upgradePolicy: {
        ousiaOwned: "route-and-validate-only",
        ousiaStructuredProjectFilled: "replace-baseline",
        projectOwned: "route-and-validate-only",
        localOverrides: "never-overwrite",
      },
    });
    const source = makePlannerSourceSnapshot(
      { ".github/skills/example/SKILL.md": "skill\n" },
      manifest,
    );

    const plan = await planInstall(source, targetRoot);
    const item = plan.items[0];

    assertEquals(plan.blocked, false);
    assertEquals(item.action, "skip");
    assertEquals(item.ownership, "ousiaOwned");
    assertEquals(item.matchedPattern, ".github/skills/**");
    assertEquals(item.upgradePolicy, "route-and-validate-only");
  },
);

Deno.test("planner reports target directory as stable conflict", async () => {
  // Goal: expose invalid target file types as stable plan diagnostics.
  // Scope: unit, planner target inspection.
  // Semantics: directories at file paths block apply before writes begin.
  const targetRoot = await makeTempProject();
  await Deno.mkdir(join(targetRoot, ".ousia/workflow.json"), {
    recursive: true,
  });
  const source = makePlannerSourceSnapshot({ ".ousia/workflow.json": "{}\n" });

  const plan = await planInstall(source, targetRoot);
  const item = plan.items[0];

  assertEquals(plan.blocked, true);
  assertEquals(item.action, "conflict");
  assertEquals(item.diagnostic.code, "target-directory");
});

Deno.test(
  "apply preflight failure leaves planned files unchanged",
  async () => {
    // Goal: prove apply preflight failures are no-side-effect failures.
    // Scope: integration, installSnapshot source->plan->apply preflight.
    // Semantics: parent path blockers stop all writes and preserve existing files.
    const targetRoot = await makeTempProject();
    const existingPath = join(targetRoot, ".github/skills/a/SKILL.md");
    await Deno.mkdir(dirname(existingPath), { recursive: true });
    await Deno.writeTextFile(existingPath, "old\n");
    await Deno.writeTextFile(join(targetRoot, ".ousia"), "blocked\n");
    const source = makePlannerSourceSnapshot({
      ".github/skills/a/SKILL.md": "new\n",
      ".ousia/workflow.json": "{}\n",
    });

    await assertRejects(
      () => installSnapshot(source, targetRoot, false),
      ApplyError,
      "目标文件的父路径被普通文件阻塞。",
    );
    assertEquals(await readText(existingPath), "old\n");
    assertEquals(
      await exists(join(targetRoot, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "apply rollback restores replaced file after commit failure",
  async () => {
    // Goal: prove rollback protects already-replaced files after partial commit.
    // Scope: unit, applier transaction boundary with injected commit failure.
    // Semantics: failed create after a replace restores the replaced target.
    const targetRoot = await makeTempProject();
    const firstPath = join(targetRoot, ".github/skills/a/SKILL.md");
    const secondPath = join(targetRoot, ".github/skills/b/SKILL.md");
    await Deno.mkdir(dirname(firstPath), { recursive: true });
    await Deno.writeTextFile(firstPath, "old-a\n");
    const source = makePlannerSourceSnapshot({
      ".github/skills/a/SKILL.md": "new-a\n",
      ".github/skills/b/SKILL.md": "new-b\n",
    });
    const plan = await planInstall(source, targetRoot);
    const fileSystem = {
      async copyFile(
        oldPath: string,
        newPath: string,
        options?: { createNew?: boolean },
      ) {
        if (newPath === secondPath) throw new Error("injected commit failure");
        if (options?.createNew && (await exists(newPath))) {
          throw new Deno.errors.AlreadyExists("target already exists");
        }
        await Deno.copyFile(oldPath, newPath);
      },
      mkdir: Deno.mkdir,
      async remove(path: string, options: { recursive?: true }) {
        try {
          await Deno.remove(path, options);
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return;
          throw error;
        }
      },
      stat: Deno.stat,
      writeFile: Deno.writeFile,
      rename: Deno.rename,
    };

    await assertRejects(
      () => applyInstallPlan(source, plan, fileSystem),
      ApplyError,
      "安装写入失败",
    );
    assertEquals(await readText(firstPath), "old-a\n");
    assertEquals(await exists(secondPath), false);
    assertEquals(
      await exists(join(targetRoot, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test("apply does not overwrite file created after plan", async () => {
  // Goal: protect files that appear after planning from create actions.
  // Scope: unit, applier stale-plan guard.
  // Semantics: create commits are no-overwrite and leave new target files intact.
  const targetRoot = await makeTempProject();
  const targetPath = join(targetRoot, ".github/skills/a/SKILL.md");
  const source = makePlannerSourceSnapshot({
    ".github/skills/a/SKILL.md": "baseline\n",
  });
  const plan = await planInstall(source, targetRoot);
  await Deno.mkdir(dirname(targetPath), { recursive: true });
  await Deno.writeTextFile(targetPath, "new user file\n");

  await assertRejects(
    () => applyInstallPlan(source, plan),
    ApplyError,
    "安装写入失败",
  );
  assertEquals(await readText(targetPath), "new user file\n");
  assertEquals(await exists(join(targetRoot, ".ousia-install-staging")), false);
});

Deno.test(
  "upgrade overwrites Ousia-owned file modified after last install",
  async () => {
    // Goal: keep Git, not installer state, responsible for accepting local edits.
    // Scope: integration, installOusia baseline overwrite.
    // Semantics: Ousia-owned local drift is overwritten by the new baseline.
    const targetRoot = await makeTempProject();
    await installOusia({ sourceRoot: repoRoot, targetRoot });

    const updatedRepoRoot = await makeTempSourceRoot();
    const sourceSkillPath = join(
      updatedRepoRoot,
      ".github/skills/prompt-surface/SKILL.md",
    );
    await Deno.writeTextFile(
      sourceSkillPath,
      `${await readText(sourceSkillPath)}\nupgrade marker\n`,
    );

    const targetSkillPath = join(
      targetRoot,
      ".github/skills/prompt-surface/SKILL.md",
    );
    await Deno.writeTextFile(targetSkillPath, "local edit\n");

    const result = await installOusia({
      sourceRoot: updatedRepoRoot,
      targetRoot,
    });

    assertEquals(result.plan.blocked, false);
    assert(result.written.includes(".github/skills/prompt-surface/SKILL.md"));
    assertEquals(
      await readText(targetSkillPath),
      await readText(sourceSkillPath),
    );
  },
);

Deno.test(
  "source snapshot keeps support files and excludes repository policy",
  async () => {
    // Goal: protect payload boundaries between baseline support files and host policy.
    // Scope: integration, readSourceSnapshot against this repository.
    // Semantics: skill support files ship; self-hosting ext policy does not.
    const source = await readSourceSnapshot(repoRoot);
    assertEquals(
      source.files.some(
        (file) =>
          file.relativePath ===
            ".github/instructions/ext-ousia-workflow.instructions.md",
      ),
      false,
    );
    assertEquals(
      source.files.some(
        (file) =>
          file.relativePath ===
            ".github/skills/doc-validation/scripts/check-docs.ts",
      ),
      true,
    );
  },
);

async function makeTempSourceRoot(): Promise<string> {
  const target = await Deno.makeTempDir({ prefix: "ousia-source-" });
  await copyDir(repoRoot, target);
  return target;
}
