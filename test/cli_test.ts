import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import * as cli from "../src/cli.ts";
import * as fileProbe from "./file-probe.ts";
import * as projectFixture from "./project-fixture.ts";

Deno.test("CLI check validates source checkout", async () => {
  // Goal: protect source validation through the public in-process CLI entry.
  // Scope: CLI integration, runCli check command.
  // Semantics: a valid checkout succeeds without changing repository state.
  assertEquals(await cli.runCli(["check", projectFixture.repoRoot]), 0);
});

Deno.test("CLI install dry-run does not write", async () => {
  // Goal: protect dry-run behavior through the public in-process CLI entry.
  // Scope: CLI integration, runCli install command.
  // Semantics: success reports a plan while the target manifest remains absent.
  const target = await projectFixture.makeTempProject();
  assertEquals(
    await cli.runCli([
      "install",
      target,
      "--source",
      projectFixture.repoRoot,
      "--dry-run",
    ]),
    0,
  );
  assertEquals(
    await fileProbe.exists(join(target, ".ousia/framework.json")),
    false,
  );
});
