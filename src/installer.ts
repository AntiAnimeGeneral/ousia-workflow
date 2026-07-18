import * as applier from "./applier.ts";
import * as planner from "./planner.ts";
import type { InstallPlan } from "./planner.ts";
import * as source from "./source.ts";

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
  deleted: string[];
  phases: InstallPhase[];
}

export async function installOusia(
  options: InstallOptions,
): Promise<InstallResult> {
  const snapshot = await source.readSourceSnapshot(options.sourceRoot);
  const plan = await planner.planInstall(snapshot, options.targetRoot);
  const phases: InstallPhase[] = ["source", "plan"];
  if (options.dryRun) {
    return {
      plan,
      written: [],
      deleted: [],
      phases: [...phases, "dry-run", "report"],
    };
  }
  if (plan.blocked) {
    return {
      plan,
      written: [],
      deleted: [],
      phases: [...phases, "blocked", "report"],
    };
  }
  const result = await applier.applyInstallPlan(snapshot, plan);
  return {
    plan,
    written: result.written,
    deleted: result.deleted,
    phases: [...phases, "apply", "report"],
  };
}
