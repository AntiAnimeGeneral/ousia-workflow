import { basename, dirname, join, resolve } from "@std/path";
import {
  loadManifest,
  normalizeRelativePath,
  type OusiaManifest,
  ownershipForPath,
} from "./manifest.ts";

export interface SourceFile {
  relativePath: string;
  content: Uint8Array;
}

export interface SourceSnapshot {
  root: string;
  manifest: OusiaManifest;
  files: SourceFile[];
}

const skeletonContent = new Map<string, string>([
  [
    ".ousia/pending.md",
    '# Pending\n\n<!-- ousia:managed:start id="pending-items" -->\n## 条目\n<!-- ousia:managed:end id="pending-items" -->\n',
  ],
  [
    ".ousia/design/architecture/index.md",
    '# Architecture\n\n<!-- ousia:managed:start id="architecture-index" -->\n## 入口\n<!-- ousia:managed:end id="architecture-index" -->\n',
  ],
  [
    ".ousia/design/proposal/index.md",
    '# Proposal\n\n<!-- ousia:managed:start id="proposal-current" -->\n## 当前提案\n<!-- ousia:managed:end id="proposal-current" -->\n\n<!-- ousia:managed:start id="proposal-completed" -->\n## 已完成提案\n<!-- ousia:managed:end id="proposal-completed" -->\n',
  ],
  [
    ".ousia/design/experience/index.md",
    '# Experience\n\n<!-- ousia:managed:start id="experience-index" -->\n## 入口\n<!-- ousia:managed:end id="experience-index" -->\n',
  ],
]);

interface SourceCollectionRule {
  name: string;
  collect(root: string, output: Set<string>): Promise<void>;
}

const sourceCollectionRules: SourceCollectionRule[] = [
  {
    name: "workflow skeleton",
    async collect(root, output) {
      await collectExplicitFiles(
        root,
        [".ousia/workflow.json", ".ousia/pending.md"],
        output,
      );
    },
  },
  {
    name: "baseline instructions",
    async collect(root, output) {
      await collectMatchingFiles(
        root,
        ".github/instructions",
        (relativePath) => {
          const name = basename(relativePath);
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
  const root = resolve(sourceRoot);
  const manifestPath = join(root, ".ousia/workflow.json");
  const manifestContent = await Deno.readTextFile(manifestPath);
  const manifest = loadManifest(manifestContent);

  const relativePaths = new Set<string>();
  for (const rule of sourceCollectionRules) {
    await rule.collect(root, relativePaths);
  }

  const files = await Promise.all(
    [...relativePaths].sort().map(async (relativePath) => ({
      relativePath,
      content: await readInstallContent(root, relativePath),
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

async function readInstallContent(
  root: string,
  relativePath: string,
): Promise<Uint8Array> {
  const content = skeletonContent.get(relativePath);
  if (content !== undefined) return new TextEncoder().encode(content);
  return await Deno.readFile(join(root, relativePath));
}

async function collectExplicitFiles(
  root: string,
  files: string[],
  output: Set<string>,
): Promise<void> {
  for (const file of files) {
    if (await exists(join(root, file))) {
      output.add(file);
    }
  }
}

async function collectDesignPrimitiveIndexFiles(
  root: string,
  output: Set<string>,
): Promise<void> {
  const designRoot = join(root, ".ousia/design");
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
  const absoluteDir = join(root, relativeDir);
  if (!(await exists(absoluteDir))) return;

  for await (const entry of Deno.readDir(absoluteDir)) {
    const relativePath = normalizeRelativePath(join(relativeDir, entry.name));
    if (entry.isDirectory) {
      await collectMatchingFiles(root, relativePath, shouldInclude, output);
    } else if (entry.isFile && shouldInclude(relativePath)) {
      output.add(relativePath);
    }
  }
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

export function parentDir(path: string): string {
  return dirname(path);
}
