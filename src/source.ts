import { join, resolve } from "@std/path";
import * as frontmatter from "../.github/skills/doc-validation/scripts/frontmatter.ts";
import * as digest from "./digest.ts";
import * as manifest from "./manifest.ts";
import type { FrameworkManifest, InstallAsset } from "./manifest.ts";

export interface SourceAsset extends InstallAsset {
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
