import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import * as applier from "../src/applier.ts";
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
      runRustCheckerIdentity: projectFixture.matchingRustCheckerIdentity,
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
      runRustCheckerIdentity: projectFixture.matchingRustCheckerIdentity,
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
      runRustCheckerIdentity: projectFixture.matchingRustCheckerIdentity,
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
    runRustCheckerIdentity: projectFixture.matchingRustCheckerIdentity,
  });
  assertEquals(result.phases, [
    "source",
    "runtime-preflight",
    "plan",
    "dry-run",
    "report",
  ]);
  assertEquals(
    await fileProbe.exists(join(target, ".ousia/framework.json")),
    false,
  );
});

Deno.test(
  "runtime identity mismatch blocks before planning or staging",
  async () => {
    // Goal: keep global checker generation failure ahead of every host read/write transaction boundary.
    // Scope: integration, source snapshot -> runtime preflight.
    // Semantics: mismatch raises the typed error while target bytes and staging namespace remain untouched.
    const target = await projectFixture.makeTempProject();
    const readme = join(target, "README.md");
    const before = await Deno.readTextFile(readme);
    let error: unknown;
    try {
      await installer.installOusia({
        sourceRoot: projectFixture.repoRoot,
        targetRoot: target,
        runRustCheckerIdentity: () =>
          Promise.resolve({
            success: true,
            code: 0,
            signal: null,
            stdout: new TextEncoder().encode(
              JSON.stringify({
                schema: "ousia.rust-checker-build.v1",
                package: "ousia-rust-checker",
                binary: "ousia-rust-checker",
                sourceSha256: "0".repeat(64),
              }),
            ),
            stderr: new Uint8Array(),
          }),
      });
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof installer.RustCheckerRuntimeError);
    assertEquals(error.code, "rust-checker-runtime-mismatch");
    assertEquals(await Deno.readTextFile(readme), before);
    assertEquals(
      await fileProbe.exists(join(target, ".ousia-install-staging")),
      false,
    );
    assertEquals(
      await fileProbe.exists(join(target, ".ousia/framework.json")),
      false,
    );
  },
);

Deno.test(
  "runtime identity failure matrix blocks before target mutation",
  async () => {
    // Goal: classify every global checker execution/protocol failure before host planning and writes.
    // Scope: integration, source snapshot to runtime-preflight matrix through the public installer boundary.
    // Semantics: each labeled case returns its stable code while README, framework manifest, and staging remain unchanged.
    const cases: {
      label: string;
      expectedCode: string;
      run: () => Promise<Deno.CommandOutput>;
    }[] = [
      {
        label: "missing-command",
        expectedCode: "rust-checker-runtime-missing",
        run: () => Promise.reject(new Error("permission denied")),
      },
      {
        label: "nonzero-exit",
        expectedCode: "rust-checker-runtime-failed",
        run: () => Promise.resolve(commandOutput(false, 9, "", "failed")),
      },
      {
        label: "invalid-json",
        expectedCode: "rust-checker-runtime-invalid",
        run: () => Promise.resolve(commandOutput(true, 0, "not-json", "")),
      },
      {
        label: "unknown-schema",
        expectedCode: "rust-checker-runtime-invalid",
        run: () =>
          Promise.resolve(commandOutput(
            true,
            0,
            JSON.stringify({
              schema: "unknown",
              package: "ousia-rust-checker",
              binary: "ousia-rust-checker",
              sourceSha256: "0".repeat(64),
            }),
            "",
          )),
      },
    ];

    for (const testCase of cases) {
      const target = await projectFixture.makeTempProject();
      const readme = join(target, "README.md");
      const before = await Deno.readTextFile(readme);
      let error: unknown;
      try {
        await installer.installOusia({
          sourceRoot: projectFixture.repoRoot,
          targetRoot: target,
          runRustCheckerIdentity: testCase.run,
        });
      } catch (caught) {
        error = caught;
      }
      assert(
        error instanceof installer.RustCheckerRuntimeError,
        testCase.label,
      );
      assertEquals(error.code, testCase.expectedCode, testCase.label);
      assertEquals(error.phase, "runtime-preflight", testCase.label);
      assertEquals(error.path, "runtime.rustChecker", testCase.label);
      assert(error.remediation.length > 0, testCase.label);
      assert(Object.keys(error.evidence).length > 0, testCase.label);
      assertEquals(await Deno.readTextFile(readme), before, testCase.label);
      assertEquals(
        await fileProbe.exists(join(target, ".ousia-install-staging")),
        false,
        testCase.label,
      );
      assertEquals(
        await fileProbe.exists(join(target, ".ousia/framework.json")),
        false,
        testCase.label,
      );
    }
  },
);

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
    let error: unknown;
    try {
      await installer.installOusia({
        sourceRoot: projectFixture.repoRoot,
        targetRoot: target,
        runRustCheckerIdentity: projectFixture.matchingRustCheckerIdentity,
      });
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof applier.ApplyError);
    assertEquals(error.diagnostic.code, "apply-staging-conflict");
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

function commandOutput(
  success: boolean,
  code: number,
  stdout: string,
  stderr: string,
): Deno.CommandOutput {
  return {
    success,
    code,
    signal: null,
    stdout: new TextEncoder().encode(stdout),
    stderr: new TextEncoder().encode(stderr),
  };
}
