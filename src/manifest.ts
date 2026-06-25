export type OwnershipClass =
  | "ousiaOwned"
  | "ousiaStructuredProjectFilled"
  | "projectOwned"
  | "localOverrides";

export type UpgradePolicy =
  | "replace-baseline"
  | "replace-managed-regions"
  | "route-and-validate-only"
  | "never-overwrite";

export interface OusiaManifest {
  schemaVersion: string;
  workflow: {
    name: string;
    version: string;
  };
  project: {
    name: string;
  };
  ownership: Record<OwnershipClass, string[]>;
  upgradePolicy: Record<OwnershipClass, UpgradePolicy>;
  validation: {
    docValidationConfig: string | null;
    requiredChecks: string[];
  };
}

export interface OwnershipMatch {
  ownership: OwnershipClass;
  pattern: string;
  upgradePolicy: UpgradePolicy;
}

const ownershipOrder: OwnershipClass[] = [
  "localOverrides",
  "projectOwned",
  "ousiaStructuredProjectFilled",
  "ousiaOwned",
];

const upgradePolicies = new Set<UpgradePolicy>([
  "replace-baseline",
  "replace-managed-regions",
  "route-and-validate-only",
  "never-overwrite",
]);

export function loadManifest(content: string): OusiaManifest {
  const parsed = JSON.parse(content) as OusiaManifest;
  validateManifest(parsed);
  return parsed;
}

export function ownershipForPath(
  manifest: OusiaManifest,
  relativePath: string,
): OwnershipClass | null {
  return matchOwnership(manifest, relativePath)?.ownership ?? null;
}

export function matchOwnership(
  manifest: OusiaManifest,
  relativePath: string,
): OwnershipMatch | null {
  const normalized = normalizeRelativePath(relativePath);

  for (const ownership of ownershipOrder) {
    const patterns = manifest.ownership[ownership] ?? [];
    for (const pattern of patterns) {
      if (matchesGlob(normalized, pattern)) {
        return {
          ownership,
          pattern,
          upgradePolicy: manifest.upgradePolicy[ownership],
        };
      }
    }
  }

  return null;
}

export function normalizeRelativePath(path: string): string {
  return path.split("\\").join("/").replace(/^\.\//, "");
}

function validateManifest(manifest: OusiaManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Invalid Ousia manifest: expected object");
  }

  if (manifest.schemaVersion !== "0.1.0") {
    throw new Error(
      `Unsupported Ousia manifest schema: ${manifest.schemaVersion}`,
    );
  }

  for (const ownership of ownershipOrder) {
    if (!Array.isArray(manifest.ownership?.[ownership])) {
      throw new Error(
        `Invalid Ousia manifest: ownership.${ownership} must be an array`,
      );
    }

    if (!upgradePolicies.has(manifest.upgradePolicy?.[ownership])) {
      throw new Error(
        `Invalid Ousia manifest: upgradePolicy.${ownership} has unsupported value`,
      );
    }
  }
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  return globToRegExp(normalizeRelativePath(pattern)).test(relativePath);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(char: string): string {
  return /[\\^$+?.()|{}[\]]/.test(char) ? `\\${char}` : char;
}
