#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-sys=uid
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { ApplyError } from "./applier.ts";
import { installOusia, type InstallResult } from "./installer.ts";
import { type InstallPlan, summarizePlan } from "./planner.ts";

interface CliArgs {
  command: "install";
  targetRoot: string;
  sourceRoot: string;
  dryRun: boolean;
  json: boolean;
}

export async function runCli(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    printUsage();
    return 1;
  }

  try {
    const result = await installOusia(args);
    if (args.json) {
      printJsonResult(result, args.dryRun);
    } else {
      printPlan(result.plan, args.dryRun, result.written);
    }
    return result.plan.blocked ? 2 : 0;
  } catch (error) {
    if (args.json) {
      printJsonError(error);
    } else {
      console.error(`安装失败：${(error as Error).message}`);
    }
    return 1;
  }
}

function parseArgs(argv: string[]): CliArgs {
  const [command, targetRoot, ...rest] = argv;
  if (command !== "install" || !targetRoot) {
    throw new Error("参数错误：需要 `install <target>`");
  }

  let sourceRoot = defaultSourceRoot();
  let dryRun = false;
  let json = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--source") {
      const value = rest[index + 1];
      if (!value) throw new Error("参数错误：`--source` 需要路径");
      sourceRoot = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return {
    command,
    targetRoot: resolve(targetRoot),
    sourceRoot: resolve(sourceRoot),
    dryRun,
    json,
  };
}

function defaultSourceRoot(): string {
  const packageRoot = resolve(
    join(dirname(fromFileUrl(import.meta.url)), ".."),
  );
  const payloadRoot = join(packageRoot, "payload");
  try {
    if (Deno.statSync(payloadRoot).isDirectory) return payloadRoot;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return packageRoot;
}

function printPlan(
  plan: InstallPlan,
  dryRun: boolean,
  written: string[],
): void {
  const summary = summarizePlan(plan);
  const label = dryRun ? "Dry run" : "安装";
  console.log(`${label} 摘要：`);
  console.log(`  创建：${summary.create}`);
  console.log(`  已一致：${summary.identical}`);
  console.log(`  替换：${summary.replace}`);
  console.log(`  冲突：${summary.conflict}`);
  console.log(`  跳过：${summary.skip}`);

  const blocked = plan.items.filter((item) => item.action === "conflict");
  for (const item of blocked) {
    console.log(`  阻塞 ${item.relativePath}: ${item.reason}`);
  }

  if (!dryRun && written.length > 0) {
    console.log(`  已写入：${written.length}`);
  }
}

function printJsonResult(result: InstallResult, dryRun: boolean): void {
  const body = {
    dryRun,
    blocked: result.plan.blocked,
    targetRoot: result.plan.targetRoot,
    phases: result.phases,
    summary: summarizePlan(result.plan),
    items: result.plan.items,
    written: result.written,
  };
  console.log(JSON.stringify(body, null, 2));
}

function printJsonError(error: unknown): void {
  if (error instanceof ApplyError) {
    console.log(JSON.stringify({ error: error.diagnostic }, null, 2));
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.log(
    JSON.stringify(
      {
        error: {
          phase: "source",
          code: "install-failed",
          severity: "error",
          message,
          remediation: "检查安装源、目标路径和命令参数后重新运行。",
        },
      },
      null,
      2,
    ),
  );
}

function printUsage(): void {
  console.error(
    "Usage: ousia install <target> [--source <repoRoot>] [--dry-run] [--json]",
  );
}

if (import.meta.main) {
  const code = await runCli(Deno.args);
  Deno.exit(code);
}
