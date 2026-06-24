import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceSnapshot } from "./source.js";

export const INSTALL_LOCK_PATH = ".ousia/install-lock.json";

export interface InstallLockFile {
  relativePath: string;
  sha256: string;
}

export interface InstallLock {
  schemaVersion: "0.1.0";
  workflow: {
    name: string;
    version: string;
  };
  files: InstallLockFile[];
}

export async function readInstallLock(
  targetRoot: string,
): Promise<InstallLock | null> {
  const lockPath = path.join(targetRoot, INSTALL_LOCK_PATH);
  let content: string;
  try {
    content = await fs.readFile(lockPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const parsed = JSON.parse(content) as InstallLock;
  validateInstallLock(parsed);
  return parsed;
}

export async function writeInstallLock(
  targetRoot: string,
  source: SourceSnapshot,
): Promise<void> {
  const lock = buildInstallLock(source);
  const lockPath = path.join(targetRoot, INSTALL_LOCK_PATH);
  const tempPath = `${lockPath}.tmp`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, lockPath);
}

export function buildInstallLock(source: SourceSnapshot): InstallLock {
  return {
    schemaVersion: "0.1.0",
    workflow: {
      name: source.manifest.workflow.name,
      version: source.manifest.workflow.version,
    },
    files: source.files.map((file) => ({
      relativePath: file.relativePath,
      sha256: sha256(file.content),
    })),
  };
}

export function lockHashFor(
  lock: InstallLock | null,
  relativePath: string,
): string | null {
  return (
    lock?.files.find((file) => file.relativePath === relativePath)?.sha256 ??
    null
  );
}

export function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function validateInstallLock(lock: InstallLock): void {
  if (!lock || typeof lock !== "object") {
    throw new Error("Invalid Ousia install lock: expected object");
  }
  if (lock.schemaVersion !== "0.1.0") {
    throw new Error(
      `Unsupported Ousia install lock schema: ${lock.schemaVersion}`,
    );
  }
  if (!Array.isArray(lock.files)) {
    throw new Error("Invalid Ousia install lock: files must be an array");
  }
}