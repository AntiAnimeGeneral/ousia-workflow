import * as applier from "./applier.ts";
import * as planner from "./planner.ts";
import type { InstallPlan } from "./planner.ts";
import * as source from "./source.ts";
import {
  decodeRustCheckerBuildIdentity,
  decodeRustCheckerBuildIdentityJson,
} from "../scripts/rust-checker-identity.ts";

export interface InstallOptions {
  sourceRoot: string;
  targetRoot: string;
  dryRun?: boolean;
  runRustCheckerIdentity?: () => Promise<Deno.CommandOutput>;
}
export type InstallPhase =
  | "source"
  | "runtime-preflight"
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
  await verifyRustCheckerRuntime(
    snapshot.runtimeRustChecker.buildIdentity,
    options.runRustCheckerIdentity,
  );
  const plan = await planner.planInstall(snapshot, options.targetRoot);
  const phases: InstallPhase[] = ["source", "runtime-preflight", "plan"];
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

async function verifyRustCheckerRuntime(
  expected: unknown,
  runIdentity: () => Promise<Deno.CommandOutput> = defaultRunIdentity,
): Promise<void> {
  let output: Deno.CommandOutput;
  try {
    output = await runIdentity();
  } catch (error) {
    throw new RustCheckerRuntimeError(
      "rust-checker-runtime-missing",
      `无法执行 ousia-rust-checker：${error}`,
      "确认全局binary位于PATH且当前进程拥有执行权限；在source checkout运行 `deno task install` 后重试。",
      { locator: "ousia-rust-checker" },
    );
  }
  if (!output.success) {
    throw new RustCheckerRuntimeError(
      "rust-checker-runtime-failed",
      `ousia-rust-checker identity退出${output.code}。`,
      "检查checker stderr并重新运行machine bootstrap。",
      {
        exitCode: output.code.toString(),
        stderr: new TextDecoder().decode(output.stderr).trim(),
      },
    );
  }
  let actual: ReturnType<typeof decodeRustCheckerBuildIdentity>;
  try {
    actual = decodeRustCheckerBuildIdentityJson(
      new TextDecoder().decode(output.stdout),
      "ousia-rust-checker identity",
    );
  } catch (error) {
    throw new RustCheckerRuntimeError(
      "rust-checker-runtime-invalid",
      `ousia-rust-checker identity不是有效JSON：${error}`,
      "重新运行machine bootstrap，确保PATH只命中当前ousia-rust-checker。",
      { locator: "ousia-rust-checker" },
    );
  }
  let expectedIdentity: ReturnType<typeof decodeRustCheckerBuildIdentity>;
  try {
    expectedIdentity = decodeRustCheckerBuildIdentity(
      expected,
      "source rust checker identity",
    );
  } catch (error) {
    throw new RustCheckerRuntimeError(
      "rust-checker-runtime-invalid",
      `source rust checker identity无效：${error}`,
      "修复source manifest与identity artifact后重新发布。",
      { owner: "source.runtime.rustChecker" },
    );
  }
  if (JSON.stringify(actual) !== JSON.stringify(expectedIdentity)) {
    throw new RustCheckerRuntimeError(
      "rust-checker-runtime-mismatch",
      "全局ousia-rust-checker与当前source generation不一致。",
      "在当前source checkout运行 `deno task install`，确保checker与CLI来自同一generation。",
      {
        expectedSha256: expectedIdentity.sourceSha256,
        actualSha256: actual.sourceSha256,
      },
    );
  }
}

function defaultRunIdentity(): Promise<Deno.CommandOutput> {
  return new Deno.Command("ousia-rust-checker", {
    args: ["identity", "--format", "json"],
    clearEnv: true,
    env: checkerRuntimeEnvironment(),
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function checkerRuntimeEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(Deno.env.toObject()).filter(([name]) => {
      const normalized = name.trim().toUpperCase();
      return !normalized.startsWith("LD_") &&
        !normalized.startsWith("DYLD_");
    }),
  );
}

export class RustCheckerRuntimeError extends Error {
  readonly phase = "runtime-preflight" as const;
  readonly path = "runtime.rustChecker";
  constructor(
    readonly code: string,
    message: string,
    readonly remediation: string,
    readonly evidence: Record<string, string>,
  ) {
    super(message);
    this.name = "RustCheckerRuntimeError";
  }
}
