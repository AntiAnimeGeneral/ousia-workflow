import { join, resolve } from "@std/path";
import {
  matchOwnership,
  type OwnershipClass,
  type UpgradePolicy,
} from "./manifest.ts";
import { ManagedRegionError, replaceManagedRegions } from "./managed_region.ts";
import type { SourceSnapshot } from "./source.ts";

export type PlanAction =
  | "create"
  | "identical"
  | "replace"
  | "conflict"
  | "skip";

export type InstallDiagnosticSeverity = "info" | "warning" | "error";

export type InstallDiagnosticCode =
  | "target-missing"
  | "target-identical"
  | "target-managed-regions"
  | "target-managed-region-conflict"
  | "target-replace"
  | "target-skipped"
  | "target-conflict"
  | "target-directory";

export interface InstallDiagnostic {
  phase: "plan";
  code: InstallDiagnosticCode;
  severity: InstallDiagnosticSeverity;
  relativePath: string;
  message: string;
  remediation: string | null;
}

export interface PlanItem {
  relativePath: string;
  ownership: OwnershipClass | null;
  matchedPattern: string | null;
  upgradePolicy: UpgradePolicy | null;
  action: PlanAction;
  reason: string;
  diagnostic: InstallDiagnostic;
  content?: Uint8Array;
}

export interface InstallPlan {
  targetRoot: string;
  items: PlanItem[];
  blocked: boolean;
}

export async function planInstall(
  source: SourceSnapshot,
  targetRoot: string,
): Promise<InstallPlan> {
  const resolvedTargetRoot = resolve(targetRoot);
  const items: PlanItem[] = [];

  for (const file of source.files) {
    const ownershipMatch = matchOwnership(source.manifest, file.relativePath);
    const ownership = ownershipMatch?.ownership ?? null;
    const upgradePolicy = ownershipMatch?.upgradePolicy ?? null;
    const matchedPattern = ownershipMatch?.pattern ?? null;
    const targetPath = join(resolvedTargetRoot, file.relativePath);
    const currentTarget = await readTarget(targetPath);

    if (ownershipMatch === null) {
      items.push(
        planItem(
          file.relativePath,
          ownership,
          matchedPattern,
          upgradePolicy,
          "conflict",
          "target-conflict",
          "error",
          "该路径没有可执行的 ownership 策略",
          "检查 .ousia/workflow.json ownership 和 upgrade policy。",
        ),
      );
      continue;
    }

    if (
      upgradePolicy === "route-and-validate-only" ||
      upgradePolicy === "never-overwrite"
    ) {
      items.push(
        planItem(
          file.relativePath,
          ownership,
          matchedPattern,
          upgradePolicy,
          "skip",
          "target-skipped",
          "info",
          "该路径不由 installer 改写",
          null,
        ),
      );
      continue;
    }

    if (currentTarget.kind === "directory") {
      items.push(
        planItem(
          file.relativePath,
          ownership,
          matchedPattern,
          upgradePolicy,
          "conflict",
          "target-directory",
          "error",
          "目标路径是目录，不能用 baseline 文件覆盖",
          "删除或移动该目录后重新运行安装。",
        ),
      );
      continue;
    }

    if (currentTarget.kind === "missing") {
      items.push(
        planItem(
          file.relativePath,
          ownership,
          matchedPattern,
          upgradePolicy,
          "create",
          "target-missing",
          "info",
          "目标项目缺少该文件",
          null,
        ),
      );
      continue;
    }

    if (bytesEqual(currentTarget.content, file.content)) {
      items.push(
        planItem(
          file.relativePath,
          ownership,
          matchedPattern,
          upgradePolicy,
          "identical",
          "target-identical",
          "info",
          "目标文件内容已一致",
          null,
        ),
      );
      continue;
    }

    if (upgradePolicy === "replace-managed-regions") {
      items.push(
        planManagedRegions(
          file.relativePath,
          ownership,
          matchedPattern,
          upgradePolicy,
          file.content,
          currentTarget.content,
        ),
      );
      continue;
    }

    if (upgradePolicy === "replace-baseline") {
      items.push(
        planItem(
          file.relativePath,
          ownership,
          matchedPattern,
          upgradePolicy,
          "replace",
          "target-replace",
          "info",
          "目标文件内容不同，将用当前 Ousia baseline 覆盖",
          null,
        ),
      );
      continue;
    }

    items.push(
      planItem(
        file.relativePath,
        ownership,
        matchedPattern,
        upgradePolicy,
        "conflict",
        "target-conflict",
        "error",
        "该路径没有可执行的 ownership 策略",
        "检查 .ousia/workflow.json ownership 和 upgrade policy。",
      ),
    );
  }

  return {
    targetRoot: resolvedTargetRoot,
    items,
    blocked: items.some((item) => item.action === "conflict"),
  };
}

export function summarizePlan(plan: InstallPlan): Record<PlanAction, number> {
  const summary: Record<PlanAction, number> = {
    create: 0,
    identical: 0,
    replace: 0,
    conflict: 0,
    skip: 0,
  };

  for (const item of plan.items) {
    summary[item.action] += 1;
  }

  return summary;
}

function planItem(
  relativePath: string,
  ownership: OwnershipClass | null,
  matchedPattern: string | null,
  upgradePolicy: UpgradePolicy | null,
  action: PlanAction,
  code: InstallDiagnosticCode,
  severity: InstallDiagnosticSeverity,
  message: string,
  remediation: string | null,
  content?: Uint8Array,
): PlanItem {
  const itemDiagnostic = diagnostic(
    code,
    severity,
    relativePath,
    message,
    remediation,
  );
  const item: PlanItem = {
    relativePath,
    ownership,
    matchedPattern,
    upgradePolicy,
    action,
    reason: itemDiagnostic.message,
    diagnostic: itemDiagnostic,
  };
  if (content !== undefined) {
    Object.defineProperty(item, "content", {
      enumerable: false,
      value: content,
    });
  }
  return item;
}

function planManagedRegions(
  relativePath: string,
  ownership: OwnershipClass | null,
  matchedPattern: string | null,
  upgradePolicy: UpgradePolicy | null,
  sourceContent: Uint8Array,
  targetContent: Uint8Array,
): PlanItem {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let mergedContent: string;
  try {
    mergedContent = replaceManagedRegions(
      decoder.decode(targetContent),
      decoder.decode(sourceContent),
    );
  } catch (error) {
    const message = error instanceof ManagedRegionError
      ? error.message
      : "Ousia managed region 解析失败";
    return planItem(
      relativePath,
      ownership,
      matchedPattern,
      upgradePolicy,
      "conflict",
      "target-managed-region-conflict",
      "error",
      message,
      "检查目标文件中的 Ousia managed region marker 后重新运行安装。",
    );
  }

  const mergedBytes = encoder.encode(mergedContent);
  if (bytesEqual(targetContent, mergedBytes)) {
    return planItem(
      relativePath,
      ownership,
      matchedPattern,
      upgradePolicy,
      "identical",
      "target-identical",
      "info",
      "目标文件 Ousia managed regions 已一致",
      null,
    );
  }

  return planItem(
    relativePath,
    ownership,
    matchedPattern,
    upgradePolicy,
    "replace",
    "target-managed-regions",
    "info",
    "目标文件 Ousia managed regions 将被当前 baseline 更新",
    null,
    mergedBytes,
  );
}

function diagnostic(
  code: InstallDiagnosticCode,
  severity: InstallDiagnosticSeverity,
  relativePath: string,
  message: string,
  remediation: string | null,
): InstallDiagnostic {
  return {
    phase: "plan",
    code,
    severity,
    relativePath,
    message,
    remediation,
  };
}

type TargetRead =
  | { kind: "missing" }
  | { kind: "directory" }
  | { kind: "file"; content: Uint8Array };

async function readTarget(absolutePath: string): Promise<TargetRead> {
  try {
    const stat = await Deno.stat(absolutePath);
    if (stat.isDirectory) {
      return { kind: "directory" };
    }

    return { kind: "file", content: await Deno.readFile(absolutePath) };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || isNotDirectory(error)) {
      return { kind: "missing" };
    }
    throw error;
  }
}

function isNotDirectory(error: unknown): boolean {
  return error instanceof Deno.errors.NotADirectory ||
    error instanceof Error && error.name === "NotADirectory";
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
