import { assertEquals, assertThrows } from "@std/assert";
import {
  loadManifest,
  matchOwnership,
  normalizeRelativePath,
  ownershipForPath,
} from "../src/manifest.ts";
import { makeMinimalPolicyManifest } from "./helpers.ts";

Deno.test("normalizes relative paths for ownership matching", () => {
  // Goal: protect manifest path matching across platform path spellings.
  // Scope: unit, manifest owner API.
  // Semantics: normalized paths match Ousia relative-path contracts.
  assertEquals(
    normalizeRelativePath(".\\.github\\skills\\x\\SKILL.md"),
    ".github/skills/x/SKILL.md",
  );
  assertEquals(
    normalizeRelativePath("./.ousia/workflow.json"),
    ".ousia/workflow.json",
  );
});

Deno.test("ownership matching respects local override precedence", () => {
  // Goal: protect the local override boundary from broader baseline patterns.
  // Scope: unit, manifest owner API.
  // Semantics: the highest-priority matching ownership class wins.
  const manifest = makeMinimalPolicyManifest({
    ownership: {
      ousiaOwned: [".ousia/**"],
      ousiaStructuredProjectFilled: [],
      projectOwned: [],
      localOverrides: [".ousia/overrides/**"],
    },
  });

  assertEquals(
    ownershipForPath(manifest, ".ousia/overrides/local.md"),
    "localOverrides",
  );
  assertEquals(
    ownershipForPath(manifest, ".ousia/workflow.json"),
    "ousiaOwned",
  );
});

Deno.test("ownership match exposes pattern and effective upgrade policy", () => {
  // Goal: make planner policy evidence auditable.
  // Scope: unit, manifest owner API.
  // Semantics: a match exposes ownership, matched pattern, and effective policy.
  const manifest = makeMinimalPolicyManifest();
  const match = matchOwnership(manifest, ".github/skills/x/SKILL.md");

  assertEquals(match, {
    ownership: "ousiaOwned",
    pattern: ".github/skills/**",
    upgradePolicy: "replace-baseline",
  });
});

Deno.test("manifest rejects unsupported schema version", () => {
  // Goal: reject manifests outside the supported installer contract.
  // Scope: unit, manifest boundary validation.
  // Semantics: unsupported schema fails before planning or writing.
  const manifest = makeMinimalPolicyManifest({ schemaVersion: "9.9.9" });
  assertThrows(
    () => loadManifest(JSON.stringify(manifest)),
    Error,
    "Unsupported Ousia manifest schema",
  );
});

Deno.test("manifest requires every ownership class", () => {
  // Goal: keep ownership policy complete for every supported class.
  // Scope: unit, manifest boundary validation.
  // Semantics: missing ownership class fails before planning.
  const manifest = makeMinimalPolicyManifest();
  delete (manifest.ownership as Partial<typeof manifest.ownership>)
    .localOverrides;

  assertThrows(
    () => loadManifest(JSON.stringify(manifest)),
    Error,
    "ownership.localOverrides must be an array",
  );
});

Deno.test("manifest rejects unsupported upgrade policy", () => {
  // Goal: keep planner actions inside known upgrade semantics.
  // Scope: unit, manifest boundary validation.
  // Semantics: unsupported policy values fail before planning.
  const manifest = makeMinimalPolicyManifest();
  manifest.upgradePolicy.ousiaOwned = "replace-if-unmodified" as never;

  assertThrows(
    () => loadManifest(JSON.stringify(manifest)),
    Error,
    "upgradePolicy.ousiaOwned has unsupported value",
  );
});
