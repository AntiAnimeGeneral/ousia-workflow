import { join, relative, resolve, SEPARATOR } from "@std/path";
import * as frontmatter from "../.github/skills/doc-validation/scripts/frontmatter.ts";
import * as digest from "./digest.ts";
import * as manifest from "./manifest.ts";
import type { FrameworkManifest, InstallAsset } from "./manifest.ts";

export interface SourceAsset extends InstallAsset {
  content: Uint8Array | null;
  sha256: string;
  tree?: SourceTreeEntry[];
}

export interface SourceTreeEntry {
  path: string;
  content: Uint8Array;
  sha256: string;
}

export interface SourceSnapshot {
  root: string;
  manifest: FrameworkManifest;
  assets: SourceAsset[];
}

const decoder = new TextDecoder("utf-8", { fatal: true });

export async function readSourceSnapshot(
  sourceRoot: string,
): Promise<SourceSnapshot> {
  const root = resolve(sourceRoot);
  const manifestPath = join(root, manifest.FRAMEWORK_MANIFEST_PATH);
  const manifestBytes = await readRegularFile(
    manifestPath,
    manifest.FRAMEWORK_MANIFEST_PATH,
  );
  const frameworkManifest = manifest.loadFrameworkManifest(
    decode(manifestBytes, manifest.FRAMEWORK_MANIFEST_PATH),
  );
  const assets: SourceAsset[] = [];
  const promptCharacters: Record<string, number> = {};

  for (const asset of frameworkManifest.install.assets) {
    const absolutePath = join(root, asset.source);
    if ((asset.shape ?? "file") === "directory") {
      const tree = await readDirectoryTree(
        absolutePath,
        asset.source,
        asset.exclude ?? [],
      );
      assets.push({
        ...asset,
        content: null,
        tree,
        sha256: await digest.treeSha256(tree),
      });
      continue;
    }
    const content = asset.source === manifest.FRAMEWORK_MANIFEST_PATH
      ? manifestBytes
      : await readRegularFile(absolutePath, asset.source);
    if (asset.kind === "instruction" || asset.kind === "skill") {
      const text = decode(content, asset.source);
      const parsed = frontmatter.parseFrontmatter(text, asset.source);
      if (!parsed.ok) {
        throw new manifest.ManifestError(parsed.diagnostics);
      }
      const key = asset.kind === "instruction" ? "applyTo" : "name";
      const expected = asset.kind === "instruction"
        ? asset.native?.applyTo
        : asset.native?.name;
      if (parsed.document.attributes[key] !== expected) {
        throw new manifest.ManifestError([
          {
            code: "frontmatter-projection",
            path: asset.source,
            message: `${key} 与 framework manifest projection 不一致。`,
            remediation: "使 frontmatter 和 asset.native 保持精确一致。",
          },
        ]);
      }
      if (typeof parsed.document.attributes.description !== "string") {
        throw new manifest.ManifestError([
          {
            code: "frontmatter-required",
            path: asset.source,
            message: "frontmatter 缺少非空 description。",
            remediation: "补充描述该 prompt surface用途的 description。",
          },
        ]);
      }
    }
    if (asset.source.endsWith(".md")) {
      promptCharacters[asset.id] = decode(content, asset.source).length;
    }
    assets.push({ ...asset, content, sha256: await digest.sha256(content) });
  }

  manifest.bindPromptCharacters(frameworkManifest, promptCharacters);
  const allConcerns = frameworkManifest.routing.concerns.map((route) =>
    route.concern
  );
  for (const route of frameworkManifest.routing.tasks) {
    const resolved = manifest.resolveRoute(frameworkManifest, {
      task: route.task,
      mode: route.mode,
      subject: route.subject,
      concerns: allConcerns,
      paths: [],
    });
    if (!resolved.ok) throw new manifest.ManifestError(resolved.diagnostics);
  }
  return { root, manifest: frameworkManifest, assets };
}

async function readRegularFile(
  path: string,
  relativePath: string,
): Promise<Uint8Array> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(path);
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.NotADirectory
    ) {
      throw new manifest.ManifestError([
        {
          code: "source-asset-missing",
          path: relativePath,
          message: "manifest inventory 中的 source asset 不存在。",
          remediation: "恢复 asset 或从 manifest 删除声明。",
        },
      ]);
    }
    throw error;
  }
  if (!stat.isFile || stat.isSymlink) {
    throw new manifest.ManifestError([
      {
        code: "source-asset-type",
        path: relativePath,
        message: "source asset 必须是普通文件，不能是目录或 symlink。",
        remediation: "使用仓库内普通文件。",
      },
    ]);
  }
  return await Deno.readFile(path);
}

async function readDirectoryTree(
  path: string,
  relativePath: string,
  exclude: string[],
): Promise<SourceTreeEntry[]> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(path);
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.NotADirectory
    ) {
      throw new manifest.ManifestError([
        {
          code: "source-asset-missing",
          path: relativePath,
          message: "manifest inventory 中的 source directory asset 不存在。",
          remediation: "恢复目录或从 manifest 删除声明。",
        },
      ]);
    }
    throw error;
  }
  if (stat.isSymlink || !stat.isDirectory) {
    throw new manifest.ManifestError([
      {
        code: "source-asset-type",
        path: relativePath,
        message: "source directory asset 必须是普通目录。",
        remediation: "使用仓库内普通目录，不能是文件、symlink 或特殊文件。",
      },
    ]);
  }
  const entries: SourceTreeEntry[] = [];
  await collectDirectoryEntries(path, path, relativePath, exclude, entries);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectDirectoryEntries(
  root: string,
  current: string,
  sourcePath: string,
  exclude: string[],
  entries: SourceTreeEntry[],
): Promise<void> {
  for await (const entry of Deno.readDir(current)) {
    const absolute = join(current, entry.name);
    const stat = await Deno.lstat(absolute);
    const relativeEntry = relative(root, absolute).split(SEPARATOR).join("/");
    if (isExcluded(relativeEntry, exclude)) continue;
    if (relativeEntry === ".." || relativeEntry.startsWith("../")) {
      throw new manifest.ManifestError([
        {
          code: "source-path-escape",
          path: sourcePath,
          message: "source directory entry 逃逸目录边界。",
          remediation: "移除异常路径。",
        },
      ]);
    }
    if (stat.isSymlink) {
      throw new manifest.ManifestError([
        {
          code: "source-asset-type",
          path: `${sourcePath}/${relativeEntry}`,
          message: "source directory asset 不能包含 symlink。",
          remediation: "移除 symlink，使用普通文件。",
        },
      ]);
    }
    if (stat.isDirectory) {
      await collectDirectoryEntries(
        root,
        absolute,
        sourcePath,
        exclude,
        entries,
      );
      continue;
    }
    if (!stat.isFile) {
      throw new manifest.ManifestError([
        {
          code: "source-asset-type",
          path: `${sourcePath}/${relativeEntry}`,
          message: "source directory asset 只能包含普通文件。",
          remediation: "移除特殊文件。",
        },
      ]);
    }
    const content = await Deno.readFile(absolute);
    entries.push({
      path: relativeEntry,
      content,
      sha256: await digest.sha256(content),
    });
  }
}

function isExcluded(path: string, exclude: string[]): boolean {
  return exclude.some((entry) =>
    path === entry || path.startsWith(`${entry}/`)
  );
}

function decode(content: Uint8Array, path: string): string {
  try {
    return decoder.decode(content);
  } catch {
    throw new manifest.ManifestError([
      {
        code: "source-utf8",
        path,
        message: "文本 asset 不是有效 UTF-8。",
        remediation: "以无 BOM UTF-8 保存文件。",
      },
    ]);
  }
}
