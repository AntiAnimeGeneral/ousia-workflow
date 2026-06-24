import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { installOusia } from "../src/installer.js";

const repoRoot = path.resolve(process.cwd(), "../..");
const cliPath = path.resolve(process.cwd(), "dist/src/cli.js");

test("CLI dry-run reports planned install without writing", async () => {
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
  assert.equal(Array.isArray(output.diagnostics), true);
  assert.equal(Array.isArray(output.items), true);
  assert.deepEqual(output.written, []);
});

test("CLI json output reports replacements", async () => {
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
      (item: { relativePath: string; action: string; diagnostic: { code: string } }) =>
        item.relativePath === ".github/skills/prompt-surface/SKILL.md" &&
        item.action === "replace" &&
        item.diagnostic.code === "target-replace",
    ),
  );
});

test("CLI overwrites changed baseline file", async () => {
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

async function makeTempProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ousia-cli-"));
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Minimal Project\n",
    "utf8",
  );
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
