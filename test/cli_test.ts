import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { exists, makeTempProject, readText, repoRoot } from "./helpers.ts";
import { installOusia } from "../src/installer.ts";

Deno.test("CLI dry-run reports planned install without writing", async () => {
  // Goal: protect dry-run behavior at the user command boundary.
  // Scope: CLI smoke, Deno entry with explicit source.
  // Semantics: human output reports planned creates and target state is unchanged.
  const targetRoot = await makeTempProject();
  const result = await runCli([
    "install",
    targetRoot,
    "--source",
    repoRoot,
    "--dry-run",
  ]);

  assertEquals(result.code, 0);
  assertMatch(result.stdout, /Dry run 摘要：/);
  assertMatch(result.stdout, /创建：[1-9]/);
  assertEquals(await exists(join(targetRoot, ".ousia/workflow.json")), false);
});

Deno.test("CLI json output exposes stable plan structure", async () => {
  // Goal: protect the CI-facing JSON success contract.
  // Scope: CLI JSON contract, dry-run.
  // Semantics: output contains phases, summary, items, policy evidence, and no writes.
  const targetRoot = await makeTempProject();
  const result = await runCli([
    "install",
    targetRoot,
    "--source",
    repoRoot,
    "--dry-run",
    "--json",
  ]);
  const output = JSON.parse(result.stdout);

  assertEquals(result.code, 0);
  assertEquals(output.dryRun, true);
  assertEquals(output.blocked, false);
  assertEquals(output.targetRoot, targetRoot);
  assertEquals(output.phases, ["source", "plan", "dry-run", "report"]);
  assertEquals(typeof output.summary.create, "number");
  assertEquals(Array.isArray(output.items), true);
  assert(
    output.items.some(
      (item: {
        relativePath: string;
        matchedPattern: string | null;
        upgradePolicy: string | null;
      }) =>
        item.relativePath === ".ousia/workflow.json" &&
        item.matchedPattern === ".ousia/workflow.json" &&
        item.upgradePolicy === "replace-baseline",
    ),
  );
  assertEquals(output.written, []);
});

Deno.test("CLI defaults to checkout source when payload is absent", async () => {
  // Goal: protect the Git distribution path.
  // Scope: CLI default source resolution in a repository checkout.
  // Semantics: users can run `ousia install <target>` without spelling `--source .`.
  const targetRoot = await makeTempProject();
  const result = await runCli(["install", targetRoot, "--dry-run", "--json"]);
  const output = JSON.parse(result.stdout);

  assertEquals(result.code, 0);
  assertEquals(output.blocked, false);
  assert(
    output.items.some((item: { relativePath: string }) =>
      item.relativePath === ".ousia/workflow.json"
    ),
  );
  assertEquals(await exists(join(targetRoot, ".ousia/workflow.json")), false);
});

Deno.test("CLI json output reports apply errors with stable diagnostic", async () => {
  // Goal: protect the CI-facing JSON failure contract.
  // Scope: CLI JSON contract, apply preflight failure.
  // Semantics: apply failures report stable diagnostics and leave target files unwritten.
  const targetRoot = await makeTempProject();
  await Deno.mkdir(join(targetRoot, ".ousia"), { recursive: true });
  await Deno.writeTextFile(join(targetRoot, ".github"), "blocked\n");

  const result = await runCli([
    "install",
    targetRoot,
    "--source",
    repoRoot,
    "--json",
  ]);
  const output = JSON.parse(result.stdout);

  assertEquals(result.code, 1);
  assertEquals(output.error.phase, "apply");
  assertEquals(output.error.code, "apply-parent-blocked");
  assertEquals(output.error.severity, "error");
  assertEquals(typeof output.error.remediation, "string");
  assertEquals(
    await exists(join(targetRoot, ".github/skills/prompt-surface/SKILL.md")),
    false,
  );
  assertEquals(await exists(join(targetRoot, ".ousia-install-staging")), false);
});

Deno.test("CLI overwrites changed baseline file", async () => {
  // Goal: prove human CLI apply follows baseline overwrite semantics.
  // Scope: CLI smoke, apply path.
  // Semantics: changed Ousia-owned baseline file is replaced with source content.
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const skillPath = join(targetRoot, ".github/skills/prompt-surface/SKILL.md");
  await Deno.writeTextFile(skillPath, "local edit\n");

  const result = await runCli(["install", targetRoot, "--source", repoRoot]);

  assertEquals(result.code, 0);
  assertMatch(result.stdout, /替换：[1-9]/);
  assertEquals(
    await readText(skillPath),
    await readText(join(repoRoot, ".github/skills/prompt-surface/SKILL.md")),
  );
});

async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-sys=uid",
      join(repoRoot, "src/cli.ts"),
      ...args,
    ],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}
