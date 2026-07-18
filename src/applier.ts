import { dirname, join, relative, SEPARATOR } from "@std/path";
import * as digest from "./digest.ts";
import type { InstallPlan, PlanItem } from "./planner.ts";
import type { SourceSnapshot } from "./source.ts";

export interface ApplyDiagnostic {
  phase: "apply";
  code: string;
  severity: "error";
  relativePath: string;
  message: string;
  remediation: string;
  evidence: Record<string, string>;
}
export class ApplyError extends Error {
  constructor(
    readonly diagnostic: ApplyDiagnostic,
    cause?: unknown,
  ) {
    super(diagnostic.message, { cause });
    this.name = "ApplyError";
  }
}
export interface ApplyResult {
  written: string[];
  deleted: string[];
}
export interface ApplyOptions {
  beforeMutation?: (context: {
    index: number;
    item: PlanItem;
    staging: string;
  }) => void | Promise<void>;
}
interface Identity {
  dev: number | null;
  ino: number | null;
  birthtime: number | null;
}
interface JournalLeaf {
  path: string;
  identity: Identity;
}
interface AppliedItem {
  item: PlanItem;
  targetIdentity: Identity | null;
  backup: JournalLeaf | null;
}
const stagingName = ".ousia-install-staging";

export async function applyInstallPlan(
  source: SourceSnapshot,
  plan: InstallPlan,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  if (plan.blocked) {
    throw fail(
      "apply-plan-blocked",
      "",
      "install plan 包含冲突，不能执行。",
      "解决所有 plan conflict 后重新生成plan。",
      {
        conflicts: plan.items.filter((item) => item.action === "conflict")
          .length.toString(),
      },
    );
  }
  const staging = join(plan.targetRoot, stagingName);
  await assertSafeAncestors(plan.targetRoot, staging);
  const mutableItems = plan.items.filter((entry) =>
    ["create", "replace", "delete"].includes(entry.action)
  );
  const sourceById = new Map(source.assets.map((asset) => [asset.id, asset]));
  for (const item of mutableItems) {
    const target = join(plan.targetRoot, item.target);
    await assertSafeAncestors(plan.targetRoot, target);
    await verifyPrecondition(target, item);
    if (item.action !== "delete") {
      const asset = sourceById.get(item.assetId);
      if (!asset || asset.sha256 !== item.sourceSha256) {
        throw fail(
          "apply-source-plan-mismatch",
          item.target,
          "source snapshot 与 install plan不一致。",
          "重新读取source并生成plan。",
          { assetId: item.assetId },
        );
      }
    }
  }
  try {
    await Deno.mkdir(staging);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw fail(
        "apply-staging-conflict",
        "",
        "staging namespace 已被占用。",
        "保留现有内容，人工检查后重试。",
        { staging },
      );
    }
    throw error;
  }
  const stagingIdentity = identity(await Deno.lstat(staging));
  const leaves: JournalLeaf[] = [];
  const createdDirs: { path: string; identity: Identity }[] = [];
  const applied: AppliedItem[] = [];
  const written: string[] = [];
  const deleted: string[] = [];
  let primary: unknown;
  try {
    for (let index = 0; index < mutableItems.length; index++) {
      const item = mutableItems[index];
      await options.beforeMutation?.({ index, item, staging });
      const target = join(plan.targetRoot, item.target);
      await assertSafeAncestors(plan.targetRoot, target);
      const backup = join(staging, "backup", item.target);
      if (item.action === "delete") {
        await assertStagingIdentity(staging, stagingIdentity);
        const expectedIdentity = await verifyPrecondition(target, item);
        await mkdirTracked(dirname(backup), staging, createdDirs);
        await assertStagingIdentity(staging, stagingIdentity);
        if (!expectedIdentity) {
          throw new Error("delete precondition identity missing");
        }
        await Deno.rename(target, backup);
        const backupLeaf = { path: backup, identity: expectedIdentity };
        leaves.push(backupLeaf);
        applied.push({ item, targetIdentity: null, backup: backupLeaf });
        const backupIdentity = identity(await Deno.lstat(backup));
        if (
          !sameIdentity(backupIdentity, expectedIdentity) ||
          !(await digestMatchesPrecondition(backup, item))
        ) {
          throw fail(
            "apply-target-changed",
            item.target,
            "目标在 precondition 检查后变化。",
            "保留 staging 现场并人工检查。",
            { target, backup },
          );
        }
        deleted.push(item.target);
        continue;
      }
      const asset = sourceById.get(item.assetId);
      if (!asset) {
        throw fail(
          "apply-missing-source",
          item.target,
          "缺少 source content。",
          "确保 plan 与 snapshot来自同一次读取。",
          {},
        );
      }
      const staged = join(staging, "new", item.target);
      await assertStagingIdentity(staging, stagingIdentity);
      await mkdirTracked(dirname(staged), staging, createdDirs);
      await assertStagingIdentity(staging, stagingIdentity);
      await Deno.writeFile(staged, asset.content, { createNew: true });
      const stagedLeaf = {
        path: staged,
        identity: identity(await Deno.lstat(staged)),
      };
      leaves.push(stagedLeaf);
      await mkdirTargetParents(dirname(target), plan.targetRoot, createdDirs);
      await assertSafeAncestors(plan.targetRoot, target);
      const expectedIdentity = await verifyPrecondition(target, item);
      if (item.action === "create") {
        const appliedItem: AppliedItem = {
          item,
          targetIdentity: null,
          backup: null,
        };
        applied.push(appliedItem);
        await commitCreate(staged, target, item);
        appliedItem.targetIdentity = stagedLeaf.identity;
        await Deno.remove(staged);
      } else {
        await assertStagingIdentity(staging, stagingIdentity);
        await mkdirTracked(dirname(backup), staging, createdDirs);
        await assertStagingIdentity(staging, stagingIdentity);
        if (!expectedIdentity) {
          throw new Error("replace precondition identity missing");
        }
        await Deno.rename(target, backup);
        const backupLeaf = { path: backup, identity: expectedIdentity };
        leaves.push(backupLeaf);
        const appliedItem: AppliedItem = {
          item,
          targetIdentity: null,
          backup: backupLeaf,
        };
        applied.push(appliedItem);
        const backupIdentity = identity(await Deno.lstat(backup));
        if (
          !sameIdentity(backupIdentity, expectedIdentity) ||
          !(await digestMatchesPrecondition(backup, item))
        ) {
          throw fail(
            "apply-target-changed",
            item.target,
            "目标在 precondition 检查后变化。",
            "保留 staging 现场并人工检查。",
            { target, backup },
          );
        }
        await commitCreate(staged, target, item);
        appliedItem.targetIdentity = stagedLeaf.identity;
        await Deno.remove(staged);
      }
      written.push(item.target);
    }
  } catch (error) {
    primary = error;
    try {
      await rollback(plan.targetRoot, applied, createdDirs);
    } catch (rollbackError) {
      throw fail(
        "apply-recovery-required",
        "",
        "回滚失败，staging现场已保留。",
        "使用 Git 和 staging journal检查并手动恢复。",
        { staging },
        rollbackError,
      );
    }
  }
  try {
    await cleanup(staging, stagingIdentity, leaves, createdDirs);
  } catch (cleanupError) {
    throw fail(
      "apply-recovery-required",
      "",
      "staging 或目录 identity变化/存在未知内容，现场已保留。",
      "人工检查 staging 和目标空目录。",
      { staging },
      cleanupError,
    );
  }
  if (primary) {
    if (primary instanceof ApplyError) throw primary;
    throw fail(
      "apply-commit-failed",
      "",
      "安装失败，已回滚。",
      "检查路径和权限后重试。",
      { staging },
      primary,
    );
  }
  return { written, deleted };
}

async function commitCreate(
  staged: string,
  target: string,
  item: PlanItem,
): Promise<void> {
  try {
    await Deno.link(staged, target);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw fail(
        "apply-target-changed",
        item.target,
        "目标在 plan 后出现。",
        "重新运行安装。",
        { target },
      );
    }
    throw error;
  }
}
async function verifyPrecondition(
  target: string,
  item: PlanItem,
): Promise<Identity | null> {
  try {
    const stat = await Deno.lstat(target);
    if (stat.isSymlink || !stat.isFile) {
      throw fail(
        "apply-target-blocked",
        item.target,
        "目标不是普通文件。",
        "移除 symlink/目录/特殊文件。",
        { target },
      );
    }
    if (item.precondition?.kind === "missing") {
      throw fail(
        "apply-target-changed",
        item.target,
        "目标在 plan 后出现。",
        "重新运行安装。",
        { target },
      );
    }
    if (
      item.precondition?.kind === "digest" &&
      (await digest.sha256(await Deno.readFile(target))) !==
        item.precondition.sha256
    ) {
      throw fail(
        "apply-target-changed",
        item.target,
        "目标在 plan 后变化。",
        "重新运行安装。",
        { target },
      );
    }
    return identity(stat);
  } catch (error) {
    if (
      (error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.NotADirectory) &&
      item.precondition?.kind === "missing"
    ) {
      return null;
    }
    throw error;
  }
}
async function digestMatchesPrecondition(
  path: string,
  item: PlanItem,
): Promise<boolean> {
  return (
    item.precondition?.kind !== "digest" ||
    (await digest.sha256(await Deno.readFile(path))) ===
      item.precondition.sha256
  );
}
async function assertSafeAncestors(root: string, leaf: string): Promise<void> {
  const rootInfo = await Deno.lstat(root);
  if (rootInfo.isSymlink || !rootInfo.isDirectory) {
    throw fail(
      "apply-root-blocked",
      "",
      "target root 必须是普通目录。",
      "使用非 symlink目录。",
      { root },
    );
  }
  const relativeParent = relative(root, dirname(leaf));
  if (relativeParent === ".." || relativeParent.startsWith(`..${SEPARATOR}`)) {
    throw fail(
      "apply-path-escape",
      "",
      "目标路径逃逸 target root。",
      "只使用 canonical relative target。",
      { root, leaf },
    );
  }
  const parts = relativeParent.split(SEPARATOR).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await Deno.lstat(current);
      if (stat.isSymlink || !stat.isDirectory) {
        throw fail(
          "apply-parent-blocked",
          "",
          "父路径包含 symlink 或非目录。",
          "移除阻塞路径。",
          { parent: current },
        );
      }
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.NotADirectory
      ) {
        return;
      }
      throw error;
    }
  }
}
async function mkdirTargetParents(
  path: string,
  root: string,
  created: { path: string; identity: Identity }[],
): Promise<void> {
  const missing: string[] = [];
  let current = path;
  while (current.startsWith(root) && current !== root) {
    try {
      const stat = await Deno.lstat(current);
      if (stat.isSymlink || !stat.isDirectory) {
        throw fail(
          "apply-parent-blocked",
          "",
          "父路径被阻塞。",
          "移除阻塞路径。",
          { parent: current },
        );
      }
      break;
    } catch (error) {
      if (
        !(
          error instanceof Deno.errors.NotFound ||
          error instanceof Deno.errors.NotADirectory
        )
      ) {
        throw error;
      }
      missing.push(current);
      current = dirname(current);
    }
  }
  for (const directory of missing.reverse()) {
    await Deno.mkdir(directory);
    created.push({
      path: directory,
      identity: identity(await Deno.lstat(directory)),
    });
  }
}
async function mkdirTracked(
  path: string,
  stop: string,
  created: { path: string; identity: Identity }[],
): Promise<void> {
  const missing: string[] = [];
  let current = path;
  while (current.startsWith(stop) && current !== stop) {
    try {
      await Deno.lstat(current);
      break;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      missing.push(current);
      current = dirname(current);
    }
  }
  for (const directory of missing.reverse()) {
    await Deno.mkdir(directory);
    created.push({
      path: directory,
      identity: identity(await Deno.lstat(directory)),
    });
  }
}
async function assertStagingIdentity(
  staging: string,
  expected: Identity,
): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(staging);
  } catch (error) {
    throw fail(
      "apply-recovery-required",
      "",
      "staging namespace 在mutation前消失或不可读。",
      "保留现场并人工检查 staging 后重试。",
      { staging },
      error,
    );
  }
  if (
    info.isSymlink || !info.isDirectory ||
    !sameIdentity(identity(info), expected)
  ) {
    throw fail(
      "apply-recovery-required",
      "",
      "staging namespace identity或类型发生变化。",
      "保留现场并人工检查 staging 后重试。",
      { staging },
    );
  }
}
async function rollback(
  root: string,
  applied: AppliedItem[],
  created: { path: string; identity: Identity }[],
): Promise<void> {
  for (const entry of [...applied].reverse()) {
    const target = join(root, entry.item.target);
    if (entry.targetIdentity) {
      try {
        const current = identity(await Deno.lstat(target));
        if (!sameIdentity(current, entry.targetIdentity)) {
          throw new Error(`target identity changed: ${target}`);
        }
        await Deno.remove(target);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
    if (entry.backup) {
      try {
        await Deno.lstat(target);
        throw new Error(`rollback target occupied: ${target}`);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      const currentBackup = identity(await Deno.lstat(entry.backup.path));
      if (!sameIdentity(currentBackup, entry.backup.identity)) {
        throw new Error(`backup identity changed: ${entry.backup.path}`);
      }
      if (!(await digestMatchesPrecondition(entry.backup.path, entry.item))) {
        throw new Error(`backup digest changed: ${entry.backup.path}`);
      }
      await Deno.rename(entry.backup.path, target);
    }
  }
  await removeCreatedDirs(
    created.filter(
      (item) => item.path.startsWith(root) && !item.path.includes(stagingName),
    ),
  );
}
async function cleanup(
  staging: string,
  rootIdentity: Identity,
  leaves: JournalLeaf[],
  created: { path: string; identity: Identity }[],
): Promise<void> {
  if (!sameIdentity(identity(await Deno.lstat(staging)), rootIdentity)) {
    throw new Error("staging root identity changed");
  }
  for (const leaf of leaves) {
    try {
      const current = identity(await Deno.lstat(leaf.path));
      if (!sameIdentity(current, leaf.identity)) {
        throw new Error(`leaf identity changed: ${leaf.path}`);
      }
      await Deno.remove(leaf.path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  await removeCreatedDirs(
    created.filter((item) => item.path.startsWith(staging)),
  );
  await Deno.remove(staging);
}
async function removeCreatedDirs(
  created: { path: string; identity: Identity }[],
): Promise<void> {
  for (
    const entry of [...created].sort(
      (a, b) => b.path.length - a.path.length,
    )
  ) {
    try {
      const current = identity(await Deno.lstat(entry.path));
      if (!sameIdentity(current, entry.identity)) {
        throw new Error(`directory identity changed: ${entry.path}`);
      }
      await Deno.remove(entry.path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}
function identity(info: Deno.FileInfo): Identity {
  return {
    dev: info.dev ?? null,
    ino: info.ino ?? null,
    birthtime: info.birthtime?.getTime() ?? null,
  };
}
function sameIdentity(left: Identity, right: Identity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtime === right.birthtime
  );
}
function fail(
  code: string,
  relativePath: string,
  message: string,
  remediation: string,
  evidence: Record<string, string>,
  cause?: unknown,
): ApplyError {
  return new ApplyError(
    {
      phase: "apply",
      code,
      severity: "error",
      relativePath,
      message,
      remediation,
      evidence,
    },
    cause,
  );
}
