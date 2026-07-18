import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import * as installer from "../src/installer.ts";
import * as fileProbe from "./file-probe.ts";
import * as projectFixture from "./project-fixture.ts";

Deno.test(
  "fresh install writes manifest and neutral project seeds",
  async () => {
    // Goal: protect the manifest authority cutover through the real installer.
    // Scope: integration, source->plan->apply.
    // Semantics: framework files install and project seeds come from templates.
    const target = await projectFixture.makeTempProject();
    const result = await installer.installOusia({
      sourceRoot: projectFixture.repoRoot,
      targetRoot: target,
    });
    assertEquals(result.plan.blocked, false);
    assert(result.written.includes(".ousia/framework.json"));
    assertEquals(
      await fileProbe.exists(join(target, ".ousia/workflow.json")),
      false,
    );
    assertEquals(
      JSON.parse(
        await Deno.readTextFile(join(target, ".ousia/project.json")),
      ).project
        .name,
      null,
    );
    assertEquals(
      await fileProbe.exists(
        join(target, ".ousia/design/proposal/archive/index.md"),
      ),
      true,
    );
  },
);

Deno.test(
  "reinstall preserves project facts and replaces framework drift",
  async () => {
    // Goal: prove distinct lifecycle owners in one real path.
    // Scope: integration, reinstall.
    // Semantics: project content is byte-preserved while framework content is replaced.
    const target = await projectFixture.makeTempProject();
    await installer.installOusia({
      sourceRoot: projectFixture.repoRoot,
      targetRoot: target,
    });
    const project = join(target, ".ousia/project.json");
    const proposalArchive = join(
      target,
      ".ousia/design/proposal/archive/index.md",
    );
    const skill = join(target, ".github/skills/prompt-surface/SKILL.md");
    await Deno.writeTextFile(project, "project-owned\n");
    await Deno.writeTextFile(proposalArchive, "archive-owned\n");
    await Deno.writeTextFile(skill, "drift\n");
    const result = await installer.installOusia({
      sourceRoot: projectFixture.repoRoot,
      targetRoot: target,
    });
    assertEquals(await Deno.readTextFile(project), "project-owned\n");
    assertEquals(
      await Deno.readTextFile(proposalArchive),
      "archive-owned\n",
    );
    assertEquals(
      await Deno.readTextFile(skill),
      await Deno.readTextFile(
        join(
          projectFixture.repoRoot,
          ".github/skills/prompt-surface/SKILL.md",
        ),
      ),
    );
    assert(
      result.plan.items.some(
        (item) =>
          item.target === ".ousia/project.json" && item.action === "preserve",
      ),
    );
    assert(
      result.plan.items.some(
        (item) =>
          item.target === ".ousia/design/proposal/archive/index.md" &&
          item.action === "preserve",
      ),
    );
  },
);

Deno.test("dry run has no filesystem side effects", async () => {
  // Goal: protect installer phase reporting without applying its plan.
  // Scope: integration, public installer boundary.
  // Semantics: dry-run reaches report while every planned target remains absent.
  const target = await projectFixture.makeTempProject();
  const result = await installer.installOusia({
    sourceRoot: projectFixture.repoRoot,
    targetRoot: target,
    dryRun: true,
  });
  assertEquals(result.phases, ["source", "plan", "dry-run", "report"]);
  assertEquals(
    await fileProbe.exists(join(target, ".ousia/framework.json")),
    false,
  );
});

Deno.test(
  "preexisting staging namespace blocks without deleting it",
  async () => {
    // Goal: preserve foreign staging content when the transaction cannot start.
    // Scope: integration, installer through applier staging precondition.
    // Semantics: install fails, foreign bytes remain, and no manifest is committed.
    const target = await projectFixture.makeTempProject();
    const staging = join(target, ".ousia-install-staging");
    await Deno.mkdir(staging);
    await Deno.writeTextFile(join(staging, "owned.txt"), "keep\n");
    let failed = false;
    try {
      await installer.installOusia({
        sourceRoot: projectFixture.repoRoot,
        targetRoot: target,
      });
    } catch {
      failed = true;
    }
    assertEquals(failed, true);
    assertEquals(
      await Deno.readTextFile(join(staging, "owned.txt")),
      "keep\n",
    );
    assertEquals(
      await fileProbe.exists(join(target, ".ousia/framework.json")),
      false,
    );
  },
);
