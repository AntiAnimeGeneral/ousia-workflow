import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { exists, makeTempProject, repoRoot } from "./helpers.js";
import { installOusia } from "../src/installer.js";

const cliPath = path.resolve(process.cwd(), "dist/src/cli.js");

test("CLI dry-run reports planned install without writing", async () => {
  // Goal: protect dry-run behavior at the user command boundary.
  // Scope: CLI smoke, packaged Node entry with explicit source.
  // Semantics: human output reports planned creates and target state is unchanged.
  const targetRoot = await makeTempProject();
  const result = await runCli([
    "install",
    targetRoot,
    "--source",
    repoRoot,
    "--dry-run",
  ]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dry run 摘要：/);
  assert.match(result.stdout, /创建：[1-9]/);
  assert.equal(
    await exists(path.join(targetRoot, ".ousia/workflow.json")),
    false,
  );
});

test("CLI uses packaged payload when source is omitted", async () => {
  // Goal: prove the published CLI can use its bundled payload by default.
  // Scope: CLI smoke, packaged Node entry.
  // Semantics: omitted --source still plans install without writing on dry-run.
  const targetRoot = await makeTempProject();
  const result = await runCli(["install", targetRoot, "--dry-run"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dry run 摘要：/);
  assert.match(result.stdout, /创建：[1-9]/);
  assert.equal(
    await exists(path.join(targetRoot, ".ousia/workflow.json")),
    false,
  );
});

test("CLI json output exposes stable plan structure", async () => {
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

  assert.equal(result.code, 0);
  assert.equal(output.dryRun, true);
  assert.equal(output.blocked, false);
  assert.equal(output.targetRoot, targetRoot);
  assert.deepEqual(output.phases, ["source", "plan", "dry-run", "report"]);
  assert.equal(typeof output.summary.create, "number");
  assert.equal(Array.isArray(output.items), true);
  assert.ok(
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
  assert.deepEqual(output.written, []);
});

test("CLI json output reports apply errors with stable diagnostic", async () => {
  // Goal: protect the CI-facing JSON failure contract.
  // Scope: CLI JSON contract, apply preflight failure.
  // Semantics: apply failures report stable diagnostics and leave target files unwritten.
  const targetRoot = await makeTempProject();
  await fs.mkdir(path.join(targetRoot, ".ousia"), { recursive: true });
  await fs.writeFile(path.join(targetRoot, ".github"), "blocked\n", "utf8");

  const result = await runCli([
    "install",
    targetRoot,
    "--source",
    repoRoot,
    "--json",
  ]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.equal(output.error.phase, "apply");
  assert.equal(output.error.code, "apply-parent-blocked");
  assert.equal(output.error.severity, "error");
  assert.equal(typeof output.error.remediation, "string");
  assert.equal(
    await exists(path.join(targetRoot, ".github/skills/prompt-surface/SKILL.md")),
    false,
  );
  assert.equal(
    await exists(path.join(targetRoot, ".ousia-install-staging")),
    false,
  );
});

test("CLI json output reports replacements", async () => {
  // Goal: protect replacement reporting in machine-readable output.
  // Scope: CLI JSON contract, apply path.
  // Semantics: Ousia-owned drift is reported with replace action and diagnostic code.
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });
  const skillPath = path.join(
    targetRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await fs.writeFile(skillPath, "local edit\n", "utf8");

  const result = await runCli([
    "install",
    targetRoot,
    "--source",
    repoRoot,
    "--json",
  ]);
  const output = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(output.blocked, false);
  assert.ok(output.summary.replace >= 1);
  assert.ok(
    output.items.some(
      (item: {
        relativePath: string;
        action: string;
        diagnostic: { code: string };
      }) =>
        item.relativePath === ".github/skills/prompt-surface/SKILL.md" &&
        item.action === "replace" &&
        item.diagnostic.code === "target-replace",
    ),
  );
});

test("CLI overwrites changed baseline file", async () => {
  // Goal: prove human CLI apply follows baseline overwrite semantics.
  // Scope: CLI smoke, apply path.
  // Semantics: changed Ousia-owned baseline file is replaced with source content.
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const skillPath = path.join(
    targetRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await fs.writeFile(skillPath, "local edit\n", "utf8");

  const result = await runCli(["install", targetRoot, "--source", repoRoot]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /替换：[1-9]/);
  assert.equal(
    await fs.readFile(skillPath, "utf8"),
    await fs.readFile(
      path.join(repoRoot, ".github/skills/prompt-surface/SKILL.md"),
      "utf8",
    ),
  );
});

async function runCli(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
