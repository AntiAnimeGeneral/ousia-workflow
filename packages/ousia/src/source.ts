import { promises as fs } from "node:fs";
import path from "node:path";
import {
  loadManifest,
  normalizeRelativePath,
  ownershipForPath,
  type OusiaManifest,
} from "./manifest.js";

export interface SourceFile {
  relativePath: string;
  content: Buffer;
}

export interface SourceSnapshot {
  root: string;
  manifest: OusiaManifest;
  files: SourceFile[];
}

interface SourceCollectionRule {
  name: string;
  collect(root: string, output: Set<string>): Promise<void>;
}

const sourceCollectionRules: SourceCollectionRule[] = [
  {
    name: "workflow skeleton",
    async collect(root, output) {
      await collectExplicitFiles(root, [
        ".ousia/workflow.json",
        ".ousia/pending.md",
      ], output);
    },
  },
  {
    name: "baseline instructions",
    async collect(root, output) {
      await collectMatchingFiles(
        root,
        ".github/instructions",
        (relativePath) => {
          const name = path.basename(relativePath);
          return name.startsWith("ousia-") && name.endsWith(".instructions.md");
        },
        output,
      );
    },
  },
  {
    name: "baseline skills",
    async collect(root, output) {
      await collectMatchingFiles(root, ".github/skills", () => true, output);
    },
  },
  {
    name: "design primitive indexes",
    collect: collectDesignPrimitiveIndexFiles,
  },
];

export async function readSourceSnapshot(
  sourceRoot: string,
): Promise<SourceSnapshot> {
  const root = path.resolve(sourceRoot);
  const manifestPath = path.join(root, ".ousia/workflow.json");
  const manifestContent = await fs.readFile(manifestPath, "utf8");
  const manifest = loadManifest(manifestContent);

  const relativePaths = new Set<string>();
  for (const rule of sourceCollectionRules) {
    await rule.collect(root, relativePaths);
  }

  const files = await Promise.all(
    [...relativePaths].sort().map(async (relativePath) => ({
      relativePath,
      content: await fs.readFile(path.join(root, relativePath)),
    })),
  );

  for (const file of files) {
    if (ownershipForPath(manifest, file.relativePath) === null) {
      throw new Error(
        `Source file is not covered by Ousia manifest ownership: ${file.relativePath}`,
      );
    }
  }

  return { root, manifest, files };
}

async function collectExplicitFiles(
  root: string,
  files: string[],
  output: Set<string>,
): Promise<void> {
  for (const file of files) {
    if (await exists(path.join(root, file))) {
      output.add(file);
    }
  }
}

async function collectDesignPrimitiveIndexFiles(
  root: string,
  output: Set<string>,
): Promise<void> {
  const designRoot = path.join(root, ".ousia/design");
  if (!(await exists(designRoot))) return;

  await collectMatchingFiles(
    root,
    ".ousia/design",
    (relativePath) => {
      const normalized = normalizeRelativePath(relativePath);
      return /^\.ousia\/design\/[^/]+\/index\.md$/.test(normalized);
    },
    output,
  );
}

async function collectMatchingFiles(
  root: string,
  relativeDir: string,
  shouldInclude: (relativePath: string) => boolean,
  output: Set<string>,
): Promise<void> {
  const absoluteDir = path.join(root, relativeDir);
  if (!(await exists(absoluteDir))) return;

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = normalizeRelativePath(
      path.join(relativeDir, entry.name),
    );
    if (entry.isDirectory()) {
      await collectMatchingFiles(root, relativePath, shouldInclude, output);
    } else if (entry.isFile() && shouldInclude(relativePath)) {
      output.add(relativePath);
    }
  }
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
