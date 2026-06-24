import { promises as fs } from "node:fs";
import path from "node:path";
import { lockHashFor, readInstallLock, sha256 } from "./lock.js";
import { ownershipForPath, type OwnershipClass } from "./manifest.js";
import type { SourceSnapshot } from "./source.js";

export type PlanAction =
  | "create"
  | "identical"
  | "replace"
  | "conflict"
  | "unsupported-merge"
  | "skip";

export type InstallDiagnosticSeverity = "info" | "warning" | "error";

export type InstallDiagnosticCode =
  | "target-missing"
  | "target-identical"
  | "target-unmodified-update"
  | "target-skipped"
  | "target-conflict"
  | "structured-merge-unsupported";

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
  const installLock = await readInstallLock(resolvedTargetRoot);
  const items: PlanItem[] = [];

  for (const file of source.files) {
    const ownership = ownershipForPath(source.manifest, file.relativePath);
    const targetPath = path.join(resolvedTargetRoot, file.relativePath);
    const currentContent = await readOptional(targetPath);

    if (ownership === "projectOwned" || ownership === "localOverrides") {
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
        action: "skip",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (currentContent === null) {
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
        action: "create",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (currentContent.equals(file.content)) {
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
        action: "identical",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    const previousHash = lockHashFor(installLock, file.relativePath);
    const targetUnmodifiedSinceLastInstall =
      previousHash !== null && previousHash === sha256(currentContent);

    if (targetUnmodifiedSinceLastInstall && ownership === "ousiaOwned") {
      const itemDiagnostic = diagnostic(
        "target-unmodified-update",
        "info",
        file.relativePath,
        "目标文件与上次安装记录一致，可更新为当前 Ousia 内容",
        null,
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "replace",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (ownership === "ousiaOwned") {
      const itemDiagnostic = diagnostic(
        "target-conflict",
        "error",
        file.relativePath,
        "Ousia-owned 文件已存在且内容不同，第一版不会静默覆盖",
        "保留目标文件并手动解决本地改动后重试安装。",
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "conflict",
        reason: itemDiagnostic.message,
        diagnostic: itemDiagnostic,
      });
      continue;
    }

    if (ownership === "ousiaStructuredProjectFilled") {
      const itemDiagnostic = diagnostic(
        "structured-merge-unsupported",
        "warning",
        file.relativePath,
        "该文件需要 section merge，第一版只报告不改写",
        "手动合并项目填充内容，或等待 installer 支持 section merge。",
      );
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "unsupported-merge",
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
      action: "conflict",
      reason: itemDiagnostic.message,
      diagnostic: itemDiagnostic,
    });
  }

  return {
    targetRoot: resolvedTargetRoot,
    items,
    blocked: items.some(
      (item) =>
        item.action === "conflict" || item.action === "unsupported-merge",
    ),
  };
}

export function summarizePlan(plan: InstallPlan): Record<PlanAction, number> {
  const summary: Record<PlanAction, number> = {
    create: 0,
    identical: 0,
    replace: 0,
    conflict: 0,
    "unsupported-merge": 0,
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

async function readOptional(absolutePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
