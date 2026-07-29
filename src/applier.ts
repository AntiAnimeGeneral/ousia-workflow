import { dirname, join, relative, SEPARATOR } from "@std/path";
import * as digest from "./digest.ts";
import * as manifest from "./manifest.ts";
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
  beforeRetirementRecordCommit?: (context: {
    phase: "survivor-location";
    item: Extract<PlanItem, { action: "retire-directory" }>;
    relativePath: string;
    staging: string;
  }) => void | Promise<void>;
  beforeRetirementBackedUpRecordCommit?: (context: {
    item: Extract<PlanItem, { action: "retire-directory" }>;
    backup: string;
    journal: string;
    target: string;
    staging: string;
  }) => void | Promise<void>;
  beforeRetirementCompensation?: (context: {
    phase: "survivor-location";
    item: Extract<PlanItem, { action: "retire-directory" }>;
    relativePath: string;
    staging: string;
  }) => void | Promise<void>;
  beforeRetirementRestoreRecordCommit?: (context: {
    phase: "survivor-restore-location";
    item: Extract<PlanItem, { action: "retire-directory" }>;
    relativePath: string;
    staging: string;
  }) => void | Promise<void>;
  afterRetirementContainerCommit?: (context: {
    item: Extract<PlanItem, { action: "retire-directory" }>;
    journal: string;
    target: string;
    staging: string;
  }) => void | Promise<void>;
  beforeRetirementCleanup?: (context: {
    item: Extract<PlanItem, { action: "retire-directory" }>;
    backup: string;
    journal: string;
    target: string;
    staging: string;
  }) => void | Promise<void>;
  beforeManifestTargetCommit?: (context: {
    target: string;
    transaction: string;
  }) => void | Promise<void>;
  afterManifestTargetCommit?: (context: {
    target: string;
    transaction: string;
  }) => void | Promise<void>;
  beforeCleanupPendingRecordCommit?: (context: {
    staging: string;
    transaction: string;
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
interface RetirementSurvivor {
  relativePath: string;
  shape: "file" | "directory";
  identity: Identity;
  sha256: string;
  location: "Backup" | "SurvivorStaging" | "CommittedTarget";
}
interface RetirementJournal {
  schema: "ousia.directory-retirement.v1";
  transaction: string;
  assetId: string;
  acceptedPredecessor: Extract<
    PlanItem,
    { action: "retire-directory" }
  >["acceptedPredecessor"];
  target: string;
  targetIdentity: Identity;
  backup: string;
  backupIdentity: Identity;
  survivor: string;
  survivorContainerIdentity: Identity;
  managedSha256: string;
  managedEntries: digest.TreeEntry[];
  exclude: string[];
  survivors: RetirementSurvivor[];
  state:
    | "Preflighted"
    | "BackedUp"
    | "SurvivorsStaged"
    | "SurvivorCommitted"
    | "TargetAbsent";
}
interface RetirementRuntime {
  item: Extract<PlanItem, { action: "retire-directory" }>;
  journalPath: string;
  journal: RetirementJournal;
}
interface TransactionCommitRecord {
  schema: "ousia.install-commit.v1";
  transaction: string;
  manifestTarget: string;
  oldManifestIdentity: Identity;
  oldManifestSha256: string;
  newManifestIdentity: Identity;
  newManifestSha256: string;
  retirementJournals: { path: string; sha256: string }[];
  state:
    | "ManifestCommitPending"
    | "ManifestCommitted"
    | "CommittedCleanupPending";
}
type ManifestDiskOutcome = "Old" | "New" | "Unknown";
const stagingName = ".ousia-install-staging";
const supportedRetirementManifestSha256 =
  "e09e3ab5ff5aa1321d69aafa6587773142c2043c1aa30c9e54622a14879016dd";

export async function applyInstallPlan(
  source: SourceSnapshot,
  plan: InstallPlan,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const authoritativeSource = structuredClone(source);
  const authoritativePlan = structuredClone(plan);
  if (authoritativePlan.blocked) {
    throw fail(
      "apply-plan-blocked",
      "",
      "install plan 包含冲突，不能执行。",
      "解决所有 plan conflict 后重新生成plan。",
      {
        conflicts: authoritativePlan.items.filter((item) =>
          item.action === "conflict"
        )
          .length.toString(),
      },
    );
  }
  const staging = join(authoritativePlan.targetRoot, stagingName);
  await assertSafeAncestors(authoritativePlan.targetRoot, staging);
  try {
    await Deno.lstat(staging);
    throw await classifyExistingStaging(staging);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const mutableItems = authoritativePlan.items.filter((entry) =>
    ["create", "replace", "delete", "retire-directory"].includes(
      entry.action,
    )
  );
  const sourceById = new Map(
    authoritativeSource.assets.map((asset) => [asset.id, asset]),
  );
  for (const item of mutableItems) {
    const target = join(authoritativePlan.targetRoot, item.target);
    await assertSafeAncestors(authoritativePlan.targetRoot, target);
    await verifyPrecondition(target, item);
    if (item.action !== "delete" && item.action !== "retire-directory") {
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
      throw await classifyExistingStaging(staging);
    }
    throw error;
  }
  const leaves: JournalLeaf[] = [];
  const stagingGuard = await createStagingGuard(staging);
  const createdDirs: { path: string; identity: Identity }[] = [];
  const applied: AppliedItem[] = [];
  const written: string[] = [];
  const deleted: string[] = [];
  const retirementJournals: string[] = [];
  const retirements: RetirementRuntime[] = [];
  let transactionRecordPath: string | null = null;
  let transactionRecord: TransactionCommitRecord | null = null;
  let primary: unknown;
  try {
    for (let index = 0; index < mutableItems.length; index++) {
      const item = mutableItems[index];
      await options.beforeMutation?.({
        index,
        item: structuredClone(item),
        staging,
      });
      const target = join(authoritativePlan.targetRoot, item.target);
      await assertSafeAncestors(authoritativePlan.targetRoot, target);
      const backup = join(staging, "backup", item.target);
      if (item.action === "delete" || item.action === "retire-directory") {
        await assertStagingIdentity(stagingGuard);
        const expectedIdentity = await verifyPrecondition(target, item);
        await mkdirTracked(dirname(backup), staging, createdDirs);
        await assertStagingIdentity(stagingGuard);
        if (!expectedIdentity) {
          throw new Error("delete precondition identity missing");
        }
        let retirementPreflight: {
          journalPath: string;
          journal: RetirementJournal;
        } | null = null;
        if (item.action === "retire-directory") {
          if (item.precondition?.kind !== "digest") {
            throw new Error("directory retirement digest missing");
          }
          const survivor = join(staging, "survivor", item.target);
          const journalPath = join(
            staging,
            "journal",
            `retirement-${retirementJournals.length}.json`,
          );
          await mkdirTracked(dirname(survivor), staging, createdDirs);
          await Deno.mkdir(survivor);
          const survivorContainerIdentity = identity(
            await Deno.lstat(survivor),
          );
          const journal: RetirementJournal = {
            schema: "ousia.directory-retirement.v1",
            transaction: stagingGuard.sentinelContent,
            assetId: item.assetId,
            acceptedPredecessor: item.acceptedPredecessor,
            target,
            targetIdentity: item.targetIdentity,
            backup,
            backupIdentity: expectedIdentity,
            survivor,
            survivorContainerIdentity,
            managedSha256: item.precondition.sha256,
            managedEntries: item.managedEntries.map((entry) => ({ ...entry })),
            exclude: item.exclude ?? [],
            survivors: item.survivors.map((entry) => ({
              ...entry,
              location: "Backup" as const,
            })),
            state: "Preflighted",
          };
          await writeSealedRecord(journalPath, journal, staging, createdDirs);
          await readRetirementJournal(
            journalPath,
            staging,
            stagingGuard.sentinelContent,
            item,
          );
          retirementPreflight = { journalPath, journal };
        }
        await Deno.rename(target, backup);
        const backupLeaf = { path: backup, identity: expectedIdentity };
        if (item.action === "delete") {
          leaves.push(backupLeaf);
          applied.push({ item, targetIdentity: null, backup: backupLeaf });
        }
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
        if (item.action === "retire-directory") {
          if (!retirementPreflight) {
            throw new Error("retirement preflight missing");
          }
          const { journalPath } = retirementPreflight;
          let journal: RetirementJournal = {
            ...retirementPreflight.journal,
            state: "BackedUp" as const,
          };
          try {
            await options.beforeRetirementBackedUpRecordCommit?.({
              item,
              backup,
              journal: journalPath,
              target,
              staging,
            });
            await writeSealedRecord(journalPath, journal, staging, createdDirs);
          } catch (error) {
            try {
              const currentBackup = identity(await Deno.lstat(backup));
              if (
                !sameIdentity(currentBackup, journal.backupIdentity) ||
                !(await digestMatchesPrecondition(backup, item))
              ) throw new Error(`retirement C1 backup changed: ${backup}`);
              await Deno.rename(backup, target);
              await assertRetirementJournal(
                journalPath,
                retirementPreflight.journal,
              );
              const survivorInfo = await Deno.lstat(
                retirementPreflight.journal.survivor,
              );
              if (
                !sameIdentity(
                  identity(survivorInfo),
                  retirementPreflight.journal.survivorContainerIdentity,
                )
              ) {
                throw new Error("retirement C1 survivor container changed");
              }
              await Deno.remove(retirementPreflight.journal.survivor);
              await Deno.remove(journalPath);
            } catch (compensationError) {
              throw fail(
                "apply-recovery-required",
                item.target,
                "target backup提交失败且无法证明C1相邻补偿完成，现场已保留。",
                "依据Preflighted retirement journal核验target与backup后人工恢复。",
                { target, backup, journal: journalPath },
                compensationError,
              );
            }
            throw error;
          }
          retirementJournals.push(journalPath);
          const retirementRuntime: RetirementRuntime = {
            item,
            journalPath,
            journal,
          };
          retirements.push(retirementRuntime);
          journal = await stageRetirementSurvivors(
            backup,
            journal.survivor,
            journalPath,
            journal,
            item,
            staging,
            options,
            createdDirs,
            (committed) => retirementRuntime.journal = committed,
          );
          retirementRuntime.journal = journal;
          const children = [];
          for await (const child of Deno.readDir(journal.survivor)) {
            children.push(child);
          }
          if (children.length > 0) {
            await mkdirTargetParents(
              dirname(target),
              authoritativePlan.targetRoot,
              createdDirs,
            );
            await Deno.rename(journal.survivor, target);
            journal = {
              ...journal,
              survivors: journal.survivors.map((entry) => ({
                ...entry,
                location: "CommittedTarget" as const,
              })),
              state: "SurvivorCommitted",
            };
            try {
              await options.afterRetirementContainerCommit?.({
                item,
                journal: journalPath,
                target,
                staging,
              });
              await writeSealedRecord(
                journalPath,
                journal,
                staging,
                createdDirs,
              );
            } catch (error) {
              try {
                await assertRetirementContainer(
                  target,
                  journal.survivorContainerIdentity,
                  journal.survivors,
                );
                await Deno.rename(target, journal.survivor);
                await assertRetirementJournal(
                  journalPath,
                  retirementRuntime.journal,
                );
              } catch (compensationError) {
                throw fail(
                  "apply-recovery-required",
                  item.target,
                  "survivor container提交失败且无法证明C3相邻补偿完成，现场已保留。",
                  "依据retirement journal核验target与survivor staging后人工恢复。",
                  { target, survivor: journal.survivor, journal: journalPath },
                  compensationError,
                );
              }
              throw error;
            }
          } else {
            await Deno.remove(journal.survivor);
            journal = { ...journal, state: "TargetAbsent" };
            await writeSealedRecord(
              journalPath,
              journal,
              staging,
              createdDirs,
            );
          }
          retirementRuntime.journal = journal;
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
      const stagedSha256 = (item.shape ?? "file") === "directory"
        ? await digest.treeSha256(
          await readDirectoryDigestEntries(staged, staged, []),
        )
        : await digest.sha256(await Deno.readFile(staged));
      if (stagedSha256 !== item.sourceSha256) {
        throw fail(
          "apply-source-plan-mismatch",
          item.target,
          "staged source bytes 与 install plan不一致。",
          "重新读取source并生成plan。",
          { assetId: item.assetId },
        );
      }
      const stagedLeaf = {
        path: staged,
        identity: identity(await Deno.lstat(staged)),
      };
      leaves.push(stagedLeaf);
      await mkdirTargetParents(
        dirname(target),
        authoritativePlan.targetRoot,
        createdDirs,
      );
      await assertSafeAncestors(authoritativePlan.targetRoot, target);
      if (
        item.target === ".ousia/framework.json" &&
        retirementJournals.length > 0
      ) {
        if (
          item.precondition?.kind !== "digest" || !item.sourceSha256
        ) throw new Error("manifest commit identity missing");
        const oldManifestInfo = await Deno.lstat(target);
        transactionRecordPath = join(staging, "journal", "transaction.json");
        transactionRecord = {
          schema: "ousia.install-commit.v1",
          transaction: stagingGuard.sentinelContent,
          manifestTarget: target,
          oldManifestIdentity: identity(oldManifestInfo),
          oldManifestSha256: item.precondition.sha256,
          newManifestIdentity: stagedLeaf.identity,
          newManifestSha256: item.sourceSha256,
          retirementJournals: await Promise.all(
            retirementJournals.map(async (path) => ({
              path,
              sha256: await digest.sha256(await Deno.readFile(path)),
            })),
          ),
          state: "ManifestCommitPending",
        };
        await writeSealedRecord(
          transactionRecordPath,
          transactionRecord,
          staging,
          createdDirs,
        );
        transactionRecord = await readTransactionCommitRecord(
          transactionRecordPath,
          staging,
          stagingGuard.sentinelContent,
          retirementJournals,
        );
        await assertManifestIdentityAndDigest(
          staged,
          transactionRecord.newManifestIdentity,
          transactionRecord.newManifestSha256,
        );
        await options.beforeManifestTargetCommit?.({
          target,
          transaction: transactionRecordPath,
        });
      }
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
      if (item.target === ".ousia/framework.json" && transactionRecord) {
        await options.afterManifestTargetCommit?.({
          target,
          transaction: transactionRecordPath!,
        });
        transactionRecord = await readTransactionCommitRecord(
          transactionRecordPath!,
          staging,
          stagingGuard.sentinelContent,
          retirementJournals,
        );
        const outcome = await readManifestDiskOutcome(transactionRecord);
        if (outcome !== "New") {
          throw new Error(`manifest commit disk outcome is ${outcome}`);
        }
        transactionRecord = {
          ...transactionRecord,
          state: "ManifestCommitted",
        };
        await writeSealedRecord(
          transactionRecordPath!,
          transactionRecord,
          staging,
          createdDirs,
        );
      }
    }
  } catch (error) {
    if (
      error instanceof ApplyError &&
      error.diagnostic.code === "apply-recovery-required"
    ) {
      throw error;
    }
    if (transactionRecordPath) {
      let sealed: TransactionCommitRecord;
      let outcome: ManifestDiskOutcome;
      try {
        sealed = await readTransactionCommitRecord(
          transactionRecordPath,
          staging,
          stagingGuard.sentinelContent,
          retirementJournals,
        );
        outcome = await readManifestDiskOutcome(sealed);
      } catch (recordError) {
        throw fail(
          "apply-recovery-required",
          manifest.FRAMEWORK_MANIFEST_PATH,
          "无法从sealed transaction record结算manifest结果，现场已保留。",
          "核验transaction record与磁盘manifest后人工选择rollback或cleanup。",
          { staging, transaction: transactionRecordPath },
          recordError,
        );
      }
      if (outcome === "New") {
        try {
          sealed = { ...sealed, state: "ManifestCommitted" };
          await writeSealedRecord(
            transactionRecordPath,
            sealed,
            staging,
            createdDirs,
          );
          sealed = { ...sealed, state: "CommittedCleanupPending" };
          await writeSealedRecord(
            transactionRecordPath,
            sealed,
            staging,
            createdDirs,
          );
          transactionRecord = sealed;
        } catch (recordError) {
          throw fail(
            "apply-recovery-required",
            manifest.FRAMEWORK_MANIFEST_PATH,
            "新manifest已提交但transaction record结算失败，现场已保留。",
            "依据磁盘manifest与transaction record人工完成cleanup。",
            { staging, transaction: transactionRecordPath },
            recordError,
          );
        }
        throw fail(
          "apply-recovery-required",
          manifest.FRAMEWORK_MANIFEST_PATH,
          "新manifest已提交，retirement cleanup尚未完成，现场已保留。",
          "依据transaction record核验后完成cleanup。",
          { staging, transaction: transactionRecordPath },
          error,
        );
      }
      if (outcome === "Unknown") {
        throw fail(
          "apply-recovery-required",
          manifest.FRAMEWORK_MANIFEST_PATH,
          "磁盘manifest既不匹配旧版本也不匹配新版本，现场已保留。",
          "核验target、backup与transaction record后人工恢复。",
          { staging, transaction: transactionRecordPath },
          error,
        );
      }
    }
    primary = error;
    try {
      await rollbackDirectoryRetirements(retirements);
      retirements.length = 0;
      await rollback(authoritativePlan.targetRoot, applied, createdDirs);
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
    await cleanupCommittedRetirements(retirements, staging, options);
    await cleanup(
      stagingGuard,
      leaves,
      [
        ...retirementJournals,
        ...(transactionRecordPath ? [transactionRecordPath] : []),
      ],
      createdDirs,
    );
  } catch (cleanupError) {
    let cleanupRecordError: unknown;
    if (transactionRecord && transactionRecordPath) {
      const outcome = await readManifestDiskOutcome(transactionRecord).catch(
        () => "Unknown" as const,
      );
      if (outcome === "New") {
        transactionRecord = {
          ...transactionRecord,
          state: "CommittedCleanupPending",
        };
        try {
          await options.beforeCleanupPendingRecordCommit?.({
            staging,
            transaction: transactionRecordPath,
          });
          await writeSealedRecord(
            transactionRecordPath,
            transactionRecord,
            staging,
            createdDirs,
          );
          transactionRecord = await readTransactionCommitRecord(
            transactionRecordPath,
            staging,
            stagingGuard.sentinelContent,
            retirementJournals,
          );
          if (transactionRecord.state !== "CommittedCleanupPending") {
            throw new Error("cleanup-pending transaction state was not sealed");
          }
        } catch (error) {
          cleanupRecordError = error;
        }
      }
    }
    throw fail(
      "apply-recovery-required",
      "",
      "staging 或目录 identity变化/存在未知内容，现场已保留。",
      "人工检查 staging 和目标空目录。",
      {
        staging,
        transactionState: cleanupRecordError ? "unsealed" : "sealed-or-none",
      },
      cleanupRecordError
        ? new AggregateError([cleanupError, cleanupRecordError])
        : cleanupError,
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

async function classifyExistingStaging(staging: string): Promise<ApplyError> {
  const fallback = () =>
    fail(
      "apply-staging-conflict",
      "",
      "staging namespace 已被占用且没有可验证的transaction authority。",
      "保留现有内容，人工检查后重试。",
      { staging },
    );
  try {
    const stagingInfo = await Deno.lstat(staging);
    if (stagingInfo.isSymlink || !stagingInfo.isDirectory) return fallback();
    const guardPath = join(staging, ".guard");
    const guardInfo = await Deno.lstat(guardPath);
    if (guardInfo.isSymlink || !guardInfo.isFile) return fallback();
    const transaction = await Deno.readTextFile(guardPath);
    const recordPath = join(staging, "journal", "transaction.json");
    const record = await readTransactionCommitRecord(
      recordPath,
      staging,
      transaction,
    );
    const journals: RetirementJournal[] = [];
    for (let index = 0; index < record.retirementJournals.length; index++) {
      const journalEvidence = record.retirementJournals[index];
      const journalPath = journalEvidence.path;
      if (
        journalPath !== join(staging, "journal", `retirement-${index}.json`)
      ) {
        throw new Error(
          `retirement journal inventory is not canonical: ${journalPath}`,
        );
      }
      if (
        await digest.sha256(await Deno.readFile(journalPath)) !==
          journalEvidence.sha256
      ) {
        throw new Error(`retirement journal digest changed: ${journalPath}`);
      }
      journals.push(
        await readRetirementJournal(journalPath, staging, transaction),
      );
    }
    const outcome = await readManifestDiskOutcome(record);
    await assertExistingRetirementAuthority(record, journals, outcome);
    let code: string;
    let message: string;
    if (outcome === "New") {
      code = "apply-committed-cleanup-pending";
      message = record.state === "CommittedCleanupPending"
        ? "新manifest已提交，存在未完成的retirement cleanup。"
        : "磁盘已是新manifest，transaction record尚未完成post-C4结算。";
    } else if (outcome === "Old") {
      code = "apply-precommit-recovery-pending";
      message = "磁盘仍是旧manifest，存在未完成的pre-C4 transaction。";
    } else {
      code = "apply-unknown-recovery-pending";
      message = "磁盘manifest与transaction record的old/new outcome均不匹配。";
    }
    return fail(
      code,
      manifest.FRAMEWORK_MANIFEST_PATH,
      message,
      "保留现场，依据sealed transaction record人工核验后再清理或恢复。",
      { staging, transaction: recordPath, state: record.state, outcome },
    );
  } catch {
    return fallback();
  }
}

async function assertExistingRetirementAuthority(
  record: TransactionCommitRecord,
  journals: RetirementJournal[],
  outcome: ManifestDiskOutcome,
): Promise<void> {
  if (
    record.oldManifestSha256 !== supportedRetirementManifestSha256 ||
    journals.some((journal) =>
      journal.acceptedPredecessor.manifestSha256 !== record.oldManifestSha256
    ) ||
    (record.state === "ManifestCommitPending" && outcome === "New") ||
    (record.state !== "ManifestCommitPending" && outcome !== "New")
  ) throw new Error("transaction and retirement authority disagree");
  for (const journal of journals) {
    if (
      journal.state !== "SurvivorCommitted" &&
      journal.state !== "TargetAbsent"
    ) throw new Error("transaction references an uncommitted retirement");
    const backupInfo = await Deno.lstat(journal.backup);
    if (
      backupInfo.isSymlink || !backupInfo.isDirectory ||
      !sameIdentity(identity(backupInfo), journal.backupIdentity) ||
      JSON.stringify(
          await readDirectoryDigestEntries(
            journal.backup,
            journal.backup,
            [],
          ),
        ) !== JSON.stringify(journal.managedEntries)
    ) throw new Error("retirement backup does not match sealed authority");
    if (journal.state === "SurvivorCommitted") {
      await assertRetirementContainer(
        journal.target,
        journal.survivorContainerIdentity,
        journal.survivors,
      );
    } else {
      try {
        await Deno.lstat(journal.target);
        throw new Error("TargetAbsent retirement has an occupied target");
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }
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
    if (item.action === "retire-directory") {
      const actualIdentity = identity(stat);
      if (
        hasIdentityEvidence(item.targetIdentity) &&
        !sameIdentity(actualIdentity, item.targetIdentity)
      ) {
        throw fail(
          "apply-target-changed",
          item.target,
          "directory retirement target identity在plan后变化。",
          "重新运行安装。",
          { target },
        );
      }
      await verifyRetirementSurvivorPreconditions(target, item);
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

async function readRetirementSurvivor(
  path: string,
  relativePath: string,
): Promise<Omit<RetirementSurvivor, "location">> {
  const stat = await Deno.lstat(path);
  if (stat.isSymlink || (!stat.isFile && !stat.isDirectory)) {
    throw fail(
      "apply-target-blocked",
      relativePath,
      "directory retirement survivor不是普通文件或目录。",
      "移除symlink或特殊文件后重新运行安装。",
      { path },
    );
  }
  const shape = stat.isDirectory ? "directory" : "file";
  return {
    relativePath,
    shape,
    identity: identity(stat),
    sha256: await targetDigest(path, shape, []),
  };
}

async function verifyRetirementSurvivorPreconditions(
  target: string,
  item: Extract<PlanItem, { action: "retire-directory" }>,
): Promise<void> {
  const expected = new Map(
    item.survivors.map((entry) => [entry.relativePath, entry]),
  );
  for (const relativePath of item.exclude) {
    const path = join(target, relativePath);
    const survivor = expected.get(relativePath);
    try {
      if (!survivor) {
        await Deno.lstat(path);
        throw fail(
          "apply-target-changed",
          item.target,
          "directory retirement survivor在plan后出现。",
          "重新运行安装。",
          { path },
        );
      }
      const actual = await readRetirementSurvivor(path, relativePath);
      if (
        actual.shape !== survivor.shape ||
        actual.sha256 !== survivor.sha256 ||
        (hasIdentityEvidence(survivor.identity) &&
          !sameIdentity(actual.identity, survivor.identity))
      ) {
        throw fail(
          "apply-target-changed",
          item.target,
          "directory retirement survivor在plan后变化。",
          "重新运行安装。",
          { path },
        );
      }
    } catch (error) {
      if (
        !survivor &&
        (error instanceof Deno.errors.NotFound ||
          error instanceof Deno.errors.NotADirectory)
      ) continue;
      throw error;
    }
  }
}

async function stageRetirementSurvivors(
  backup: string,
  survivorRoot: string,
  journalPath: string,
  initial: RetirementJournal,
  item: Extract<PlanItem, { action: "retire-directory" }>,
  staging: string,
  options: ApplyOptions,
  created: { path: string; identity: Identity }[],
  onCommit: (journal: RetirementJournal) => void = () => {},
): Promise<RetirementJournal> {
  let journal = initial;
  for (let index = 0; index < journal.survivors.length; index++) {
    const survivor = journal.survivors[index];
    const source = join(backup, survivor.relativePath);
    const destination = join(survivorRoot, survivor.relativePath);
    let moved = false;
    try {
      await assertRetirementSurvivor(source, survivor);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.rename(source, destination);
      moved = true;
      await assertRetirementSurvivor(destination, survivor);
      await options.beforeRetirementRecordCommit?.({
        phase: "survivor-location",
        item,
        relativePath: survivor.relativePath,
        staging,
      });
      const next: RetirementJournal = {
        ...journal,
        survivors: journal.survivors.map((entry, entryIndex) =>
          entryIndex === index
            ? { ...entry, location: "SurvivorStaging" }
            : entry
        ),
        state: index === journal.survivors.length - 1
          ? "SurvivorsStaged"
          : journal.state,
      };
      await writeSealedRecord(journalPath, next, staging, created);
      journal = next;
      onCommit(journal);
    } catch (error) {
      try {
        if (moved) {
          await assertRetirementSurvivor(destination, survivor);
          await options.beforeRetirementCompensation?.({
            phase: "survivor-location",
            item,
            relativePath: survivor.relativePath,
            staging,
          });
          await Deno.rename(destination, source);
          await assertRetirementSurvivor(source, survivor);
          await assertRetirementJournal(journalPath, journal);
        }
        journal = await restoreStagedRetirementSurvivors(
          backup,
          survivorRoot,
          journalPath,
          journal,
          item,
          staging,
          options,
          created,
          onCommit,
        );
      } catch (compensationError) {
        throw fail(
          "apply-recovery-required",
          item.target,
          "survivor location提交失败且无法证明相邻补偿完成，现场已保留。",
          "依据retirement journal核验backup与survivor staging后人工恢复。",
          {
            backup,
            survivor: destination,
            journal: journalPath,
            transaction: journal.transaction,
          },
          compensationError,
        );
      }
      throw error;
    }
  }
  if (journal.survivors.length === 0) {
    const next = { ...journal, state: "SurvivorsStaged" as const };
    await writeSealedRecord(journalPath, next, staging, created);
    onCommit(next);
    return next;
  }
  return journal;
}

async function restoreStagedRetirementSurvivors(
  backup: string,
  survivorRoot: string,
  journalPath: string,
  initial: RetirementJournal,
  item: Extract<PlanItem, { action: "retire-directory" }>,
  staging: string,
  options: ApplyOptions,
  created: { path: string; identity: Identity }[],
  onCommit: (journal: RetirementJournal) => void = () => {},
): Promise<RetirementJournal> {
  let journal = initial;
  for (let index = journal.survivors.length - 1; index >= 0; index--) {
    const survivor = journal.survivors[index];
    if (survivor.location !== "SurvivorStaging") continue;
    const source = join(survivorRoot, survivor.relativePath);
    const destination = join(backup, survivor.relativePath);
    await assertRetirementSurvivor(source, survivor);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.rename(source, destination);
    const next: RetirementJournal = {
      ...journal,
      survivors: journal.survivors.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, location: "Backup" } : entry
      ),
      state: "BackedUp",
    };
    try {
      await assertRetirementSurvivor(destination, survivor);
      await options.beforeRetirementRestoreRecordCommit?.({
        phase: "survivor-restore-location",
        item,
        relativePath: survivor.relativePath,
        staging,
      });
      await writeSealedRecord(journalPath, next, staging, created);
      journal = next;
      onCommit(journal);
    } catch (error) {
      try {
        await assertRetirementSurvivor(destination, survivor);
        await Deno.rename(destination, source);
        await assertRetirementSurvivor(source, survivor);
        await assertRetirementJournal(journalPath, journal);
      } catch (reverseError) {
        throw new AggregateError(
          [error, reverseError],
          `retirement survivor rollback cannot be proven: ${survivor.relativePath}`,
        );
      }
      throw error;
    }
  }
  return journal;
}

async function assertRetirementSurvivor(
  path: string,
  expected: RetirementSurvivor,
): Promise<void> {
  const actual = await readRetirementSurvivor(path, expected.relativePath);
  if (
    actual.shape !== expected.shape ||
    !sameIdentity(actual.identity, expected.identity) ||
    actual.sha256 !== expected.sha256
  ) {
    throw new Error(`retirement survivor changed: ${path}`);
  }
}

async function assertRetirementContainer(
  path: string,
  expectedIdentity: Identity,
  survivors: RetirementSurvivor[],
): Promise<void> {
  const info = await Deno.lstat(path);
  if (
    info.isSymlink || !info.isDirectory ||
    !sameIdentity(identity(info), expectedIdentity)
  ) throw new Error(`retirement survivor container changed: ${path}`);
  for (const survivor of survivors) {
    await assertRetirementSurvivor(join(path, survivor.relativePath), survivor);
  }
}

async function assertRetirementJournal(
  path: string,
  expected: RetirementJournal,
): Promise<void> {
  const actual = await readRetirementJournal(
    path,
    dirname(dirname(path)),
    expected.transaction,
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`retirement journal changed: ${path}`);
  }
}

async function readRetirementJournal(
  path: string,
  staging: string,
  transaction: string,
  item?: Extract<PlanItem, { action: "retire-directory" }>,
): Promise<RetirementJournal> {
  const expectedJournalRoot = join(staging, "journal");
  if (!isConfinedPath(expectedJournalRoot, path)) {
    throw new Error(`retirement journal path escapes journal root: ${path}`);
  }
  const fileName = relative(expectedJournalRoot, path);
  if (!/^retirement-[0-9]+\.json$/.test(fileName)) {
    throw new Error(`retirement journal path is not canonical: ${path}`);
  }
  const value = JSON.parse(await Deno.readTextFile(path));
  if (
    !isRecord(value) || value.schema !== "ousia.directory-retirement.v1" ||
    !hasExactKeys(value, [
      "schema",
      "transaction",
      "assetId",
      "acceptedPredecessor",
      "target",
      "targetIdentity",
      "backup",
      "backupIdentity",
      "survivor",
      "survivorContainerIdentity",
      "managedSha256",
      "managedEntries",
      "exclude",
      "survivors",
      "state",
    ])
  ) {
    throw new Error(`invalid retirement journal schema: ${path}`);
  }
  if (value.transaction !== transaction) {
    throw new Error(`retirement journal transaction mismatch: ${path}`);
  }
  const stringFields = [
    "assetId",
    "target",
    "backup",
    "survivor",
    "managedSha256",
  ] as const;
  for (const field of stringFields) {
    if (typeof value[field] !== "string") {
      throw new Error(`invalid retirement journal ${field}: ${path}`);
    }
  }
  const target = value.target as string;
  const backup = value.backup as string;
  const survivor = value.survivor as string;
  if (
    !isConfinedPath(dirname(staging), target) ||
    !isConfinedPath(join(staging, "backup"), backup) ||
    !isConfinedPath(join(staging, "survivor"), survivor)
  ) {
    throw new Error(
      `retirement journal path escapes transaction roots: ${path}`,
    );
  }
  const root = dirname(staging);
  const relativeTarget = relative(root, target);
  if (
    !isCanonicalRelativePath(relativeTarget) ||
    backup !== join(staging, "backup", relativeTarget) ||
    survivor !== join(staging, "survivor", relativeTarget)
  ) {
    throw new Error(`retirement journal paths are not canonical: ${path}`);
  }
  if (
    !isIdentity(value.targetIdentity) ||
    !isIdentity(value.backupIdentity) ||
    !isIdentity(value.survivorContainerIdentity) ||
    !Array.isArray(value.exclude) ||
    !value.exclude.every(isCanonicalRelativePath) ||
    !isSha256(value.managedSha256) ||
    !Array.isArray(value.managedEntries) ||
    !value.managedEntries.every(isTreeEntry) ||
    !isUniqueSortedPaths(value.managedEntries) ||
    !Array.isArray(value.survivors) ||
    !value.survivors.every(isRetirementSurvivor) ||
    !hasUniquePaths(value.survivors, "relativePath") ||
    ![
      "Preflighted",
      "BackedUp",
      "SurvivorsStaged",
      "SurvivorCommitted",
      "TargetAbsent",
    ]
      .includes(String(value.state)) ||
    !isAcceptedPredecessor(value.acceptedPredecessor)
  ) throw new Error(`invalid retirement journal fields: ${path}`);
  if (
    await digest.treeSha256(value.managedEntries as digest.TreeEntry[]) !==
      value.managedSha256 ||
    !hasValidRetirementLocations(
      String(value.state),
      value.survivors as RetirementSurvivor[],
    )
  ) throw new Error(`invalid retirement journal authority: ${path}`);
  if (item) {
    if (
      value.assetId !== item.assetId || target !== join(root, item.target) ||
      backup !== join(staging, "backup", item.target) ||
      survivor !== join(staging, "survivor", item.target) ||
      value.managedSha256 !== item.precondition.sha256 ||
      JSON.stringify(value.acceptedPredecessor) !==
        JSON.stringify(item.acceptedPredecessor) ||
      JSON.stringify(value.targetIdentity) !==
        JSON.stringify(item.targetIdentity) ||
      JSON.stringify(value.managedEntries) !==
        JSON.stringify(item.managedEntries) ||
      JSON.stringify(value.exclude) !== JSON.stringify(item.exclude) ||
      !sameSurvivorEvidence(value.survivors, item.survivors)
    ) throw new Error(`retirement journal authority mismatch: ${path}`);
  }
  return value as unknown as RetirementJournal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown): value is Identity {
  if (!isRecord(value)) return false;
  return hasExactKeys(value, ["dev", "ino", "birthtime"]) &&
    ["dev", "ino", "birthtime"].every((field) =>
      value[field] === null || typeof value[field] === "number"
    );
}

function isCanonicalRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    relative(".", value) === value && value !== ".." &&
    !value.startsWith(`..${SEPARATOR}`);
}

function isTreeEntry(value: unknown): value is digest.TreeEntry {
  return isRecord(value) && isCanonicalRelativePath(value.path) &&
    isSha256(value.sha256) && hasExactKeys(value, ["path", "sha256"]);
}

function isRetirementSurvivor(value: unknown): value is RetirementSurvivor {
  return isRecord(value) && isCanonicalRelativePath(value.relativePath) &&
    ["file", "directory"].includes(String(value.shape)) &&
    isIdentity(value.identity) && isSha256(value.sha256) &&
    ["Backup", "SurvivorStaging", "CommittedTarget"].includes(
      String(value.location),
    ) && hasExactKeys(value, [
      "relativePath",
      "shape",
      "identity",
      "sha256",
      "location",
    ]);
}

function isAcceptedPredecessor(
  value: unknown,
): value is RetirementJournal["acceptedPredecessor"] {
  return isRecord(value) &&
    value.generation === "rust-checker-directory-v1" &&
    value.manifestSha256 === supportedRetirementManifestSha256 &&
    hasExactKeys(value, ["generation", "manifestSha256"]);
}

function hasValidRetirementLocations(
  state: string,
  survivors: RetirementSurvivor[],
): boolean {
  const allowed = state === "Preflighted"
    ? ["Backup"]
    : state === "BackedUp"
    ? ["Backup", "SurvivorStaging"]
    : state === "SurvivorsStaged"
    ? ["SurvivorStaging"]
    : state === "SurvivorCommitted"
    ? ["CommittedTarget"]
    : state === "TargetAbsent"
    ? []
    : null;
  return allowed !== null &&
    survivors.every((survivor) => allowed.includes(survivor.location));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: string[],
): boolean {
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...keys].sort());
}

function isUniqueSortedPaths(
  values: unknown[],
  field: "path" | "relativePath" = "path",
): boolean {
  const paths = values.map((value) =>
    isRecord(value) ? String(value[field] ?? "") : ""
  );
  return paths.length === new Set(paths).size &&
    JSON.stringify(paths) === JSON.stringify([...paths].sort());
}

function hasUniquePaths(
  values: unknown[],
  field: "path" | "relativePath",
): boolean {
  const paths = values.map((value) =>
    isRecord(value) ? String(value[field] ?? "") : ""
  );
  return paths.length === new Set(paths).size;
}

function sameSurvivorEvidence(
  actual: unknown[],
  expected: Extract<PlanItem, { action: "retire-directory" }>["survivors"],
): boolean {
  return JSON.stringify(actual.map((entry) => {
    const value = entry as RetirementSurvivor;
    return {
      relativePath: value.relativePath,
      shape: value.shape,
      identity: value.identity,
      sha256: value.sha256,
    };
  })) === JSON.stringify(expected);
}

function isConfinedPath(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix !== "" && suffix !== ".." &&
    !suffix.startsWith(`..${SEPARATOR}`);
}

async function readTransactionCommitRecord(
  path: string,
  staging: string,
  transaction: string,
  expectedRetirementJournals?: string[],
): Promise<TransactionCommitRecord> {
  if (path !== join(staging, "journal", "transaction.json")) {
    throw new Error(`transaction record path is not canonical: ${path}`);
  }
  const value = JSON.parse(await Deno.readTextFile(path));
  if (
    !isRecord(value) || value.schema !== "ousia.install-commit.v1" ||
    !hasExactKeys(value, [
      "schema",
      "transaction",
      "manifestTarget",
      "oldManifestIdentity",
      "oldManifestSha256",
      "newManifestIdentity",
      "newManifestSha256",
      "retirementJournals",
      "state",
    ])
  ) {
    throw new Error(`invalid transaction record schema: ${path}`);
  }
  if (value.transaction !== transaction) {
    throw new Error(`transaction record identity mismatch: ${path}`);
  }
  if (
    typeof value.manifestTarget !== "string" ||
    value.manifestTarget !==
      join(dirname(staging), manifest.FRAMEWORK_MANIFEST_PATH) ||
    !isIdentity(value.oldManifestIdentity) ||
    !isSha256(value.oldManifestSha256) ||
    !isIdentity(value.newManifestIdentity) ||
    !isSha256(value.newManifestSha256) ||
    !Array.isArray(value.retirementJournals) ||
    !value.retirementJournals.every((journal) =>
      isRecord(journal) && hasExactKeys(journal, ["path", "sha256"]) &&
      typeof journal.path === "string" && isSha256(journal.sha256) &&
      isConfinedPath(join(staging, "journal"), journal.path) &&
      /^retirement-[0-9]+\.json$/.test(
        relative(join(staging, "journal"), journal.path),
      )
    ) ||
    value.retirementJournals.length !==
      new Set(value.retirementJournals.map((journal) => journal.path)).size ||
    ![
      "ManifestCommitPending",
      "ManifestCommitted",
      "CommittedCleanupPending",
    ].includes(String(value.state))
  ) throw new Error(`invalid transaction record fields: ${path}`);
  if (
    expectedRetirementJournals &&
    JSON.stringify(value.retirementJournals.map((journal) => journal.path)) !==
      JSON.stringify(expectedRetirementJournals)
  ) {
    throw new Error(
      `transaction retirement journal inventory mismatch: ${path}`,
    );
  }
  return value as unknown as TransactionCommitRecord;
}

async function assertManifestIdentityAndDigest(
  path: string,
  expectedIdentity: Identity,
  expectedSha256: string,
): Promise<void> {
  const info = await Deno.lstat(path);
  if (
    info.isSymlink || !info.isFile ||
    !sameIdentity(identity(info), expectedIdentity) ||
    await digest.sha256(await Deno.readFile(path)) !== expectedSha256
  ) throw new Error(`manifest identity or digest changed: ${path}`);
}

async function readManifestDiskOutcome(
  record: TransactionCommitRecord,
): Promise<ManifestDiskOutcome> {
  try {
    const info = await Deno.lstat(record.manifestTarget);
    if (info.isSymlink || !info.isFile) return "Unknown";
    const currentIdentity = identity(info);
    const currentSha256 = await digest.sha256(
      await Deno.readFile(record.manifestTarget),
    );
    if (
      sameIdentity(currentIdentity, record.oldManifestIdentity) &&
      currentSha256 === record.oldManifestSha256
    ) return "Old";
    if (
      sameIdentity(currentIdentity, record.newManifestIdentity) &&
      currentSha256 === record.newManifestSha256
    ) return "New";
    return "Unknown";
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.NotADirectory
    ) return "Unknown";
    throw error;
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

async function rollbackDirectoryRetirements(
  retirements: RetirementRuntime[],
): Promise<void> {
  for (const runtime of [...retirements].reverse()) {
    let journal = await readRetirementJournal(
      runtime.journalPath,
      dirname(dirname(runtime.journalPath)),
      runtime.journal.transaction,
      runtime.item,
    );
    if (journal.state === "SurvivorCommitted") {
      const targetInfo = await Deno.lstat(journal.target);
      const targetIdentity = identity(targetInfo);
      if (!sameIdentity(targetIdentity, journal.survivorContainerIdentity)) {
        throw new Error(
          `retirement committed target changed: ${journal.target}`,
        );
      }
      await Deno.rename(journal.target, journal.survivor);
      journal = {
        ...journal,
        survivors: journal.survivors.map((entry) => ({
          ...entry,
          location: "SurvivorStaging" as const,
        })),
        state: "SurvivorsStaged",
      };
      await writeRetirementJournal(runtime, journal);
    }
    journal = await restoreStagedRetirementSurvivors(
      journal.backup,
      journal.survivor,
      runtime.journalPath,
      journal,
      runtime.item,
      dirname(dirname(runtime.journalPath)),
      {},
      [],
    );
    const backupInfo = await Deno.lstat(journal.backup);
    if (
      !sameIdentity(identity(backupInfo), journal.backupIdentity) ||
      (await targetDigest(journal.backup, "directory", journal.exclude)) !==
        journal.managedSha256
    ) {
      throw new Error(`retirement backup changed: ${journal.backup}`);
    }
    try {
      const survivorInfo = await Deno.lstat(journal.survivor);
      if (
        !sameIdentity(
          identity(survivorInfo),
          journal.survivorContainerIdentity,
        )
      ) {
        throw new Error(
          `retirement survivor container changed: ${journal.survivor}`,
        );
      }
      await Deno.remove(journal.survivor);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    try {
      await Deno.lstat(journal.target);
      throw new Error(`retirement rollback target occupied: ${journal.target}`);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await Deno.rename(journal.backup, journal.target);
    runtime.journal = journal;
  }
}

async function cleanupCommittedRetirements(
  retirements: RetirementRuntime[],
  staging: string,
  options: ApplyOptions,
): Promise<void> {
  for (const runtime of retirements) {
    await options.beforeRetirementCleanup?.({
      item: runtime.item,
      backup: runtime.journal.backup,
      journal: runtime.journalPath,
      target: runtime.journal.target,
      staging,
    });
    const journal = await readRetirementJournal(
      runtime.journalPath,
      staging,
      runtime.journal.transaction,
      runtime.item,
    );
    if (
      journal.state !== "SurvivorCommitted" &&
      journal.state !== "TargetAbsent"
    ) {
      throw new Error(`retirement is not committed: ${journal.assetId}`);
    }
    if (journal.state === "SurvivorCommitted") {
      await assertRetirementContainer(
        journal.target,
        journal.survivorContainerIdentity,
        journal.survivors,
      );
    }
    const backupInfo = await Deno.lstat(journal.backup);
    if (!sameIdentity(identity(backupInfo), journal.backupIdentity)) {
      throw new Error(`retirement backup identity changed: ${journal.backup}`);
    }
    const currentEntries = await readDirectoryDigestEntries(
      journal.backup,
      journal.backup,
      [],
    );
    if (
      JSON.stringify(currentEntries) !== JSON.stringify(journal.managedEntries)
    ) {
      throw new Error(
        `retirement backup contains unknown content: ${journal.backup}`,
      );
    }
    await removeManagedDirectoryEntries(journal.backup, journal.managedEntries);
  }
}

async function removeManagedDirectoryEntries(
  root: string,
  entries: digest.TreeEntry[],
): Promise<void> {
  for (const entry of entries) {
    const path = join(root, entry.path);
    const stat = await Deno.lstat(path);
    if (
      stat.isSymlink || !stat.isFile ||
      await digest.sha256(await Deno.readFile(path)) !== entry.sha256
    ) throw new Error(`managed retirement entry changed: ${path}`);
    await Deno.remove(path);
  }
  const directories = new Set<string>();
  for (const entry of entries) {
    let current = dirname(join(root, entry.path));
    while (current.startsWith(root) && current !== root) {
      directories.add(current);
      current = dirname(current);
    }
  }
  for (
    const directory of [...directories].sort((a, b) => b.length - a.length)
  ) {
    await Deno.remove(directory);
  }
  await Deno.remove(root);
}

async function writeRetirementJournal(
  runtime: RetirementRuntime,
  journal: RetirementJournal,
): Promise<void> {
  await writeSealedRecord(
    runtime.journalPath,
    journal,
    dirname(dirname(runtime.journalPath)),
    [],
  );
  runtime.journal = journal;
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
  records: string[],
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
  for (const record of records.reverse()) {
    await Deno.remove(record).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
    await Deno.remove(`${record}.tmp`).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
  await removeCreatedDirs(
    created.filter((item) => item.path.startsWith(guard.path)),
  );
  await assertStagingIdentity(guard);
  await Deno.remove(guard.sentinelPath);
  await Deno.remove(guard.path);
}

async function writeSealedRecord(
  path: string,
  value: RetirementJournal | TransactionCommitRecord,
  staging: string,
  created: { path: string; identity: Identity }[],
): Promise<void> {
  await mkdirTracked(dirname(path), staging, created);
  const temporary = `${path}.tmp`;
  await Deno.writeTextFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await Deno.rename(temporary, path);
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
function hasIdentityEvidence(value: Identity): boolean {
  return value.dev !== null || value.ino !== null || value.birthtime !== null;
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
