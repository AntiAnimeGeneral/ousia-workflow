import { promises as fs } from "node:fs";
import path from "node:path";
import { writeInstallLock } from "./lock.js";
import { planInstall, type InstallPlan } from "./planner.js";
import { readSourceSnapshot, type SourceSnapshot } from "./source.js";

export interface InstallOptions {
  sourceRoot: string;
  targetRoot: string;
  dryRun?: boolean;
}

export type InstallPhase =
  | "source"
  | "plan"
  | "dry-run"
  | "blocked"
  | "apply"
  | "report";

export interface InstallResult {
  plan: InstallPlan;
  written: string[];
  phases: InstallPhase[];
}

export async function installOusia(
  options: InstallOptions,
): Promise<InstallResult> {
  const source = await readSourceSnapshot(options.sourceRoot);
  const result = await installSnapshot(
    source,
    options.targetRoot,
    options.dryRun ?? false,
  );
  return { ...result, phases: ["source", ...result.phases] };
}

export async function installSnapshot(
  source: SourceSnapshot,
  targetRoot: string,
  dryRun: boolean,
): Promise<InstallResult> {
  const plan = await planInstall(source, targetRoot);
  const phases: InstallPhase[] = ["plan"];
  if (dryRun) {
    return { plan, written: [], phases: [...phases, "dry-run", "report"] };
  }

  if (plan.blocked) {
    return { plan, written: [], phases: [...phases, "blocked", "report"] };
  }

  const sourceByPath = new Map(
    source.files.map((file) => [file.relativePath, file.content]),
  );
  const writableItems = plan.items.filter(
    (item) => item.action === "create" || item.action === "replace",
  );
  const written: string[] = [];
  phases.push("apply");

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

  await writeInstallLock(plan.targetRoot, source);

  phases.push("report");
  return { plan, written, phases };
}
