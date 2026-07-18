import { parseArgs } from "@std/cli/parse-args";
import { dirname, resolve } from "@std/path";
import * as checkDocs from "./check-docs-lib.ts";
import * as diagnostics from "./diagnostics.ts";
import { deno } from "./deno-runtime.ts";

const cliArgs = deno.args[0] === "--" ? deno.args.slice(1) : deno.args;
const args = parseArgs(cliArgs, {
  string: ["root"],
  alias: { r: "root" },
});
const defaultRoot = await findOusiaProjectRoot(deno.cwd());
const root = resolveRoot(
  defaultRoot,
  optionalString(args.root) ?? optionalString(args._[0]),
);
const result = await checkDocs.checkDocs(root);

for (const line of diagnostics.formatDiagnostics(result)) {
  if (line.startsWith("ERROR:") || line.startsWith("WARN:")) {
    console.error(line);
  } else {
    console.log(line);
  }
}

if (result.errors.length > 0) {
  deno.exit(1);
}

function resolveRoot(
  defaultRoot: string,
  rootOverride: string | undefined,
): string {
  if (rootOverride) return resolve(deno.cwd(), rootOverride);
  return defaultRoot;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return undefined;
}

async function findOusiaProjectRoot(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    if (
      await isDirectory(resolve(current, ".github")) &&
      await isDirectory(resolve(current, ".ousia"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await deno.stat(path)).isDirectory;
  } catch (error) {
    if (error instanceof deno.errors.NotFound) return false;
    throw error;
  }
}
