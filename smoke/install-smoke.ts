import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const repoRoot = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const targetRoot = join(repoRoot, "smoke/workdir/install-target");
const cliInstallRoot = join(repoRoot, "smoke/workdir/cli-install-root");
const updatedSourceRoot = join(repoRoot, "smoke/workdir/updated-source");

await Deno.remove(targetRoot, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await Deno.mkdir(targetRoot, { recursive: true });
await Deno.writeTextFile(
  join(targetRoot, "README.md"),
  "# Ousia Install Smoke Target\n",
);

// Goal: prove the globally installed CLI is repeatably installable and can validate its source.
// Scope: smoke, installed executable across install and check commands.
// Semantics: reinstall is safe, source check succeeds, and dry-run performs no target mutation.
await installOusiaCli();
await installOusiaCli();
assertEquals((await runInstalledOusia(["check", repoRoot])).code, 0);
assertEquals(
  (await runInstalledOusia(["install", targetRoot, "--dry-run"])).code,
  0,
);

// Goal: prove a fresh target receives the complete current baseline through the installed CLI.
// Scope: smoke, installed executable through source, planner, transaction, and JSON report.
// Semantics: all current assets install, retired instructions stay absent, and the new engineering owner is present.
const firstInstall = await runInstalledOusia(["install", targetRoot, "--json"]);
const firstOutput = JSON.parse(firstInstall.stdout);
assertEquals(firstInstall.code, 0);
assertEquals(firstOutput.blocked, false);
assert(firstOutput.written.length > 0);
assertEquals(await exists(join(targetRoot, ".ousia/framework.json")), true);
assertEquals(await exists(join(targetRoot, ".ousia/workflow.json")), false);
assertEquals(
  await exists(
    join(targetRoot, ".ousia/design/proposal/archive/index.md"),
  ),
  true,
);
assertEquals(
  await exists(join(targetRoot, ".github/skills/prompt-surface/SKILL.md")),
  true,
);
assertEquals(
  await exists(
    join(
      targetRoot,
      ".github/instructions/ousia-engineering-standards.instructions.md",
    ),
  ),
  true,
);
for (
  const retiredInstruction of [
    "ousia-architecture-abstraction.instructions.md",
    "ousia-design-task.instructions.md",
    "ousia-development-entry.instructions.md",
    "ousia-development-standards.instructions.md",
    "ousia-implementation-quality.instructions.md",
    "ousia-testing-evolution.instructions.md",
  ]
) {
  assertEquals(
    await exists(join(targetRoot, ".github/instructions", retiredInstruction)),
    false,
  );
}
const projectFacts = new Map([
  [".ousia/project.json", '{"name":"smoke-owned-project"}\n'],
  [".ousia/pending.md", "# Smoke Pending\n\nproject-owned\n"],
  [
    ".ousia/design/architecture/index.md",
    "# Architecture Index\n\n| 入口 | 摘要 |\n| --- | --- |\n| [index.md](./index.md) | project-owned |\n",
  ],
  [
    ".ousia/design/proposal/index.md",
    "# Proposal Index\n\n| 入口 | 摘要 |\n| --- | --- |\n| [index.md](./index.md) | project-owned |\n",
  ],
  [
    ".ousia/design/proposal/archive/index.md",
    "# Proposal Archive\n\n| 入口 | 结果 |\n| --- | --- |\n| [index.md](./index.md) | project-owned |\n",
  ],
  [
    ".ousia/design/experience/index.md",
    "# Experience Index\n\n| 入口 | 摘要 |\n| --- | --- |\n| [index.md](./index.md) | project-owned |\n",
  ],
]);
for (const [path, content] of projectFacts) {
  await Deno.writeTextFile(join(targetRoot, path), content);
}

// Goal: prove reinstall keeps framework and project lifecycle owners distinct.
// Scope: smoke, installed executable reinstall against project-modified facts.
// Semantics: framework bytes remain identical while every project fact is preserved byte-for-byte.
const secondInstall = await runInstalledOusia([
  "install",
  targetRoot,
  "--json",
]);
const secondOutput = JSON.parse(secondInstall.stdout);
assertEquals(secondInstall.code, 0);
assertEquals(secondOutput.written.length, 0);
assertEquals(
  secondOutput.items.every(
    (item: { action: string }) =>
      item.action === "identical" || item.action === "preserve",
  ),
  true,
);
await assertProjectFacts(targetRoot, projectFacts);

await Deno.remove(updatedSourceRoot, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await copyDirectory(repoRoot, updatedSourceRoot, [".git", "smoke/workdir"]);
const updatedManifestPath = join(updatedSourceRoot, ".ousia/framework.json");
const updatedManifest = JSON.parse(
  await Deno.readTextFile(updatedManifestPath),
);
const retiredId = "instruction.prompt";
const retired = updatedManifest.install.assets.find(
  (asset: { id: string }) => asset.id === retiredId,
);
assert(retired);
const retiredBytes = await Deno.readFile(
  join(updatedSourceRoot, retired.source),
);
updatedManifest.install.assets = updatedManifest.install.assets.filter(
  (asset: { id: string }) => asset.id !== retiredId,
);
updatedManifest.install.retiredAssets.push({
  id: retiredId,
  target: retired.target,
  sha256: await digest(retiredBytes),
});
updatedManifest.routing.concerns.find(
  (route: { concern: string }) => route.concern === "prompt-surface",
).read = ["skill.prompt-surface"];
await Deno.writeTextFile(
  updatedManifestPath,
  JSON.stringify(updatedManifest, null, 2) + "\n",
);
await Deno.remove(join(updatedSourceRoot, retired.source));
const workflowPath = join(
  updatedSourceRoot,
  ".github/instructions/ousia-workflow.instructions.md",
);
await Deno.writeTextFile(
  workflowPath,
  (await Deno.readTextFile(workflowPath)) + "\n<!-- smoke-update -->\n",
);

// Goal: prove trusted baseline update and retirement through the installed executable.
// Scope: smoke, copied source update with tombstone and changed framework asset.
// Semantics: authorized framework bytes update/delete while project facts remain unchanged.
const update = await runInstalledOusia([
  "install",
  targetRoot,
  "--source",
  updatedSourceRoot,
  "--json",
]);
const updateOutput = JSON.parse(update.stdout);
assertEquals(update.code, 0);
assert(updateOutput.deleted.includes(retired.target));
assertEquals(await exists(join(targetRoot, retired.target)), false);
await assertProjectFacts(targetRoot, projectFacts);
assertStringIncludes(
  await Deno.readTextFile(
    join(targetRoot, ".github/instructions/ousia-workflow.instructions.md"),
  ),
  "smoke-update",
);

const docsCheck = await new Deno.Command(Deno.execPath(), {
  args: [
    "run",
    "--allow-read",
    join(targetRoot, ".github/skills/doc-validation/scripts/check-docs.ts"),
    "--root",
    targetRoot,
  ],
  cwd: targetRoot,
  stdout: "piped",
  stderr: "piped",
}).output();
// Goal: prove the installed documentation checker remains executable in the target project.
// Scope: smoke, installed checker CLI against installed framework and preserved project facts.
// Semantics: the resulting documentation tree satisfies the baseline protocol.
assertEquals(docsCheck.code, 0);

// Goal: reject legacy workflow ownership without partial migration.
// Scope: smoke, installed executable against a legacy target.
// Semantics: install reports the stable conflict and leaves every preexisting byte unchanged.
const legacyRoot = join(repoRoot, "smoke/workdir/legacy-target");
await Deno.remove(legacyRoot, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await Deno.mkdir(join(legacyRoot, ".ousia"), { recursive: true });
await Deno.writeTextFile(join(legacyRoot, "README.md"), "# Legacy\n");
await Deno.writeTextFile(join(legacyRoot, ".ousia/workflow.json"), "{}\n");
const beforeLegacy = await snapshotFiles(legacyRoot);
const blocked = await runInstalledOusia(["install", legacyRoot, "--json"]);
const blockedOutput = JSON.parse(blocked.stdout);
assertEquals(blocked.code, 2);
assertEquals(blockedOutput.blocked, true);
assertEquals(
  blockedOutput.items[0].diagnostic.code,
  "legacy-workflow-manifest",
);
assertEquals(await snapshotFiles(legacyRoot), beforeLegacy);

console.log(`Smoke install target: ${targetRoot}`);
console.log(`Installed files: ${firstOutput.written.length}`);

async function installOusiaCli(): Promise<void> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["task", "install"],
    cwd: repoRoot,
    env: { ...Deno.env.toObject(), DENO_INSTALL_ROOT: cliInstallRoot },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `deno task install failed\nstdout:\n${
        decoder.decode(
          output.stdout,
        )
      }\nstderr:\n${decoder.decode(output.stderr)}`,
    );
  }
}

async function runInstalledOusia(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const executable = Deno.build.os === "windows" ? "ousia.cmd" : "ousia";
  const output = await new Deno.Command(
    join(cliInstallRoot, "bin", executable),
    {
      args,
      cwd: repoRoot,
      stdout: "piped",
      stderr: "piped",
    },
  ).output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await Deno.stat(absolutePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function copyDirectory(
  source: string,
  target: string,
  excluded: string[],
  prefix = "",
): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (excluded.includes(relative)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory) await copyDirectory(from, to, excluded, relative);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

async function digest(content: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(content));
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function snapshotFiles(root: string): Promise<string> {
  const values: string[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory) await visit(path, relative);
      else if (entry.isFile) {
        values.push(`${relative}:${await digest(await Deno.readFile(path))}`);
      }
    }
  }
  await visit(root, "");
  return values.join("\n");
}

async function assertProjectFacts(
  root: string,
  expected: Map<string, string>,
): Promise<void> {
  for (const [path, content] of expected) {
    assertEquals(await Deno.readTextFile(join(root, path)), content);
  }
}
