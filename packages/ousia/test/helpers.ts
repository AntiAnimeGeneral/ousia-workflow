import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OusiaManifest } from "../src/manifest.js";
import type { SourceSnapshot } from "../src/source.js";

export const repoRoot = path.resolve(process.cwd(), "../..");

export async function makeTempProject(prefix = "ousia-test-"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Minimal Project\n",
    "utf8",
  );
  return root;
}

export async function exists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function copyDir(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === "dist"
    ) {
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

export function makeManifest(
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

export function makeSourceSnapshot(
  files: Record<string, string>,
  manifest: OusiaManifest = makeManifest(),
): SourceSnapshot {
  return {
    root: repoRoot,
    manifest,
    files: Object.entries(files).map(([relativePath, content]) => ({
      relativePath,
      content: Buffer.from(content),
    })),
  };
}
