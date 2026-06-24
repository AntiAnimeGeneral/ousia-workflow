import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const repoRoot = resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
const targetRoot = join(repoRoot, "smoke/workdir/install-target");
const cliInstallRoot = join(repoRoot, "smoke/workdir/cli-install-root");

await Deno.remove(targetRoot, { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await Deno.mkdir(targetRoot, { recursive: true });
await Deno.writeTextFile(
  join(targetRoot, "README.md"),
  "# Ousia Install Smoke Target\n",
);

await installOusiaCli();
await installOusiaCli();
await runInstalledOusia(["install", targetRoot, "--dry-run"]);

const firstInstall = await runOusia([
  "install",
  targetRoot,
  "--json",
]);
const firstOutput = JSON.parse(firstInstall.stdout);
assertEquals(firstInstall.code, 0);
assertEquals(firstOutput.blocked, false);
assert(firstOutput.written.length > 0);
assertEquals(await exists(join(targetRoot, ".ousia/workflow.json")), true);
assertEquals(
  await exists(join(targetRoot, ".github/skills/prompt-surface/SKILL.md")),
  true,
);

const secondInstall = await runOusia([
  "install",
  targetRoot,
  "--json",
]);
const secondOutput = JSON.parse(secondInstall.stdout);
assertEquals(secondInstall.code, 0);
assertEquals(secondOutput.written.length, 0);
assertEquals(
  secondOutput.items.every((item: { action: string }) =>
    item.action === "identical"
  ),
  true,
);

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
        decoder.decode(output.stdout)
      }\nstderr:\n${decoder.decode(output.stderr)}`,
    );
  }
}

async function runInstalledOusia(args: string[]): Promise<void> {
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
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `installed ousia failed\nstdout:\n${
        decoder.decode(output.stdout)
      }\nstderr:\n${decoder.decode(output.stderr)}`,
    );
  }
}

async function runOusia(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
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
  }).output();
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
