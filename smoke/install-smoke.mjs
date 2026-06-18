import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installOusia } from "../packages/ousia/dist/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(repoRoot, "smoke/workdir/install-target");

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.mkdir(targetRoot, { recursive: true });
await fs.writeFile(path.join(targetRoot, "README.md"), "# Ousia Install Smoke Target\n", "utf8");

const firstInstall = await installOusia({ sourceRoot: repoRoot, targetRoot });
assert.equal(firstInstall.plan.blocked, false);
assert.equal(firstInstall.written.length > 0, true);
assert.equal(await exists(path.join(targetRoot, ".ousia/workflow.json")), true);
assert.equal(await exists(path.join(targetRoot, ".github/skills/prompt-surface/SKILL.md")), true);

const secondInstall = await installOusia({ sourceRoot: repoRoot, targetRoot });
assert.equal(secondInstall.plan.blocked, false);
assert.equal(secondInstall.written.length, 0);
assert.equal(secondInstall.plan.items.every((item) => item.action === "identical"), true);

console.log(`Smoke install target: ${targetRoot}`);
console.log(`Installed files: ${firstInstall.written.length}`);

async function exists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
