#!/usr/bin/env node
import path from "node:path";
import { installOusia } from "./installer.js";
import { summarizePlan, type InstallPlan } from "./planner.js";

interface CliArgs {
  command: "install";
  targetRoot: string;
  sourceRoot: string;
  dryRun: boolean;
}

async function main(argv: string[]): Promise<number> {
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
    printPlan(result.plan, args.dryRun, result.written);
    return result.plan.blocked ? 2 : 0;
  } catch (error) {
    console.error(`安装失败：${(error as Error).message}`);
    return 1;
  }
}

function parseArgs(argv: string[]): CliArgs {
  const [command, targetRoot, ...rest] = argv;
  if (command !== "install" || !targetRoot) {
    throw new Error("参数错误：需要 `install <target>`");
  }

  let sourceRoot = process.cwd();
  let dryRun = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--dry-run") {
      dryRun = true;
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
    targetRoot: path.resolve(targetRoot),
    sourceRoot: path.resolve(sourceRoot),
    dryRun,
  };
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
  console.log(`  暂不支持 merge：${summary["unsupported-merge"]}`);
  console.log(`  跳过：${summary.skip}`);

  const blocked = plan.items.filter(
    (item) => item.action === "conflict" || item.action === "unsupported-merge",
  );
  for (const item of blocked) {
    console.log(`  阻塞 ${item.relativePath}: ${item.reason}`);
  }

  if (!dryRun && written.length > 0) {
    console.log(`  已写入：${written.length}`);
  }
}

function printUsage(): void {
  console.error(
    "Usage: ousia install <target> [--source <repoRoot>] [--dry-run]",
  );
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
