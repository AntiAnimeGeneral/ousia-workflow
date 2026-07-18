import { join, resolve } from "@std/path";

export const repoRoot = resolve(Deno.cwd());

export async function makeTempProject(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "ousia-test-" });
  await Deno.writeTextFile(join(root, "README.md"), "# Fixture\n");
  return root;
}
