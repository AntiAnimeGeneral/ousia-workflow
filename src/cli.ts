#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-sys=uid
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import * as applier from "./applier.ts";
import * as installer from "./installer.ts";
import type { InstallResult } from "./installer.ts";
import * as manifest from "./manifest.ts";
import * as planner from "./planner.ts";
import * as source from "./source.ts";

type CliArgs =
  | { command: "check"; root: string; json: boolean }
  | {
    command: "install";
    targetRoot: string;
    sourceRoot: string;
    dryRun: boolean;
    json: boolean;
  };

export async function runCli(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    usage();
    return 1;
  }
  try {
    if (args.command === "check") {
      const snapshot = await source.readSourceSnapshot(args.root);
      const body = {
        ok: true,
        root: snapshot.root,
        assets: snapshot.assets.length,
        checks: snapshot.manifest.validation.checks,
      };
      args.json ? console.log(JSON.stringify(body, null, 2)) : console.log(
        `OK: workflow manifest 与 ${snapshot.assets.length} 个 assets 有效`,
      );
      return 0;
    }
    const result = await installer.installOusia(args);
    args.json
      ? printJson(result, args.dryRun)
      : printHuman(result, args.dryRun);
    return result.plan.blocked ? 2 : 0;
  } catch (error) {
    if (args.json) printError(error);
    else {
      console.error(
        `失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return 1;
  }
}

function parseArgs(argv: string[]): CliArgs {
  const [command, path, ...rest] = argv;
  if (!path || (command !== "check" && command !== "install")) {
    throw new Error("参数错误：需要 `check <root>` 或 `install <target>`");
  }
  let json = false;
  if (command === "check") {
    for (const arg of rest) {
      if (arg === "--json") json = true;
      else throw new Error(`未知参数：${arg}`);
    }
    return { command, root: resolve(path), json };
  }
  let sourceRoot = defaultSourceRoot();
  let dryRun = false;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "--json") json = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--source" && rest[index + 1]) sourceRoot = rest[++index];
    else throw new Error(`未知参数：${arg}`);
  }
  return {
    command,
    targetRoot: resolve(path),
    sourceRoot: resolve(sourceRoot),
    dryRun,
    json,
  };
}
function defaultSourceRoot(): string {
  return resolve(join(dirname(fromFileUrl(import.meta.url)), ".."));
}
function printHuman(result: InstallResult, dryRun: boolean): void {
  const summary = planner.summarizePlan(result.plan);
  console.log(`${dryRun ? "Dry run" : "安装"}摘要：`);
  for (const [action, count] of Object.entries(summary)) {
    console.log(`  ${action}: ${count}`);
  }
  if (result.written.length) console.log(`  written: ${result.written.length}`);
  if (result.deleted.length) console.log(`  deleted: ${result.deleted.length}`);
}
function printJson(result: InstallResult, dryRun: boolean): void {
  console.log(
    JSON.stringify(
      {
        dryRun,
        blocked: result.plan.blocked,
        targetRoot: result.plan.targetRoot,
        phases: result.phases,
        summary: planner.summarizePlan(result.plan),
        items: result.plan.items,
        written: result.written,
        deleted: result.deleted,
      },
      null,
      2,
    ),
  );
}
function printError(error: unknown): void {
  const diagnostics = error instanceof manifest.ManifestError
    ? error.diagnostics
    : error instanceof applier.ApplyError
    ? [error.diagnostic]
    : error instanceof installer.RustCheckerRuntimeError
    ? [{
      phase: error.phase,
      code: error.code,
      path: error.path,
      message: error.message,
      remediation: error.remediation,
      evidence: error.evidence,
    }]
    : [
      {
        code: "workflow-failed",
        path: "",
        message: error instanceof Error ? error.message : String(error),
        remediation: "检查 source、target 和命令参数。",
      },
    ];
  console.log(JSON.stringify({ ok: false, diagnostics }, null, 2));
}
function usage(): void {
  console.error(
    "Usage: ousia check <root> [--json] | ousia install <target> [--source <repoRoot>] [--dry-run] [--json]",
  );
}
if (import.meta.main) Deno.exit(await runCli(Deno.args));
