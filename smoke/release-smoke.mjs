import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageRoot = path.join(repoRoot, "packages/ousia");
const workRoot = path.join(repoRoot, "smoke/workdir/release");
const packRoot = path.join(workRoot, "pack");
const freshTarget = path.join(workRoot, "fresh-target");
const updateTarget = path.join(workRoot, "update-target");
const conflictTarget = path.join(workRoot, "conflict-target");
const previousTarget = path.join(workRoot, "previous-release-target");
const updatedSourceRoot = path.join(workRoot, "updated-source");
const unpackRoot = path.join(workRoot, "unpack");
const currentPackageDir = path.join(unpackRoot, "current/package");
const previousPackageDir = path.join(unpackRoot, "previous/package");
const previousTarball = path.join(packageRoot, "ousia-workflow-0.1.0.tgz");

await resetWorkRoot();
await run("npm", ["--prefix", packageRoot, "run", "build"], repoRoot);
await run("npm", ["--prefix", packageRoot, "test"], repoRoot);

const currentTarball = await packCurrentPackage();
await unpackTarball(currentTarball, path.join(unpackRoot, "current"));
await installProductionDependencies(currentPackageDir);
if (await exists(previousTarball)) {
  await unpackTarball(previousTarball, path.join(unpackRoot, "previous"));
  await installProductionDependencies(previousPackageDir);
}
await prepareUpdatedSource();

await prepareProject(freshTarget, "Fresh package install");
await runOusia(currentPackageDir, ["install", freshTarget]);
await assertInstalledTarget(freshTarget);

await prepareProject(updateTarget, "Package update");
await runOusia(currentPackageDir, ["install", updateTarget]);
await runOusia(currentPackageDir, [
  "install",
  updateTarget,
  "--source",
  updatedSourceRoot,
]);
await assertInstalledTarget(updateTarget, updatedSourceRoot);

if (await exists(previousTarball)) {
  await prepareProject(previousTarget, "Previous release package update");
  await runOusia(previousPackageDir, [
    "install",
    previousTarget,
  ]);
  await runOusia(currentPackageDir, ["install", previousTarget]);
  await assertInstalledTarget(previousTarget);
}

await prepareProject(conflictTarget, "Local edit update conflict");
await runOusia(currentPackageDir, ["install", conflictTarget]);
const conflictSkillPath = path.join(
  conflictTarget,
  ".github/skills/prompt-surface/SKILL.md",
);
await fs.writeFile(conflictSkillPath, "local edit\n", "utf8");
const conflict = await runOusia(currentPackageDir, [
  "install",
  conflictTarget,
  "--source",
  updatedSourceRoot,
], { expectedCode: 2 });
assert.match(conflict.stdout, /阻塞 \.github\/skills\/prompt-surface\/SKILL\.md/);
assert.equal(await fs.readFile(conflictSkillPath, "utf8"), "local edit\n");

console.log(`release smoke ok: ${path.relative(repoRoot, currentTarball)}`);

async function resetWorkRoot() {
  await fs.rm(workRoot, { recursive: true, force: true });
  await fs.mkdir(packRoot, { recursive: true });
}

async function packCurrentPackage() {
  const output = await run(
    "npm",
    ["pack", "--pack-destination", packRoot, "--json"],
    packageRoot,
  );
  const [packed] = JSON.parse(output.stdout);
  assert.ok(packed?.filename, "npm pack did not report a filename");
  return path.join(packRoot, packed.filename);
}

async function unpackTarball(tarball, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  await run("tar", ["-xzf", tarball, "-C", targetDir], repoRoot);
}

async function installProductionDependencies(packageDir) {
  await run("npm", ["install", "--omit=dev", "--ignore-scripts"], packageDir);
}

async function prepareUpdatedSource() {
  await copyDir(repoRoot, updatedSourceRoot);
  const skillPath = path.join(
    updatedSourceRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await fs.writeFile(
    skillPath,
    `${await fs.readFile(skillPath, "utf8")}\nrelease smoke update marker\n`,
    "utf8",
  );
}

async function prepareProject(targetRoot, title) {
  await fs.mkdir(targetRoot, { recursive: true });
  await fs.writeFile(targetRoot + "/README.md", `# ${title}\n`, "utf8");
}

async function runOusia(packageDir, args, options = {}) {
  const cliPath = path.join(packageDir, "dist/src/cli.js");
  return run(process.execPath, [cliPath, ...args], repoRoot, options);
}

async function assertInstalledTarget(targetRoot, sourceRoot = repoRoot) {
  await assertSameFile(targetRoot, sourceRoot, ".ousia/workflow.json");
  await assertSameFile(
    targetRoot,
    sourceRoot,
    ".github/skills/prompt-surface/SKILL.md",
  );
  await assertSameFile(
    targetRoot,
    sourceRoot,
    ".github/instructions/ousia-development-entry.instructions.md",
  );
  await assertJsonFile(path.join(targetRoot, ".ousia/install-lock.json"));
}

async function assertSameFile(targetRoot, sourceRoot, relativePath) {
  const source = await fs.readFile(path.join(sourceRoot, relativePath), "utf8");
  const target = await fs.readFile(path.join(targetRoot, relativePath), "utf8");
  assert.equal(target, source, relativePath);
}

async function assertJsonFile(absolutePath) {
  const content = await fs.readFile(absolutePath, "utf8");
  JSON.parse(content);
}

async function run(command, args, cwd, options = {}) {
  const expectedCode = options.expectedCode ?? 0;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
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
      if (code !== expectedCode) {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (entry.name === "dist" && path.resolve(source) === packageRoot) continue;
    if (path.resolve(source, entry.name) === workRoot) continue;

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function exists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}