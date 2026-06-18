import { promises as fs } from "node:fs";
import path from "node:path";
import { planInstall, type InstallPlan } from "./planner.js";
import { readSourceSnapshot, type SourceSnapshot } from "./source.js";

export interface InstallOptions {
  sourceRoot: string;
  targetRoot: string;
  dryRun?: boolean;
}

export interface InstallResult {
  plan: InstallPlan;
  written: string[];
}

export async function installOusia(options: InstallOptions): Promise<InstallResult> {
  const source = await readSourceSnapshot(options.sourceRoot);
  return installSnapshot(source, options.targetRoot, options.dryRun ?? false);
}

export async function installSnapshot(
  source: SourceSnapshot,
  targetRoot: string,
  dryRun: boolean,
): Promise<InstallResult> {
  const plan = await planInstall(source, targetRoot);
  if (dryRun || plan.blocked) {
    return { plan, written: [] };
  }

  const sourceByPath = new Map(source.files.map((file) => [file.relativePath, file.content]));
  const writableItems = plan.items.filter((item) => item.action === "create" || item.action === "replace");
  const written: string[] = [];

  for (const item of writableItems) {
    const content = sourceByPath.get(item.relativePath);
    if (content === undefined) {
      throw new Error(`Missing source content for ${item.relativePath}`);
    }

    const targetPath = path.join(plan.targetRoot, item.relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);
    written.push(item.relativePath);
  }

  return { plan, written };
}