import assert from "node:assert/strict";
import test from "node:test";
import {
  loadManifest,
  matchOwnership,
  normalizeRelativePath,
  ownershipForPath,
} from "../src/manifest.js";
import { makeMinimalPolicyManifest } from "./helpers.js";

test("normalizes relative paths for ownership matching", () => {
  // Goal: protect manifest path matching across platform path spellings.
  // Scope: unit, manifest owner API.
  // Semantics: normalized paths match Ousia relative-path contracts.
  assert.equal(
    normalizeRelativePath(".\\.github\\skills\\x\\SKILL.md"),
    ".github/skills/x/SKILL.md",
  );
  assert.equal(
    normalizeRelativePath("./.ousia/workflow.json"),
    ".ousia/workflow.json",
  );
});

test("ownership matching respects local override precedence", () => {
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

  assert.equal(
    ownershipForPath(manifest, ".ousia/overrides/local.md"),
    "localOverrides",
  );
  assert.equal(
    ownershipForPath(manifest, ".ousia/workflow.json"),
    "ousiaOwned",
  );
});

test("ownership match exposes pattern and effective upgrade policy", () => {
  // Goal: make planner policy evidence auditable.
  // Scope: unit, manifest owner API.
  // Semantics: a match exposes ownership, matched pattern, and effective policy.
  const manifest = makeMinimalPolicyManifest();
  const match = matchOwnership(manifest, ".github/skills/x/SKILL.md");

  assert.deepEqual(match, {
    ownership: "ousiaOwned",
    pattern: ".github/skills/**",
    upgradePolicy: "replace-baseline",
  });
});

test("manifest rejects unsupported schema version", () => {
  // Goal: reject manifests outside the supported installer contract.
  // Scope: unit, manifest boundary validation.
  // Semantics: unsupported schema fails before planning or writing.
  const manifest = makeMinimalPolicyManifest({ schemaVersion: "9.9.9" });
  assert.throws(
    () => loadManifest(JSON.stringify(manifest)),
    /Unsupported Ousia manifest schema/,
  );
});

test("manifest requires every ownership class", () => {
  // Goal: keep ownership policy complete for every supported class.
  // Scope: unit, manifest boundary validation.
  // Semantics: missing ownership class fails before planning.
  const manifest = makeMinimalPolicyManifest();
  delete (manifest.ownership as Partial<typeof manifest.ownership>)
    .localOverrides;

  assert.throws(
    () => loadManifest(JSON.stringify(manifest)),
    /ownership\.localOverrides must be an array/,
  );
});

test("manifest rejects unsupported upgrade policy", () => {
  // Goal: keep planner actions inside known upgrade semantics.
  // Scope: unit, manifest boundary validation.
  // Semantics: unsupported policy values fail before planning.
  const manifest = makeMinimalPolicyManifest();
  manifest.upgradePolicy.ousiaOwned = "replace-if-unmodified" as never;

  assert.throws(
    () => loadManifest(JSON.stringify(manifest)),
    /upgradePolicy\.ousiaOwned has unsupported value/,
  );
});
