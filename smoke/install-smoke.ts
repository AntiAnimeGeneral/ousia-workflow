import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const repoRoot = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const targetRoot = join(repoRoot, "smoke/workdir/install-target");
const cliInstallRoot = join(repoRoot, "smoke/workdir/cli-install-root");
const cargoInstallRoot = join(repoRoot, "smoke/workdir/cargo-install-root");
const updatedSourceRoot = join(repoRoot, "smoke/workdir/updated-source");
const upgradeRoot = join(repoRoot, "smoke/workdir/checker-upgrade-target");

await Deno.remove(targetRoot, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await Deno.mkdir(targetRoot, { recursive: true });
await Deno.writeTextFile(
  join(targetRoot, "README.md"),
  "# Ousia Install Smoke Target\n",
);

// Goal: prove the machine bootstrap installs both executables repeatably into isolated roots.
// Scope: smoke, cargo-first bootstrap and installed executable identities.
// Semantics: reinstall is safe, both binaries exist, and the installed CLI can validate and dry-run.
await installOusiaCli();
await installOusiaCli();
assertEquals(await exists(checkerExecutable()), true);
assertEquals((await runInstalledOusia(["check", repoRoot])).code, 0);
assertEquals(
  (await runInstalledOusia(["install", targetRoot, "--dry-run"])).code,
  0,
);

// Goal: retire the one supported published checker directory generation through the real installed CLI.
// Scope: smoke, 3b7d447 manifest/tree evidence -> planner -> persistent retirement transaction.
// Semantics: managed checker source is removed, excluded target output survives, and schema 1.1 commits last.
await Deno.remove(upgradeRoot, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await Deno.mkdir(join(upgradeRoot, ".ousia"), { recursive: true });
await Deno.writeTextFile(join(upgradeRoot, "README.md"), "# Upgrade fixture\n");
const predecessorManifest = await commandOutput("git", [
  "show",
  "3b7d447:.ousia/framework.json",
]);
await Deno.writeFile(
  join(upgradeRoot, ".ousia/framework.json"),
  predecessorManifest,
);
const archive = join(upgradeRoot, "checker.tar");
await command("git", [
  "archive",
  "--format=tar",
  `--output=${archive}`,
  "3b7d447",
  ".github/skills/rust-engineering/checker",
]);
await command("tar", ["-xf", archive, "-C", upgradeRoot]);
await Deno.remove(archive);
await Deno.mkdir(
  join(upgradeRoot, ".github/skills/rust-engineering/checker/target/debug"),
  { recursive: true },
);
await Deno.writeTextFile(
  join(
    upgradeRoot,
    ".github/skills/rust-engineering/checker/target/debug/build",
  ),
  "survivor\n",
);
const upgraded = await runInstalledOusia(["install", upgradeRoot, "--json"]);
assertEquals(upgraded.code, 0, upgraded.stderr);
assertEquals(
  await exists(
    join(upgradeRoot, ".github/skills/rust-engineering/checker/src"),
  ),
  false,
);
assertEquals(
  await Deno.readTextFile(
    join(
      upgradeRoot,
      ".github/skills/rust-engineering/checker/target/debug/build",
    ),
  ),
  "survivor\n",
);
assertEquals(
  JSON.parse(
    await Deno.readTextFile(join(upgradeRoot, ".ousia/framework.json")),
  )
    .schemaVersion,
  "1.1.0",
);
const repeatedUpgrade = await runInstalledOusia([
  "install",
  upgradeRoot,
  "--json",
]);
const repeatedUpgradeOutput = JSON.parse(repeatedUpgrade.stdout);
assertEquals(repeatedUpgrade.code, 0, repeatedUpgrade.stderr);
assertEquals(repeatedUpgradeOutput.written.length, 0);
assertEquals(repeatedUpgradeOutput.deleted.length, 0);
assertEquals(
  await Deno.readTextFile(
    join(
      upgradeRoot,
      ".github/skills/rust-engineering/checker/target/debug/build",
    ),
  ),
  "survivor\n",
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
  await exists(join(targetRoot, ".ousia/design/proposal/archive/index.md")),
  true,
);
assertEquals(
  await exists(join(targetRoot, ".github/skills/prompt-surface/SKILL.md")),
  true,
);
const installedManifest = JSON.parse(
  await Deno.readTextFile(join(targetRoot, ".ousia/framework.json")),
);
assertEquals(
  installedManifest.install.assets.some(
    (asset: { id: string }) => asset.id.startsWith("tool.rust-checker"),
  ),
  false,
);
assertEquals(
  installedManifest.install.assets
    .filter((asset: { id: string }) => asset.id.startsWith("tool.docs-"))
    .map((asset: { id: string }) => asset.id),
  [
    "tool.docs-deno",
    "tool.docs-lock",
    "tool.docs-tsconfig",
    "tool.docs-scripts",
  ],
);
assertEquals(
  installedManifest.install.assets.find(
    (asset: { id: string }) => asset.id === "tool.docs-scripts",
  )?.shape,
  "directory",
);
for (
  const docsFile of [
    ".github/skills/doc-validation/scripts/check-docs.ts",
    ".github/skills/doc-validation/scripts/frontmatter.ts",
    ".github/skills/doc-validation/scripts/std-modules.d.ts",
  ]
) {
  assertEquals(await exists(join(targetRoot, docsFile)), true);
}
assertEquals(
  await exists(
    join(targetRoot, ".github/skills/rust-engineering/checker"),
  ),
  false,
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
  [
    ".ousia/project.json",
    '{"schemaVersion":"1.0.0","project":{"name":"smoke-owned-project","rust":{"sourcePaths":[]}}}\n',
  ],
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

const rustChecker = await new Deno.Command(checkerExecutable(), {
  args: ["check-project", "."],
  cwd: targetRoot,
  stdout: "piped",
  stderr: "piped",
}).output();
// Goal: prove the installed Rust checker is distributed and can resolve a host project.
// Scope: smoke, installed checker CLI through the host check-project entry.
// Semantics: a host without Cargo.toml or configured Rust source paths exits successfully as not applicable.
assertEquals(rustChecker.code, 0);
assertStringIncludes(
  new TextDecoder().decode(rustChecker.stdout),
  "NOT APPLICABLE: no Rust project subject configured",
);

const installedRustHost = join(targetRoot, "installed-rust-host");
await Deno.mkdir(join(installedRustHost, "src"), { recursive: true });
await Deno.writeTextFile(
  join(installedRustHost, "Cargo.toml"),
  '[package]\nname = "installed_rust_host"\nversion = "0.1.0"\nedition = "2024"\n',
);
await Deno.writeTextFile(
  join(installedRustHost, "src/lib.rs"),
  "#[test]\nfn missing_gss() { assert!(true); }\n",
);
const installedStrictCheck = await new Deno.Command(checkerExecutable(), {
  args: ["check", join(installedRustHost, "Cargo.toml")],
  cwd: targetRoot,
  stdout: "piped",
  stderr: "piped",
}).output();
// Goal: prove the installed checker enforces mandatory GSS on a real Cargo host.
// Scope: smoke, installed checker CLI against a configured Cargo manifest.
// Semantics: a source-declared test without GSS exits one and emits the stable missing-contract diagnostic.
assertEquals(installedStrictCheck.code, 1);
assertEquals(new TextDecoder().decode(installedStrictCheck.stdout), "");
assertStringIncludes(
  new TextDecoder().decode(installedStrictCheck.stderr),
  "rust-test-contract-missing",
);

const installedLegacyInput = await new Deno.Command(checkerExecutable(), {
  args: ["check", join(installedRustHost, "src/lib.rs")],
  cwd: targetRoot,
  stdout: "piped",
  stderr: "piped",
}).output();
// Goal: prove the installed checker rejects the retired raw-source input path atomically.
// Scope: smoke, installed checker CLI against a legacy .rs selector.
// Semantics: the fatal Cargo-only input failure exits two, keeps stdout empty, and emits the stable subject code on stderr.
assertEquals(installedLegacyInput.code, 2);
assertEquals(new TextDecoder().decode(installedLegacyInput.stdout), "");
assertStringIncludes(
  new TextDecoder().decode(installedLegacyInput.stderr),
  "subject-cargo-manifest-required",
);

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
    env: {
      ...Deno.env.toObject(),
      CARGO_INSTALL_ROOT: cargoInstallRoot,
      DENO_INSTALL_ROOT: cliInstallRoot,
      PATH: `${join(cargoInstallRoot, "bin")}:${Deno.env.get("PATH") ?? ""}`,
    },
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
      env: {
        ...Deno.env.toObject(),
        PATH: `${join(cargoInstallRoot, "bin")}:${Deno.env.get("PATH") ?? ""}`,
      },
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

function checkerExecutable(): string {
  return join(
    cargoInstallRoot,
    "bin",
    Deno.build.os === "windows"
      ? "ousia-rust-checker.exe"
      : "ousia-rust-checker",
  );
}

async function command(command: string, args: string[]): Promise<void> {
  const output = await new Deno.Command(command, {
    args,
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `${command} failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
}

async function commandOutput(
  command: string,
  args: string[],
): Promise<Uint8Array> {
  const output = await new Deno.Command(command, {
    args,
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `${command} failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  return output.stdout;
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
