import { promises as fs } from "node:fs";
import path from "node:path";
import { ownershipForPath, type OwnershipClass } from "./manifest.js";
import type { SourceSnapshot } from "./source.js";

export type PlanAction =
  | "create"
  | "identical"
  | "replace"
  | "conflict"
  | "unsupported-merge"
  | "skip";

export interface PlanItem {
  relativePath: string;
  ownership: OwnershipClass | null;
  action: PlanAction;
  reason: string;
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
    const ownership = ownershipForPath(source.manifest, file.relativePath);
    const targetPath = path.join(resolvedTargetRoot, file.relativePath);
    const currentContent = await readOptional(targetPath);

    if (ownership === "projectOwned" || ownership === "localOverrides") {
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "skip",
        reason: "该路径不由 installer 改写",
      });
      continue;
    }

    if (currentContent === null) {
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "create",
        reason: "目标项目缺少该文件",
      });
      continue;
    }

    if (currentContent.equals(file.content)) {
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "identical",
        reason: "目标文件内容已一致",
      });
      continue;
    }

    if (ownership === "ousiaOwned") {
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "conflict",
        reason: "Ousia-owned 文件已存在且内容不同，第一版不会静默覆盖",
      });
      continue;
    }

    if (ownership === "ousiaStructuredProjectFilled") {
      items.push({
        relativePath: file.relativePath,
        ownership,
        action: "unsupported-merge",
        reason: "该文件需要 section merge，第一版只报告不改写",
      });
      continue;
    }

    items.push({
      relativePath: file.relativePath,
      ownership,
      action: "conflict",
      reason: "该路径没有可执行的 ownership 策略",
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
