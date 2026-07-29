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

Deno.test("CLI install dry-run resolves checker from PATH without writing", async () => {
  // Goal: protect the production PATH checker locator and dry-run process contract.
  // Scope: integration, src/cli.ts process through runtime preflight and planning.
  // Semantics: matching identity exits zero and reports phases while manifest and staging remain absent.
  const target = await projectFixture.makeTempProject();
  const bin = await makeCheckerBin();
  const output = await runCliProcess(
    target,
    `${bin}:${Deno.env.get("PATH") ?? ""}`,
  );
  const result = JSON.parse(new TextDecoder().decode(output.stdout));

  assertEquals(output.success, true);
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
  assertEquals(
    await fileProbe.exists(join(target, ".ousia-install-staging")),
    false,
  );
});

Deno.test("CLI install reports a missing PATH checker without writing", async () => {
  // Goal: preserve the runtime-preflight diagnostic at the real CLI process boundary.
  // Scope: contract, src/cli.ts process with an empty PATH locator.
  // Semantics: missing checker exits one with its stable code while manifest and staging remain absent.
  const target = await projectFixture.makeTempProject();
  const output = await runCliProcess(target, "");
  const result = JSON.parse(new TextDecoder().decode(output.stdout));

  assertEquals(output.success, false);
  assertEquals(result.diagnostics[0].code, "rust-checker-runtime-missing");
  assertEquals(
    await fileProbe.exists(join(target, ".ousia/framework.json")),
    false,
  );
  assertEquals(
    await fileProbe.exists(join(target, ".ousia-install-staging")),
    false,
  );
});

async function makeCheckerBin(): Promise<string> {
  const bin = await Deno.makeTempDir({ prefix: "ousia-checker-bin-" });
  const identity = await projectFixture.matchingRustCheckerIdentity();
  const script = join(bin, "ousia-rust-checker");
  await Deno.writeTextFile(
    script,
    `#!/bin/sh
if [ "$1" != "identity" ] || [ "$2" != "--format" ] || [ "$3" != "json" ] || [ "$#" -ne 3 ]; then
  exit 64
fi
printf '%s' '${new TextDecoder().decode(identity.stdout)}'
`,
  );
  await Deno.chmod(script, 0o755);
  return bin;
}

function runCliProcess(
  target: string,
  path: string,
): Promise<Deno.CommandOutput> {
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-sys=uid",
      "--allow-run=ousia-rust-checker",
      join(projectFixture.repoRoot, "src/cli.ts"),
      "install",
      target,
      "--source",
      projectFixture.repoRoot,
      "--dry-run",
      "--json",
    ],
    cwd: projectFixture.repoRoot,
    env: { PATH: path },
    stdout: "piped",
    stderr: "piped",
  }).output();
}
