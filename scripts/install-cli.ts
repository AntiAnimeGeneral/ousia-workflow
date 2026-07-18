import { dirname, fromFileUrl, join } from "@std/path";

const packageRoot = dirname(dirname(fromFileUrl(import.meta.url)));

await run(Deno.execPath(), [
  "install",
  "--global",
  "--force",
  "--config",
  join(packageRoot, "deno.json"),
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-sys=uid",
  "--name",
  "ousia",
  join(packageRoot, "src/cli.ts"),
]);

console.log(
  "Installed ousia CLI. Run `ousia check <source>` or `ousia install <target>`.",
);

async function run(command: string, args: string[]): Promise<void> {
  const output = await new Deno.Command(command, {
    args,
    cwd: packageRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const decoder = new TextDecoder();
  const stdout = decoder.decode(output.stdout);
  const stderr = decoder.decode(output.stderr);
  if (stdout.trim().length > 0) console.log(stdout.trimEnd());
  if (stderr.trim().length > 0) console.error(stderr.trimEnd());
  if (!output.success) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}
