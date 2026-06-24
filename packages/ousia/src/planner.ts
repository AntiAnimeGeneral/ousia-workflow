import { promises as fs } from "node:fs";
import path from "node:path";
import { ownershipForPath, type OwnershipClass } from "./manifest.js";
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
  | "target-conflict";

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
  diagnostics: InstallDiagnostic[];
  blocked: boolean;
}

export async function planInstall(
  source: SourceSnapshot,
  targetRoot: string,
): Promise<InstallPlan> {
  const resolvedTargetRoot = path.resolve(targetRoot);
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

    if (
      ownership === "ousiaOwned" ||
      ownership === "ousiaStructuredProjectFilled"
    ) {
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
      action: "conflict",
      reason: itemDiagnostic.message,
      diagnostic: itemDiagnostic,
    });
  }

  return {
    targetRoot: resolvedTargetRoot,
    items,
    diagnostics: [],
    blocked: items.some(
      (item) => item.action === "conflict",
    ),
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
