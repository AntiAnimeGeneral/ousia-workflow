import { join, resolve } from "@std/path";
import { checkRustCheckerIdentity } from "../scripts/rust-checker-identity.ts";

export const repoRoot = resolve(Deno.cwd());

export async function makeTempProject(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "ousia-test-" });
  await Deno.writeTextFile(join(root, "README.md"), "# Fixture\n");
  return root;
}

export async function matchingRustCheckerIdentity(): Promise<
  Deno.CommandOutput
> {
  const identity = await checkRustCheckerIdentity(repoRoot);
  return {
    success: true,
    code: 0,
    signal: null,
    stdout: new TextEncoder().encode(JSON.stringify(identity)),
    stderr: new Uint8Array(),
  };
}
