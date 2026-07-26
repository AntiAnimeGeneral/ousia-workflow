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
interface StagingGuard {
  path: string;
  identity: Identity;
  sentinelPath: string;
  sentinelIdentity: Identity;
  sentinelContent: string;
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
  const leaves: JournalLeaf[] = [];
  const stagingGuard = await createStagingGuard(staging);
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
        await assertStagingIdentity(stagingGuard);
        const expectedIdentity = await verifyPrecondition(target, item);
        await mkdirTracked(dirname(backup), staging, createdDirs);
        await assertStagingIdentity(stagingGuard);
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
      await assertStagingIdentity(stagingGuard);
      await mkdirTracked(dirname(staged), staging, createdDirs);
      await assertStagingIdentity(stagingGuard);
      if ((item.shape ?? "file") === "directory") {
        await stageDirectoryAsset(staged, asset);
      } else {
        if (!asset.content) {
          throw fail(
            "apply-source-plan-mismatch",
            item.target,
            "file source snapshot 缺少 content。",
            "重新读取source并生成plan。",
            { assetId: item.assetId },
          );
        }
        await Deno.writeFile(staged, asset.content, { createNew: true });
      }
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
        if ((item.shape ?? "file") === "file") await Deno.remove(staged);
      } else {
        await assertStagingIdentity(stagingGuard);
        await mkdirTracked(dirname(backup), staging, createdDirs);
        await assertStagingIdentity(stagingGuard);
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
        if ((item.shape ?? "file") === "directory") {
          await preserveExcludedChildren(backup, staged, item.exclude ?? []);
        }
        await commitCreate(staged, target, item);
        appliedItem.targetIdentity = stagedLeaf.identity;
        if ((item.shape ?? "file") === "file") await Deno.remove(staged);
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
    await cleanup(stagingGuard, leaves, createdDirs);
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
    if ((item.shape ?? "file") === "directory") {
      await Deno.rename(staged, target);
    } else {
      await Deno.link(staged, target);
    }
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
    const shape = item.shape ?? "file";
    if (
      stat.isSymlink ||
      (shape === "file" ? !stat.isFile : !stat.isDirectory)
    ) {
      throw fail(
        "apply-target-blocked",
        item.target,
        shape === "file" ? "目标不是普通文件。" : "目标不是普通目录。",
        "移除 symlink/错误类型/特殊文件。",
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
      (await targetDigest(target, shape, item.exclude ?? [])) !==
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
    (await targetDigest(path, item.shape ?? "file", item.exclude ?? [])) ===
      item.precondition.sha256
  );
}

async function targetDigest(
  path: string,
  shape: "file" | "directory",
  exclude: string[],
): Promise<string> {
  if (shape === "file") return await digest.sha256(await Deno.readFile(path));
  return await digest.treeSha256(
    await readDirectoryDigestEntries(path, path, exclude),
  );
}

async function readDirectoryDigestEntries(
  root: string,
  current: string,
  exclude: string[],
): Promise<digest.TreeEntry[]> {
  const entries: digest.TreeEntry[] = [];
  for await (const entry of Deno.readDir(current)) {
    const absolute = join(current, entry.name);
    const relativeEntry = relative(root, absolute).split(SEPARATOR).join("/");
    if (isExcluded(relativeEntry, exclude)) continue;
    const stat = await Deno.lstat(absolute);
    if (stat.isSymlink || (!stat.isFile && !stat.isDirectory)) {
      throw fail(
        "apply-target-blocked",
        relative(root, absolute),
        "目录 asset target 包含 symlink 或特殊文件。",
        "移除阻塞路径后重新运行安装。",
        { path: absolute },
      );
    }
    if (stat.isDirectory) {
      entries.push(
        ...await readDirectoryDigestEntries(root, absolute, exclude),
      );
    } else {
      entries.push({
        path: relativeEntry,
        sha256: await digest.sha256(await Deno.readFile(absolute)),
      });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function isExcluded(path: string, exclude: string[]): boolean {
  return exclude.some((entry) =>
    path === entry || path.startsWith(`${entry}/`)
  );
}

async function stageDirectoryAsset(
  staged: string,
  asset: SourceSnapshot["assets"][number],
): Promise<void> {
  if (!asset.tree) {
    throw fail(
      "apply-source-plan-mismatch",
      asset.target,
      "directory source snapshot 缺少 tree。",
      "重新读取source并生成plan。",
      { assetId: asset.id },
    );
  }
  await Deno.mkdir(staged);
  for (const entry of asset.tree) {
    const target = join(staged, entry.path);
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.writeFile(target, entry.content, { createNew: true });
  }
}

async function preserveExcludedChildren(
  target: string,
  staged: string,
  exclude: string[],
): Promise<void> {
  for (const entry of exclude) {
    const source = join(target, entry);
    try {
      await Deno.lstat(source);
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.NotADirectory
      ) continue;
      throw error;
    }
    const destination = join(staged, entry);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.rename(source, destination);
  }
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
async function createStagingGuard(staging: string): Promise<StagingGuard> {
  const sentinelPath = join(staging, ".guard");
  const sentinelContent = crypto.randomUUID();
  await Deno.writeTextFile(sentinelPath, sentinelContent, { createNew: true });
  return {
    path: staging,
    identity: identity(await Deno.lstat(staging)),
    sentinelPath,
    sentinelIdentity: identity(await Deno.lstat(sentinelPath)),
    sentinelContent,
  };
}

async function assertStagingIdentity(guard: StagingGuard): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(guard.path);
  } catch (error) {
    throw fail(
      "apply-recovery-required",
      "",
      "staging namespace 在mutation前消失或不可读。",
      "保留现场并人工检查 staging 后重试。",
      { staging: guard.path },
      error,
    );
  }
  if (
    info.isSymlink || !info.isDirectory ||
    !sameIdentity(identity(info), guard.identity)
  ) {
    throw fail(
      "apply-recovery-required",
      "",
      "staging namespace identity或类型发生变化。",
      "保留现场并人工检查 staging 后重试。",
      { staging: guard.path },
    );
  }
  try {
    const sentinelInfo = await Deno.lstat(guard.sentinelPath);
    if (
      sentinelInfo.isSymlink || !sentinelInfo.isFile ||
      !sameIdentity(identity(sentinelInfo), guard.sentinelIdentity)
    ) {
      throw stagingGuardChanged(guard);
    }
    if (await Deno.readTextFile(guard.sentinelPath) !== guard.sentinelContent) {
      throw stagingGuardChanged(guard);
    }
  } catch (error) {
    if (error instanceof ApplyError) throw error;
    throw fail(
      "apply-recovery-required",
      "",
      "staging namespace guard发生变化。",
      "保留现场并人工检查 staging 后重试。",
      { staging: guard.path, guard: guard.sentinelPath },
      error,
    );
  }
}

function stagingGuardChanged(guard: StagingGuard): ApplyError {
  return fail(
    "apply-recovery-required",
    "",
    "staging namespace guard发生变化。",
    "保留现场并人工检查 staging 后重试。",
    { staging: guard.path, guard: guard.sentinelPath },
  );
}
async function rollback(
  root: string,
  applied: AppliedItem[],
  created: { path: string; identity: Identity }[],
): Promise<void> {
  for (const entry of [...applied].reverse()) {
    const target = join(root, entry.item.target);
    const preserved = entry.targetIdentity && entry.backup &&
        (entry.item.shape ?? "file") === "directory"
      ? await moveExcludedChildrenToTemp(target, entry.item.exclude ?? [])
      : [];
    if (entry.targetIdentity) {
      try {
        const current = identity(await Deno.lstat(target));
        if (!sameIdentity(current, entry.targetIdentity)) {
          throw new Error(`target identity changed: ${target}`);
        }
        await Deno.remove(target, {
          recursive: (entry.item.shape ?? "file") === "directory",
        });
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
    await restorePreservedExcludedChildren(target, preserved);
  }
  await removeCreatedDirs(
    created.filter(
      (item) => item.path.startsWith(root) && !item.path.includes(stagingName),
    ),
  );
}

async function moveExcludedChildrenToTemp(
  target: string,
  exclude: string[],
): Promise<{ temporary: string; relativePath: string }[]> {
  const preserved: { temporary: string; relativePath: string }[] = [];
  for (const entry of exclude) {
    const source = join(target, entry);
    try {
      await Deno.lstat(source);
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.NotADirectory
      ) continue;
      throw error;
    }
    const temporary = await Deno.makeTempDir({ dir: dirname(target) });
    const destination = join(temporary, entry);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.rename(source, destination);
    preserved.push({ temporary, relativePath: entry });
  }
  return preserved;
}

async function restorePreservedExcludedChildren(
  target: string,
  preserved: { temporary: string; relativePath: string }[],
): Promise<void> {
  for (const entry of preserved) {
    const source = join(entry.temporary, entry.relativePath);
    const destination = join(target, entry.relativePath);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.rename(source, destination);
    await Deno.remove(entry.temporary, { recursive: true });
  }
}
async function cleanup(
  guard: StagingGuard,
  leaves: JournalLeaf[],
  created: { path: string; identity: Identity }[],
): Promise<void> {
  await assertStagingIdentity(guard);
  for (const leaf of leaves) {
    try {
      const current = identity(await Deno.lstat(leaf.path));
      if (!sameIdentity(current, leaf.identity)) {
        throw new Error(`leaf identity changed: ${leaf.path}`);
      }
      await Deno.remove(leaf.path, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  await removeCreatedDirs(
    created.filter((item) => item.path.startsWith(guard.path)),
  );
  await assertStagingIdentity(guard);
  await Deno.remove(guard.sentinelPath);
  await Deno.remove(guard.path);
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
