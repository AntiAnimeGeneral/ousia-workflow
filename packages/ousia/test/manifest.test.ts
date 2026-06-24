import assert from "node:assert/strict";
import test from "node:test";
import {
  loadManifest,
  matchOwnership,
  normalizeRelativePath,
  ownershipForPath,
} from "../src/manifest.js";
import { makeManifest } from "./helpers.js";

test("normalizes relative paths for ownership matching", () => {
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
  const manifest = makeManifest({
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
  const manifest = makeManifest();
  const match = matchOwnership(manifest, ".github/skills/x/SKILL.md");

  assert.deepEqual(match, {
    ownership: "ousiaOwned",
    pattern: ".github/skills/**",
    upgradePolicy: "replace-baseline",
  });
});

test("manifest rejects unsupported schema version", () => {
  const manifest = makeManifest({ schemaVersion: "9.9.9" });
  assert.throws(
    () => loadManifest(JSON.stringify(manifest)),
    /Unsupported Ousia manifest schema/,
  );
});

test("manifest requires every ownership class", () => {
  const manifest = makeManifest();
  delete (manifest.ownership as Partial<typeof manifest.ownership>)
    .localOverrides;

  assert.throws(
    () => loadManifest(JSON.stringify(manifest)),
    /ownership\.localOverrides must be an array/,
  );
});

test("manifest rejects unsupported upgrade policy", () => {
  const manifest = makeManifest();
  manifest.upgradePolicy.ousiaOwned = "replace-if-unmodified" as never;

  assert.throws(
    () => loadManifest(JSON.stringify(manifest)),
    /upgradePolicy\.ousiaOwned has unsupported value/,
  );
});
