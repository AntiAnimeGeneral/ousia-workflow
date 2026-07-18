import { join, resolve } from "@std/path";
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
  };
export interface PlanItem {
  assetId: string;
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
  | { kind: "blocked"; description: string };

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
    for (const active of source.manifest.install.assets) {
      if (
        active.ownership === "framework" &&
        targetManifest.manifest.projectFacts.some((slot) =>
          slot.paths.some((pattern) =>
            manifest.matchesGlob(active.target, pattern)
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
        targetSuccessor &&
        targetSuccessor.ownership !== "project"
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
  const current = await readTarget(join(root, asset.target));
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
    );
  }
  return item(
    asset.id,
    asset.source,
    asset.target,
    asset.ownership,
    "replace",
    { kind: "digest", sha256: current.sha256 },
    asset.sha256,
    "target-replace",
    "framework baseline drift 将被替换。",
    null,
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
): PlanItem {
  return {
    assetId,
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

async function readTarget(path: string): Promise<TargetRead> {
  try {
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      return { kind: "blocked", description: "目标路径是 symlink。" };
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
  if (target.kind !== "file") {
    return { kind: "invalid", message: target.description };
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
