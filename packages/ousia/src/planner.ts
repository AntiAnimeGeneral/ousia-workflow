import { promises as fs } from "node:fs";
import path from "node:path";
import {
  matchOwnership,
  type OwnershipClass,
  type UpgradePolicy,
} from "./manifest.js";
import type { SourceSnapshot } from "./source.js";

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
  const resolvedTargetRoot = path.resolve(targetRoot);
  const items: PlanItem[] = [];

  for (const file of source.files) {
    const ownershipMatch = matchOwnership(source.manifest, file.relativePath);
    const ownership = ownershipMatch?.ownership ?? null;
    const upgradePolicy = ownershipMatch?.upgradePolicy ?? null;
    const matchedPattern = ownershipMatch?.pattern ?? null;
    const targetPath = path.join(resolvedTargetRoot, file.relativePath);
    const currentTarget = await readTarget(targetPath);

    if (ownershipMatch === null) {
      const itemDiagnostic = diagnostic(
        "target-conflict",
        "error",
        file.relativePath,
        "该路径没有可执行的 ownership 策略",
        "检查 .ousia/workflow.json ownership 和 upgrade policy。",
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        matchedPattern,
        upgradePolicy,
        action: "conflict",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (
      upgradePolicy === "route-and-validate-only" ||
      upgradePolicy === "never-overwrite"
    ) {
      const itemDiagnostic = diagnostic(
        "target-skipped",
        "info",
        file.relativePath,
        "该路径不由 installer 改写",
        null,
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        matchedPattern,
        upgradePolicy,
        action: "skip",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (currentTarget.kind === "directory") {
      const itemDiagnostic = diagnostic(
        "target-directory",
        "error",
        file.relativePath,
        "目标路径是目录，不能用 baseline 文件覆盖",
        "删除或移动该目录后重新运行安装。",
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        matchedPattern,
        upgradePolicy,
        action: "conflict",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (currentTarget.kind === "missing") {
      const itemDiagnostic = diagnostic(
        "target-missing",
        "info",
        file.relativePath,
        "目标项目缺少该文件",
        null,
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        matchedPattern,
        upgradePolicy,
        action: "create",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (currentTarget.content.equals(file.content)) {
      const itemDiagnostic = diagnostic(
        "target-identical",
        "info",
        file.relativePath,
        "目标文件内容已一致",
        null,
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        matchedPattern,
        upgradePolicy,
        action: "identical",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (upgradePolicy === "replace-baseline") {
      const itemDiagnostic = diagnostic(
        "target-replace",
        "info",
        file.relativePath,
        "目标文件内容不同，将用当前 Ousia baseline 覆盖",
        null,
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        matchedPattern,
        upgradePolicy,
        action: "replace",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    const itemDiagnostic = diagnostic(
      "target-conflict",
      "error",
      file.relativePath,
      "该路径没有可执行的 ownership 策略",
      "检查 .ousia/workflow.json ownership 和 upgrade policy。",
    );
    items.push({
      relativePath: file.relativePath,
      ownership,
      matchedPattern,
      upgradePolicy,
      action: "conflict",
      reason: itemDiagnostic.message,
      diagnostic: itemDiagnostic,
    });
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
  | { kind: "file"; content: Buffer };

async function readTarget(absolutePath: string): Promise<TargetRead> {
  try {
    const stat = await fs.stat(absolutePath);
    if (stat.isDirectory()) {
      return { kind: "directory" };
    }

    return { kind: "file", content: await fs.readFile(absolutePath) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { kind: "missing" };
    }
    throw error;
  }
}
