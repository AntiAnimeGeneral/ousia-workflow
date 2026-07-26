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

Deno.test("source snapshot reads directory asset as a tree digest", async () => {
  // Goal: prove directory asset identity is the directory, not per-file IDs.
  // Scope: integration, real source checkout through source snapshot.
  // Semantics: Rust checker Cargo project has one asset with deterministic child entries.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const rustSource = snapshot.assets.find(
    (asset) => asset.id === "tool.rust-checker",
  );
  assert(rustSource);
  assertEquals(rustSource.shape, "directory");
  assertEquals(rustSource.content, null);
  assert(rustSource.tree?.some((entry) => entry.path === "Cargo.toml"));
  assert(rustSource.tree?.some((entry) => entry.path === "Cargo.lock"));
  assert(rustSource.tree?.some((entry) => entry.path === "src/lib.rs"));
  assert(
    rustSource.tree?.some((entry) => entry.path === "src/rules/use_alias.rs"),
  );
  assertEquals(
    rustSource.tree?.some((entry) => entry.path.startsWith("target/")),
    false,
  );
  assertEquals(rustSource.sha256.length, 64);

  const docsScripts = snapshot.assets.find(
    (asset) => asset.id === "tool.docs-scripts",
  );
  assert(docsScripts);
  assertEquals(docsScripts.shape, "directory");
  assertEquals(docsScripts.content, null);
  assert(
    docsScripts.tree?.some((entry) => entry.path === "check-docs.ts"),
  );
  assert(
    docsScripts.tree?.some((entry) => entry.path === "frontmatter.ts"),
  );
  assert(
    docsScripts.tree?.some((entry) => entry.path === "std-modules.d.ts"),
  );
  assertEquals(docsScripts.sha256.length, 64);
});
