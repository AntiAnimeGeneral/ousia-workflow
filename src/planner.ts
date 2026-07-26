import { join, relative, resolve, SEPARATOR } from "@std/path";
import * as digest from "./digest.ts";
import * as manifest from "./manifest.ts";
import type { SourceAsset, SourceSnapshot } from "./source.ts";

export type PlanAction =
  | "create"
  | "identical"
  | "replace"
  | "preserve"
  | "delete"
  | "conflict";
export interface InstallDiagnostic {
  phase: "plan";
  code: string;
  severity: "info" | "error";
  relativePath: string;
  message: string;
  remediation: string | null;
}
export type TargetPrecondition =
  | { kind: "missing" }
  | {
    kind: "digest";
    sha256: string;
    shape?: "file" | "directory";
  };
export interface PlanItem {
  assetId: string;
  shape?: "file" | "directory";
  exclude?: string[];
  source: string | null;
  target: string;
  ownership: "framework" | "project";
  action: PlanAction;
  precondition: TargetPrecondition | null;
  sourceSha256: string | null;
  diagnostic: InstallDiagnostic;
}
export interface InstallPlan {
  targetRoot: string;
  items: PlanItem[];
  blocked: boolean;
}

type TargetRead =
  | { kind: "missing" }
  | {
    kind: "file";
    content: Uint8Array;
    sha256: string;
  }
  | {
    kind: "directory";
    entries: digest.TreeEntry[];
    sha256: string;
  }
  | { kind: "blocked"; description: string };
type DirectoryRead =
  | { ok: true; entries: digest.TreeEntry[] }
  | { ok: false; description: string };

export async function planInstall(
  source: SourceSnapshot,
  targetRoot: string,
): Promise<InstallPlan> {
  const root = resolve(targetRoot);
  const items: PlanItem[] = [];
  const targetManifest = await readTargetManifest(root);

  if (targetManifest.kind === "legacy") {
    return blockedPlan(
      root,
      "legacy-workflow-manifest",
      ".ousia/workflow.json",
      "目标包含不受支持的旧 workflow manifest。",
      "使用 Git 保存项目事实，移除旧 baseline 后重新安装。",
    );
  }
  if (targetManifest.kind === "invalid") {
    return blockedPlan(
      root,
      "target-manifest-invalid",
      manifest.FRAMEWORK_MANIFEST_PATH,
      targetManifest.message,
      "修复或移除未知目标 manifest 后重新安装。",
    );
  }

  for (const asset of source.assets) items.push(await planAsset(root, asset));
  if (targetManifest.kind === "valid") {
    if (targetManifest.manifest.workflow.id !== source.manifest.workflow.id) {
      return blockedPlan(
        root,
        "target-workflow-mismatch",
        manifest.FRAMEWORK_MANIFEST_PATH,
        "目标 manifest 属于不同 workflow。",
        "不要使用另一 workflow 的 manifest 作为 retirement evidence。",
      );
    }
    const oldAssets = new Map(
      targetManifest.manifest.install.assets.map((asset) => [asset.id, asset]),
    );
    const activeIds = new Set(
      source.manifest.install.assets.map((asset) => asset.id),
    );
    const tombstones = new Map(
      source.manifest.install.retiredAssets.map((item) => [item.id, item]),
    );
    const activeById = new Map(
      source.manifest.install.assets.map((asset) => [asset.id, asset]),
    );
    const activeByTarget = new Map(
      source.manifest.install.assets.map((asset) => [asset.target, asset]),
    );
    const activeDirectories = source.manifest.install.assets.filter((asset) =>
      (asset.shape ?? "file") === "directory"
    );
    const oldDirectories = new Set(
      targetManifest.manifest.install.assets
        .filter((asset) => (asset.shape ?? "file") === "directory")
        .map((asset) => asset.id),
    );
    for (const active of source.manifest.install.assets) {
      if (
        active.ownership === "framework" &&
        targetManifest.manifest.projectFacts.some((slot) =>
          slot.paths.some((pattern) =>
            manifest.matchesGlob(active.target, pattern) ||
            ((active.shape ?? "file") === "directory" &&
              patternUnderDirectory(active.target, pattern))
          )
        )
      ) {
        items.push(
          item(
            active.id,
            active.source,
            active.target,
            "framework",
            "conflict",
            null,
            source.assets.find((asset) => asset.id === active.id)?.sha256 ??
              null,
            "project-slot-reclassified",
            "新 framework target 被旧 project fact slot覆盖。",
            "使用新target，或保留project ownership。",
          ),
        );
      }
    }
    for (const old of targetManifest.manifest.install.assets) {
      const targetSuccessor = activeByTarget.get(old.target);
      if (
        old.ownership === "project" &&
        ((targetSuccessor && targetSuccessor.ownership !== "project") ||
          activeDirectories.some((asset) =>
            pathContains(asset.target, old.target)
          ))
      ) {
        items.push(
          item(
            old.id,
            null,
            old.target,
            "project",
            "conflict",
            null,
            null,
            "project-ownership-reclassified",
            "旧 project-owned target 被新 framework asset 接管。",
            "保留project ownership，或为framework使用新target。",
          ),
        );
        continue;
      }
      if (
        old.ownership === "framework" &&
        activeDirectories.some((asset) =>
          (asset.shape ?? "file") === "directory" &&
          !oldDirectories.has(asset.id) &&
          pathContains(asset.target, old.target)
        )
      ) {
        continue;
      }
      if (activeIds.has(old.id)) {
        const active = activeById.get(old.id)!;
        if (
          active.target !== old.target ||
          active.ownership !== old.ownership ||
          active.kind !== old.kind
        ) {
          items.push(
            item(
              old.id,
              null,
              old.target,
              old.ownership,
              "conflict",
              null,
              null,
              "asset-identity-changed",
              "同一 asset ID 跨版本改变了 target、ownership或kind。",
              "为新asset分配新ID，并为旧framework asset声明tombstone。",
            ),
          );
        }
        continue;
      }
      if (old.ownership === "project") continue;
      if (!tombstones.has(old.id)) {
        items.push(
          item(
            old.id,
            null,
            old.target,
            "framework",
            "conflict",
            null,
            null,
            "retirement-tombstone-missing",
            "旧 framework asset 已退出 inventory，但当前 source 未授权 tombstone。",
            "添加可信 tombstone 或恢复 active asset。",
          ),
        );
      }
    }
    for (const directoryAsset of activeDirectories) {
      if (!oldDirectories.has(directoryAsset.id)) {
        const oldOwnedTargets = targetManifest.manifest.install.assets
          .filter((asset) =>
            asset.ownership === "framework" &&
            (asset.shape ?? "file") === "file" &&
            pathContains(directoryAsset.target, asset.target)
          )
          .map((asset) => asset.target);
        const oldOwnedDirectoryTargets = targetManifest.manifest.install.assets
          .filter((asset) =>
            asset.ownership === "framework" &&
            (asset.shape ?? "file") === "directory" &&
            pathContains(directoryAsset.target, asset.target)
          )
          .map((asset) => asset.target);
        const unknown = await findUnknownDirectoryChildren(
          root,
          directoryAsset.target,
          oldOwnedTargets,
          oldOwnedDirectoryTargets,
          directoryAsset.exclude ?? [],
        );
        for (const child of unknown) {
          items.push(
            item(
              directoryAsset.id,
              directoryAsset.source,
              child,
              "framework",
              "conflict",
              null,
              source.assets.find((asset) => asset.id === directoryAsset.id)
                ?.sha256 ?? null,
              "directory-unknown-child",
              "迁移目录中存在未由旧 framework membership 覆盖的 child entry。",
              "保留/移动该文件，或先让旧 manifest 明确拥有该目录边界。",
              "directory",
              directoryAsset.exclude,
            ),
          );
        }
      }
    }
    for (const tombstone of source.manifest.install.retiredAssets) {
      const old = oldAssets.get(tombstone.id);
      const current = await readTarget(join(root, tombstone.target));
      if (current.kind === "missing") continue;
      if (
        !old ||
        old.ownership !== "framework" ||
        old.target !== tombstone.target ||
        current.kind !== "file" ||
        current.sha256 !== tombstone.sha256
      ) {
        items.push(
          item(
            tombstone.id,
            null,
            tombstone.target,
            "framework",
            "conflict",
            null,
            null,
            "retirement-conflict",
            "retirement 缺少旧 membership 或 digest evidence。",
            "保留目标并人工检查。",
          ),
        );
      } else {
        items.push(
          item(
            tombstone.id,
            null,
            tombstone.target,
            "framework",
            "delete",
            { kind: "digest", sha256: current.sha256 },
            null,
            "target-retire",
            "可信 tombstone 将删除旧 framework asset。",
            null,
          ),
        );
      }
    }
  }

  items.sort(
    (left, right) =>
      Number(left.target === manifest.FRAMEWORK_MANIFEST_PATH) -
      Number(right.target === manifest.FRAMEWORK_MANIFEST_PATH),
  );
  return {
    targetRoot: root,
    items,
    blocked: items.some((entry) => entry.action === "conflict"),
  };
}

export function summarizePlan(plan: InstallPlan): Record<PlanAction, number> {
  const summary: Record<PlanAction, number> = {
    create: 0,
    identical: 0,
    replace: 0,
    preserve: 0,
    delete: 0,
    conflict: 0,
  };
  plan.items.forEach((entry) => summary[entry.action]++);
  return summary;
}

async function planAsset(root: string, asset: SourceAsset): Promise<PlanItem> {
  const current = await readTarget(
    join(root, asset.target),
    asset.exclude ?? [],
  );
  const shape = asset.shape ?? "file";
  if (current.kind === "blocked") {
    return item(
      asset.id,
      asset.source,
      asset.target,
      asset.ownership,
      "conflict",
      null,
      asset.sha256,
      "target-type",
      current.description,
      "移除目录、symlink 或特殊文件后重试。",
      shape,
      asset.exclude,
    );
  }
  if (shape === "directory" && current.kind === "file") {
    return item(
      asset.id,
      asset.source,
      asset.target,
      asset.ownership,
      "conflict",
      null,
      asset.sha256,
      "target-type",
      "目标路径不是普通目录。",
      "移除文件、symlink 或特殊文件后重试。",
      shape,
      asset.exclude,
    );
  }
  if (shape === "file" && current.kind === "directory") {
    return item(
      asset.id,
      asset.source,
      asset.target,
      asset.ownership,
      "conflict",
      null,
      asset.sha256,
      "target-type",
      "目标路径不是普通文件。",
      "移除目录、symlink 或特殊文件后重试。",
      shape,
      asset.exclude,
    );
  }
  if (asset.ownership === "project" && current.kind !== "missing") {
    return item(
      asset.id,
      asset.source,
      asset.target,
      asset.ownership,
      "preserve",
      null,
      asset.sha256,
      "target-preserve",
      "project fact 已存在，逐字保留。",
      null,
      shape,
      asset.exclude,
    );
  }
  if (current.kind === "missing") {
    return item(
      asset.id,
      asset.source,
      asset.target,
      asset.ownership,
      "create",
      { kind: "missing" },
      asset.sha256,
      "target-missing",
      "目标缺少 asset。",
      null,
      shape,
      asset.exclude,
    );
  }
  if (current.sha256 === asset.sha256) {
    return item(
      asset.id,
      asset.source,
      asset.target,
      asset.ownership,
      "identical",
      null,
      asset.sha256,
      "target-identical",
      "目标内容已一致。",
      null,
      shape,
      asset.exclude,
    );
  }
  return item(
    asset.id,
    asset.source,
    asset.target,
    asset.ownership,
    "replace",
    { kind: "digest", sha256: current.sha256, shape },
    asset.sha256,
    "target-replace",
    "framework baseline drift 将被替换。",
    null,
    shape,
    asset.exclude,
  );
}

function item(
  assetId: string,
  source: string | null,
  target: string,
  ownership: "framework" | "project",
  action: PlanAction,
  precondition: TargetPrecondition | null,
  sourceSha256: string | null,
  code: string,
  message: string,
  remediation: string | null,
  shape: "file" | "directory" = "file",
  exclude: string[] | undefined = undefined,
): PlanItem {
  return {
    assetId,
    shape,
    exclude,
    source,
    target,
    ownership,
    action,
    precondition,
    sourceSha256,
    diagnostic: {
      phase: "plan",
      code,
      severity: action === "conflict" ? "error" : "info",
      relativePath: target,
      message,
      remediation,
    },
  };
}

async function readTarget(
  path: string,
  exclude: string[] = [],
): Promise<TargetRead> {
  try {
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      return { kind: "blocked", description: "目标路径是 symlink。" };
    }
    if (stat.isDirectory) {
      const entries = await readTargetDirectory(path, path, exclude);
      if (!entries.ok) {
        return { kind: "blocked", description: entries.description };
      }
      return {
        kind: "directory",
        entries: entries.entries,
        sha256: await digest.treeSha256(entries.entries),
      };
    }
    if (!stat.isFile) {
      return { kind: "blocked", description: "目标路径不是普通文件。" };
    }
    const content = await Deno.readFile(path);
    return { kind: "file", content, sha256: await digest.sha256(content) };
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.NotADirectory
    ) {
      return { kind: "missing" };
    }
    throw error;
  }
}

async function readTargetDirectory(
  root: string,
  current: string,
  exclude: string[],
): Promise<DirectoryRead> {
  const entries: digest.TreeEntry[] = [];
  for await (const entry of Deno.readDir(current)) {
    const absolute = join(current, entry.name);
    const relativeEntry = relative(root, absolute).split(SEPARATOR).join("/");
    if (isExcluded(relativeEntry, exclude)) continue;
    const stat = await Deno.lstat(absolute);
    if (stat.isSymlink) {
      return { ok: false, description: "目标目录包含 symlink。" };
    }
    if (stat.isDirectory) {
      const nested = await readTargetDirectory(root, absolute, exclude);
      if (!nested.ok) return nested;
      entries.push(...nested.entries);
      continue;
    }
    if (!stat.isFile) {
      return { ok: false, description: "目标目录包含特殊文件。" };
    }
    const content = await Deno.readFile(absolute);
    entries.push({
      path: relativeEntry,
      sha256: await digest.sha256(content),
    });
  }
  return {
    ok: true,
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

async function findUnknownDirectoryChildren(
  root: string,
  directoryTarget: string,
  ownedTargets: string[],
  ownedDirectoryTargets: string[],
  exclude: string[],
): Promise<string[]> {
  const absolute = join(root, directoryTarget);
  try {
    const stat = await Deno.lstat(absolute);
    if (!stat.isDirectory || stat.isSymlink) return [];
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.NotADirectory
    ) return [];
    throw error;
  }
  const read = await readTarget(absolute, exclude);
  if (read.kind !== "directory") return [];
  const owned = new Set(ownedTargets);
  const ownedDirectories = new Set(ownedDirectoryTargets);
  for (const target of ownedTargets) {
    let parent = dirnameTarget(target);
    while (parent && pathContains(directoryTarget, parent)) {
      owned.add(parent);
      if (parent === directoryTarget) break;
      parent = dirnameTarget(parent);
    }
  }
  const children = await listDirectoryChildren(absolute, absolute, exclude);
  return children
    .map((entry) => `${directoryTarget}/${entry}`)
    .filter((target) =>
      !owned.has(target) &&
      ![...ownedDirectories].some((directory) =>
        pathContains(directory, target)
      )
    );
}

function pathContains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function dirnameTarget(target: string): string | null {
  const index = target.lastIndexOf("/");
  if (index <= 0) return null;
  return target.slice(0, index);
}

function patternUnderDirectory(directory: string, pattern: string): boolean {
  return !pattern.includes("*") && pathContains(directory, pattern);
}

async function listDirectoryChildren(
  root: string,
  current: string,
  exclude: string[],
): Promise<string[]> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(current)) {
    const absolute = join(current, entry.name);
    const relativePath = relative(root, absolute).split(SEPARATOR).join("/");
    if (isExcluded(relativePath, exclude)) continue;
    entries.push(relativePath);
    const stat = await Deno.lstat(absolute);
    if (stat.isDirectory && !stat.isSymlink) {
      entries.push(...await listDirectoryChildren(root, absolute, exclude));
    }
  }
  return entries;
}

function isExcluded(path: string, exclude: string[]): boolean {
  return exclude.some((entry) =>
    path === entry || path.startsWith(`${entry}/`)
  );
}

type TargetManifest =
  | { kind: "missing" }
  | { kind: "legacy" }
  | {
    kind: "invalid";
    message: string;
  }
  | {
    kind: "valid";
    manifest: ReturnType<typeof manifest.loadFrameworkManifest>;
  };
async function readTargetManifest(root: string): Promise<TargetManifest> {
  try {
    const legacy = await Deno.lstat(join(root, ".ousia/workflow.json"));
    if (legacy) return { kind: "legacy" };
  } catch (error) {
    if (
      !(
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.NotADirectory
      )
    ) {
      throw error;
    }
  }
  const target = await readTarget(join(root, manifest.FRAMEWORK_MANIFEST_PATH));
  if (target.kind === "missing") return { kind: "missing" };
  if (target.kind === "blocked") {
    return { kind: "invalid", message: target.description };
  }
  if (target.kind === "directory") {
    return { kind: "invalid", message: "目标 manifest 是目录。" };
  }
  try {
    return {
      kind: "valid",
      manifest: manifest.loadFrameworkManifest(
        new TextDecoder("utf-8", { fatal: true }).decode(target.content),
      ),
    };
  } catch (error) {
    return {
      kind: "invalid",
      message: error instanceof manifest.ManifestError
        ? error.message
        : "目标 manifest 无效。",
    };
  }
}

function blockedPlan(
  root: string,
  code: string,
  path: string,
  message: string,
  remediation: string,
): InstallPlan {
  return {
    targetRoot: root,
    blocked: true,
    items: [
      item(
        "conflict",
        null,
        path,
        "framework",
        "conflict",
        null,
        null,
        code,
        message,
        remediation,
      ),
    ],
  };
}
