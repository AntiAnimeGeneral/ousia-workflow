import { applyInstallPlan } from "./applier.ts";
import { type InstallPlan, planInstall } from "./planner.ts";
import { readSourceSnapshot, type SourceSnapshot } from "./source.ts";

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

  phases.push("apply");
  const applyResult = await applyInstallPlan(source, plan);

  phases.push("report");
  return { plan, written: applyResult.written, phases };
}
