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
  const result = await runCli(["install", targetRoot, "--source", repoRoot, "--dry-run"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dry run 摘要：/);
  assert.match(result.stdout, /创建：[1-9]/);
  assert.equal(await exists(path.join(targetRoot, ".ousia/workflow.json")), false);
});

test("CLI returns 2 when reinstall would overwrite local edits", async () => {
  const targetRoot = await makeTempProject();
  await installOusia({ sourceRoot: repoRoot, targetRoot });

  const skillPath = path.join(targetRoot, ".github/skills/prompt-surface/SKILL.md");
  await fs.writeFile(skillPath, "local edit\n", "utf8");

  const result = await runCli(["install", targetRoot, "--source", repoRoot]);

  assert.equal(result.code, 2);
  assert.match(result.stdout, /阻塞 \.github\/skills\/prompt-surface\/SKILL\.md/);
  assert.equal(await fs.readFile(skillPath, "utf8"), "local edit\n");
});

async function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: repoRoot });
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
  await fs.writeFile(path.join(root, "README.md"), "# Minimal Project\n", "utf8");
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