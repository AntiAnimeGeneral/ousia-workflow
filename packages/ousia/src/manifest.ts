import { minimatch } from "minimatch";

export type OwnershipClass =
  | "ousiaOwned"
  | "ousiaStructuredProjectFilled"
  | "projectOwned"
  | "localOverrides";

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
  upgradePolicy: Record<OwnershipClass, string>;
  validation: {
    docValidationConfig: string | null;
    requiredChecks: string[];
  };
}

const ownershipOrder: OwnershipClass[] = [
  "localOverrides",
  "projectOwned",
  "ousiaStructuredProjectFilled",
  "ousiaOwned",
];

export function loadManifest(content: string): OusiaManifest {
  const parsed = JSON.parse(content) as OusiaManifest;
  validateManifest(parsed);
  return parsed;
}

export function ownershipForPath(
  manifest: OusiaManifest,
  relativePath: string,
): OwnershipClass | null {
  const normalized = normalizeRelativePath(relativePath);

  for (const ownership of ownershipOrder) {
    const patterns = manifest.ownership[ownership] ?? [];
    if (patterns.some((pattern) => minimatch(normalized, pattern, { dot: true }))) {
      return ownership;
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
    throw new Error(`Unsupported Ousia manifest schema: ${manifest.schemaVersion}`);
  }

  for (const ownership of ownershipOrder) {
    if (!Array.isArray(manifest.ownership?.[ownership])) {
      throw new Error(`Invalid Ousia manifest: ownership.${ownership} must be an array`);
    }
  }
}