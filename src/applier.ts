import {
  dirname,
  fromFileUrl,
  join,
  parse,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import type { InstallPlan, PlanItem } from "./planner.ts";
import type { SourceSnapshot } from "./source.ts";

export type ApplyDiagnosticCode =
  | "apply-missing-source"
  | "apply-target-changed"
  | "apply-target-directory"
  | "apply-parent-blocked"
  | "apply-commit-failed"
  | "apply-rollback-failed"
  | "apply-cleanup-failed";

export interface ApplyDiagnostic {
  phase: "apply";
  code: ApplyDiagnosticCode;
  severity: "error";
  relativePath: string;
  message: string;
  remediation: string;
  evidence: Record<string, string>;
}

export class ApplyError extends Error {
  readonly diagnostic: ApplyDiagnostic;

  constructor(diagnostic: ApplyDiagnostic, cause?: unknown) {
    super(diagnostic.message, { cause });
    this.name = "ApplyError";
    this.diagnostic = diagnostic;
  }
}

export interface ApplyResult {
  written: string[];
}

interface ApplyFileSystem {
  copyFile(
    oldPath: string,
    newPath: string,
    options?: { createNew?: boolean },
  ): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string, options: { recursive?: true }): Promise<void>;
  stat(path: string): Promise<{ isDirectory: boolean }>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
}

interface PreparedWrite {
  item: PlanItem;
  content: Uint8Array;
  targetPath: string;
  stagingPath: string;
  backupPath: string;
  existed: boolean;
}

interface CommittedWrite {
  write: PreparedWrite;
  backedUp: boolean;
}

const stagingDirName = ".ousia-install-staging";

const denoFileSystem: ApplyFileSystem = {
  async copyFile(oldPath, newPath, options) {
    if (options?.createNew) {
      try {
        await Deno.lstat(newPath);
        throw new Deno.errors.AlreadyExists("target already exists");
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    await Deno.copyFile(oldPath, newPath);
  },
  mkdir: Deno.mkdir,
  rename: Deno.rename,
  async remove(path, options) {
    try {
      await Deno.remove(path, options);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  },
  stat: Deno.stat,
  writeFile: Deno.writeFile,
};

export async function applyInstallPlan(
  source: SourceSnapshot,
  plan: InstallPlan,
  fileSystem: ApplyFileSystem = denoFileSystem,
): Promise<ApplyResult> {
  const writes = await prepareWrites(source, plan, fileSystem);
  const committed: CommittedWrite[] = [];
  let pendingError: unknown;
  let activeRelativePath = writes[0]?.item.relativePath ?? "";

  try {
    for (const write of writes) {
      activeRelativePath = write.item.relativePath;
      await fileSystem.mkdir(dirname(write.stagingPath), { recursive: true });
      await fileSystem.writeFile(write.stagingPath, write.content);
    }

    for (const write of writes) {
      activeRelativePath = write.item.relativePath;
      await fileSystem.mkdir(dirname(write.targetPath), { recursive: true });
      const backedUp = write.existed;
      if (backedUp) {
        await fileSystem.mkdir(dirname(write.backupPath), { recursive: true });
        await fileSystem.rename(write.targetPath, write.backupPath);
        committed.push({ write, backedUp });
        await fileSystem.rename(write.stagingPath, write.targetPath);
      } else {
        await fileSystem.copyFile(write.stagingPath, write.targetPath, {
          createNew: true,
        });
        committed.push({ write, backedUp });
      }
    }
  } catch (error) {
    pendingError = error;
    try {
      await rollback(committed, error, fileSystem);
    } catch (rollbackError) {
      pendingError = rollbackError;
      throw rollbackError;
    }
    const applyError = new ApplyError(
      diagnostic(
        commitFailureCode(error),
        activeRelativePath,
        "安装写入失败，已尝试回滚已提交的文件。",
        "检查目标目录权限和被占用的路径，然后重新运行安装。",
        { targetRoot: plan.targetRoot },
      ),
      error,
    );
    pendingError = applyError;
    throw applyError;
  } finally {
    try {
      await cleanupStaging(plan.targetRoot, fileSystem);
    } catch (cleanupError) {
      if (pendingError !== undefined) {
        // Preserve the primary apply diagnostic; the target state failure is more important.
      } else {
        pendingError = new ApplyError(
          diagnostic(
            "apply-cleanup-failed",
            "",
            "安装已写入，但清理 staging 目录失败。",
            "检查目标目录中的 .ousia-install-staging 并手动清理。",
            { targetRoot: plan.targetRoot },
          ),
          cleanupError,
        );
      }
    }
  }

  if (pendingError instanceof ApplyError) {
    throw pendingError;
  }

  return { written: writes.map((write) => write.item.relativePath) };
}

async function prepareWrites(
  source: SourceSnapshot,
  plan: InstallPlan,
  fileSystem: ApplyFileSystem,
): Promise<PreparedWrite[]> {
  const sourceByPath = new Map(
    source.files.map((file) => [file.relativePath, file.content]),
  );
  const writableItems = plan.items.filter(isWritableItem);
  const writes: PreparedWrite[] = [];

  for (const item of writableItems) {
    const content = sourceByPath.get(item.relativePath);
    if (content === undefined) {
      throw new ApplyError(
        diagnostic(
          "apply-missing-source",
          item.relativePath,
          `缺少 ${item.relativePath} 的 source content。`,
          "检查 source snapshot 和 plan 是否来自同一次安装读取。",
          {},
        ),
      );
    }

    const targetPath = join(plan.targetRoot, item.relativePath);
    await preflightTarget(item.relativePath, targetPath, fileSystem);
    writes.push({
      item,
      content,
      targetPath,
      stagingPath: stagingPathFor(plan.targetRoot, item.relativePath),
      backupPath: backupPathFor(plan.targetRoot, item.relativePath),
      existed: item.action === "replace",
    });
  }

  return writes;
}

async function preflightTarget(
  relativePath: string,
  targetPath: string,
  fileSystem: ApplyFileSystem,
): Promise<void> {
  const targetStat = await statOptional(targetPath, fileSystem);
  if (targetStat === "blocked-parent") {
    throw parentBlocked(relativePath, dirname(targetPath));
  }

  if (targetStat?.isDirectory) {
    throw new ApplyError(
      diagnostic(
        "apply-target-directory",
        relativePath,
        "目标路径是目录，不能用 baseline 文件覆盖。",
        "删除或移动该目录后重新运行安装。",
        { targetPath },
      ),
    );
  }

  const blockedParent = await findBlockedParent(targetPath, fileSystem);
  if (blockedParent !== null) {
    throw parentBlocked(relativePath, blockedParent);
  }
}

function parentBlocked(relativePath: string, parent: string): ApplyError {
  return new ApplyError(
    diagnostic(
      "apply-parent-blocked",
      relativePath,
      "目标文件的父路径被普通文件阻塞。",
      "调整目标项目路径后重新运行安装。",
      { parent },
    ),
  );
}

async function findBlockedParent(
  targetPath: string,
  fileSystem: ApplyFileSystem,
): Promise<string | null> {
  const root = parse(targetPath).root;
  const parentParts = dirname(targetPath).slice(root.length).split(SEPARATOR);
  let current = root;

  for (const part of parentParts) {
    if (!part) continue;
    current = join(current, part);
    const currentStat = await statOptional(current, fileSystem);
    if (currentStat === "blocked-parent") return current;
    if (currentStat !== null && !currentStat.isDirectory) return current;
  }

  return null;
}

async function rollback(
  committed: CommittedWrite[],
  originalError: unknown,
  fileSystem: ApplyFileSystem,
): Promise<void> {
  for (const entry of committed.reverse()) {
    try {
      await removeIfExists(entry.write.targetPath, fileSystem);
      if (entry.backedUp) {
        await fileSystem.rename(entry.write.backupPath, entry.write.targetPath);
      }
    } catch (rollbackError) {
      throw new ApplyError(
        diagnostic(
          "apply-rollback-failed",
          entry.write.item.relativePath,
          "安装失败后的回滚也失败，目标目录可能保留部分状态。",
          "使用 Git diff 检查目标项目，并按需要回退或清理。",
          { targetPath: entry.write.targetPath },
        ),
        rollbackError ?? originalError,
      );
    }
  }
}

async function cleanupStaging(
  targetRoot: string,
  fileSystem: ApplyFileSystem,
): Promise<void> {
  await fileSystem.remove(join(targetRoot, stagingDirName), {
    recursive: true,
  });
}

function isWritableItem(item: PlanItem): boolean {
  return item.action === "create" || item.action === "replace";
}

function stagingPathFor(targetRoot: string, relativePath: string): string {
  return join(targetRoot, stagingDirName, "new", relativePath);
}

function backupPathFor(targetRoot: string, relativePath: string): string {
  return join(targetRoot, stagingDirName, "backup", relativePath);
}

async function statOptional(
  absolutePath: string,
  fileSystem: ApplyFileSystem,
): Promise<{ isDirectory: boolean } | "blocked-parent" | null> {
  try {
    return await fileSystem.stat(absolutePath);
  } catch (error) {
    if (isNotFound(error)) return null;
    if (isNotDirectory(error)) return "blocked-parent";
    throw error;
  }
}

async function removeIfExists(
  absolutePath: string,
  fileSystem: ApplyFileSystem,
): Promise<void> {
  await fileSystem.remove(absolutePath, { recursive: true });
}

function commitFailureCode(error: unknown): ApplyDiagnosticCode {
  if (isAlreadyExists(error)) return "apply-target-changed";
  return "apply-commit-failed";
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    error instanceof Error && error.name === "NotFound";
}

function isNotDirectory(error: unknown): boolean {
  return error instanceof Deno.errors.NotADirectory ||
    error instanceof Error && error.name === "NotADirectory";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    error instanceof Error && error.name === "AlreadyExists";
}

function diagnostic(
  code: ApplyDiagnosticCode,
  relativePath: string,
  message: string,
  remediation: string,
  evidence: Record<string, string>,
): ApplyDiagnostic {
  return {
    phase: "apply",
    code,
    severity: "error",
    relativePath,
    message,
    remediation,
    evidence,
  };
}

export function currentSourceRoot(metaUrl: string): string {
  return resolve(join(dirname(fromFileUrl(metaUrl)), ".."));
}

export function relativeToSourceRoot(root: string, path: string): string {
  return relative(root, path);
}
