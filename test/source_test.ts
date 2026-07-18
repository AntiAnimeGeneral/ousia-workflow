import { assert, assertEquals } from "@std/assert";
import * as source from "../src/source.ts";
import * as projectFixture from "./project-fixture.ts";

Deno.test("source snapshot exactly follows explicit inventory", async () => {
  // Goal: prove manifest is the only installation inventory owner.
  // Scope: integration, real source checkout.
  // Semantics: snapshot order equals assets and excludes host/project facts.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  assertEquals(
    snapshot.assets.map((item) => item.id),
    snapshot.manifest.install.assets.map((item) => item.id),
  );
  assertEquals(
    snapshot.assets.some(
      (item) =>
        item.source ===
          ".github/instructions/ext-ousia-workflow.instructions.md",
    ),
    false,
  );
  assertEquals(
    snapshot.assets.some((item) => item.source === ".ousia/project.json"),
    false,
  );
  assert(
    snapshot.assets.some(
      (item) =>
        item.source === "templates/project/.ousia/project.json" &&
        item.target === ".ousia/project.json",
    ),
  );
});
