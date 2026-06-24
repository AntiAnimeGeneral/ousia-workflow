import { join, resolve } from "@std/path";
import type { OusiaManifest } from "../src/manifest.ts";
import type { SourceSnapshot } from "../src/source.ts";

export const repoRoot = resolve(Deno.cwd());

export async function makeTempProject(
  prefix = "ousia-test-",
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix });
  await Deno.writeTextFile(join(root, "README.md"), "# Minimal Project\n");
  return root;
}

export async function exists(absolutePath: string): Promise<boolean> {
  try {
    await Deno.stat(absolutePath);
    return true;
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.NotADirectory ||
      error instanceof Error &&
        (error.name === "NotFound" || error.name === "NotADirectory")
    ) return false;
    throw error;
  }
}

export async function copyDir(source: string, target: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "smoke" && source === repoRoot
    ) {
      continue;
    }

    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile) {
      await Deno.copyFile(sourcePath, targetPath);
    }
  }
}

export function makeMinimalPolicyManifest(
  overrides: Partial<OusiaManifest> = {},
): OusiaManifest {
  return {
    schemaVersion: "0.1.0",
    workflow: { name: "ousia-workflow", version: "0.1.0" },
    project: { name: "test" },
    ownership: {
      ousiaOwned: [".github/skills/**", ".ousia/workflow.json"],
      ousiaStructuredProjectFilled: [".ousia/pending.md"],
      projectOwned: [],
      localOverrides: [".ousia/overrides/**"],
    },
    upgradePolicy: {
      ousiaOwned: "replace-baseline",
      ousiaStructuredProjectFilled: "replace-baseline",
      projectOwned: "route-and-validate-only",
      localOverrides: "never-overwrite",
    },
    validation: {
      docValidationConfig: null,
      requiredChecks: ["git diff --check"],
    },
    ...overrides,
  };
}

export function makePlannerSourceSnapshot(
  files: Record<string, string>,
  manifest: OusiaManifest = makeMinimalPolicyManifest(),
): SourceSnapshot {
  return {
    root: repoRoot,
    manifest,
    files: Object.entries(files).map(([relativePath, content]) => ({
      relativePath,
      content: new TextEncoder().encode(content),
    })),
  };
}

export async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}
