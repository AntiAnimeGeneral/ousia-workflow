import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import * as digest from "../src/digest.ts";
import * as manifest from "../src/manifest.ts";
import * as planner from "../src/planner.ts";
import * as source from "../src/source.ts";
import * as projectFixture from "./project-fixture.ts";

Deno.test("retirement requires a source tombstone", async () => {
  // Goal: prevent untrusted removal of an old framework asset.
  // Scope: unit, planner retirement authority.
  // Semantics: missing source tombstone blocks the plan and preserves the target.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets.push({
    id: "old.framework",
    source: "old.md",
    target: "old.md",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  await Deno.mkdir(join(target, ".ousia"));
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.writeTextFile(join(target, "old.md"), "old\n");

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(
    plan.items.find((item) => item.assetId === "old.framework")?.diagnostic
      .code,
    "retirement-tombstone-missing",
  );
});

Deno.test("trusted tombstone deletes only an old framework asset", async () => {
  // Goal: authorize retirement only with matching old membership and digest evidence.
  // Scope: unit, planner trusted tombstone path.
  // Semantics: matching framework bytes produce delete without weakening project ownership.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const content = new TextEncoder().encode("old\n");
  const old = structuredClone(snapshot.manifest);
  old.install.assets.push({
    id: "old.framework",
    source: "old.md",
    target: "old.md",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  snapshot.manifest.install.retiredAssets.push({
    id: "old.framework",
    target: "old.md",
    sha256: await digest.sha256(content),
  });
  await Deno.mkdir(join(target, ".ousia"));
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.writeFile(join(target, "old.md"), content);

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(
    plan.items.find((item) => item.assetId === "old.framework")?.action,
    "delete",
  );
});

Deno.test("retired project asset is preserved without tombstone", async () => {
  // Goal: keep project-owned facts outside framework retirement authority.
  // Scope: unit, planner project ownership path.
  // Semantics: a removed project seed produces no delete or conflict item.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets.push({
    id: "old.project",
    source: "templates/old.md",
    target: ".ousia/old.md",
    kind: "project-seed",
    ownership: "project",
    update: "create",
    retire: "preserve",
    projectFactSlot: "project.pending",
  });
  await Deno.mkdir(join(target, ".ousia"));
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.writeTextFile(join(target, ".ousia/old.md"), "fact\n");

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(
    plan.items.some((item) => item.assetId === "old.project"),
    false,
  );
});

Deno.test("target manifest from another workflow blocks planning", async () => {
  // Goal: reject retirement evidence from a different workflow identity.
  // Scope: unit, planner target manifest precondition.
  // Semantics: workflow mismatch blocks before any executable mutation plan exists.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = manifest.loadFrameworkManifest(JSON.stringify(snapshot.manifest));
  old.workflow.id = "other-workflow";
  await Deno.mkdir(join(target, ".ousia"));
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(plan.items[0].diagnostic.code, "target-workflow-mismatch");
});

Deno.test("framework manifest is the last mutable plan item", async () => {
  // Goal: preserve manifest-last transaction ordering.
  // Scope: unit, planner mutable item ordering.
  // Semantics: every asset mutation precedes framework manifest commit.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const plan = await planner.planInstall(snapshot, target);
  const mutable = plan.items.filter(
    (item) =>
      item.action === "create" ||
      item.action === "replace" ||
      item.action === "delete",
  );
  assertEquals(mutable.at(-1)?.target, ".ousia/framework.json");
});

Deno.test("asset ID cannot silently move to another target", async () => {
  // Goal: protect stable asset identity across baseline versions.
  // Scope: unit, planner active asset identity check.
  // Semantics: changing a target under the same ID blocks instead of migrating silently.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets[1].target = "old-location.md";
  await Deno.mkdir(join(target, ".ousia"));
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.writeTextFile(join(target, "old-location.md"), "old\n");
  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(
    plan.items.find((item) => item.diagnostic.code === "asset-identity-changed")
      ?.target,
    "old-location.md",
  );
});

Deno.test(
  "new framework ID cannot take over an old project target",
  async () => {
    // Goal: prevent framework ownership from replacing an old project-owned target.
    // Scope: unit, planner cross-version ownership check.
    // Semantics: reclassification blocks and project bytes remain outside the plan.
    const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
    const target = await projectFixture.makeTempProject();
    const old = structuredClone(snapshot.manifest);
    const framework = snapshot.manifest.install.assets.find(
      (asset) => asset.ownership === "framework" && asset.kind !== "manifest",
    )!;
    const project = old.install.assets.find(
      (asset) => asset.ownership === "project",
    )!;
    project.target = framework.target;
    project.id = "old.project-owner";
    old.projectFacts.find(
      (slot) => slot.id === project.projectFactSlot,
    )!.paths = [framework.target];
    old.install.assets.find((asset) => asset.id === framework.id)!.target =
      "old-framework-location.md";
    await Deno.mkdir(join(target, ".ousia"));
    await Deno.writeTextFile(
      join(target, ".ousia/framework.json"),
      JSON.stringify(old),
    );
    await Deno.mkdir(
      join(
        target,
        framework.target.substring(0, framework.target.lastIndexOf("/")),
      ),
      { recursive: true },
    );
    await Deno.writeTextFile(join(target, framework.target), "project-owned\n");
    const plan = await planner.planInstall(snapshot, target);
    assertEquals(plan.blocked, true);
    assertEquals(
      plan.items.some(
        (item) => item.diagnostic.code === "project-ownership-reclassified",
      ),
      true,
    );
  },
);

Deno.test(
  "new framework target cannot enter an old slot without a seed asset",
  async () => {
    // Goal: protect old project fact slots even when no seed asset claims them.
    // Scope: unit, planner slot reclassification check.
    // Semantics: overlap blocks rather than converting project facts to framework assets.
    const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
    const target = await projectFixture.makeTempProject();
    const old = structuredClone(snapshot.manifest);
    const framework = snapshot.manifest.install.assets.find(
      (asset) => asset.ownership === "framework" && asset.kind !== "manifest",
    )!;
    old.install.assets.find((asset) => asset.id === framework.id)!.target =
      "old-framework-location.md";
    old.projectFacts.push({
      id: "project.slot-only",
      paths: [framework.target],
      required: false,
    });
    await Deno.mkdir(join(target, ".ousia"));
    await Deno.writeTextFile(
      join(target, ".ousia/framework.json"),
      JSON.stringify(old),
    );
    await Deno.mkdir(
      join(
        target,
        framework.target.substring(0, framework.target.lastIndexOf("/")),
      ),
      { recursive: true },
    );
    await Deno.writeTextFile(join(target, framework.target), "project-owned\n");
    const plan = await planner.planInstall(snapshot, target);
    assertEquals(plan.blocked, true);
    assertEquals(
      plan.items.some(
        (item) => item.diagnostic.code === "project-slot-reclassified",
      ),
      true,
    );
  },
);

Deno.test("directory asset accepts old framework file membership", async () => {
  // Goal: allow the Rust checker project migration without per-file tombstones.
  // Scope: unit, planner compatibility path through real source snapshot.
  // Semantics: old framework-owned files under the new directory target are covered by the directory asset.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets = old.install.assets.filter(
    (asset) => asset.id !== "tool.rust-checker",
  );
  old.install.assets.push({
    id: "tool.rust-checker-lib",
    source: ".github/skills/rust-engineering/checker/src/lib.rs",
    target: ".github/skills/rust-engineering/checker/src/lib.rs",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.mkdir(
    join(target, ".github/skills/rust-engineering/checker/src"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/rust-engineering/checker/src/lib.rs"),
    "old framework lib\n",
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(
    plan.items.some(
      (item) => item.diagnostic.code === "retirement-tombstone-missing",
    ),
    false,
  );
  assertEquals(
    plan.items.find((item) => item.assetId === "tool.rust-checker")
      ?.action,
    "replace",
  );
});

Deno.test("directory asset accepts previous checker src directory membership", async () => {
  // Goal: allow upgrading the intermediate checker/src directory asset to the checker project asset.
  // Scope: unit, planner compatibility path through real source snapshot.
  // Semantics: old Cargo file assets and the old src directory asset are covered by the new checker directory asset.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets = old.install.assets.filter(
    (asset) => asset.id !== "tool.rust-checker",
  );
  old.install.assets.push(
    {
      id: "tool.rust-checker-cargo",
      source: ".github/skills/rust-engineering/checker/Cargo.toml",
      target: ".github/skills/rust-engineering/checker/Cargo.toml",
      kind: "tool",
      ownership: "framework",
      update: "replace",
      retire: "delete",
    },
    {
      id: "tool.rust-checker-lock",
      source: ".github/skills/rust-engineering/checker/Cargo.lock",
      target: ".github/skills/rust-engineering/checker/Cargo.lock",
      kind: "tool",
      ownership: "framework",
      update: "replace",
      retire: "delete",
    },
    {
      id: "tool.rust-checker-src",
      shape: "directory",
      source: ".github/skills/rust-engineering/checker/src",
      target: ".github/skills/rust-engineering/checker/src",
      kind: "tool",
      ownership: "framework",
      update: "replace",
      retire: "delete",
    },
  );
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.mkdir(
    join(target, ".github/skills/rust-engineering/checker/src/rules"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/rust-engineering/checker/Cargo.toml"),
    '[package]\nname = "old"\nversion = "0.0.0"\n',
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/rust-engineering/checker/Cargo.lock"),
    "# old lock\n",
  );
  await Deno.writeTextFile(
    join(
      target,
      ".github/skills/rust-engineering/checker/src/rules/use_alias.rs",
    ),
    "old framework rule\n",
  );
  await Deno.mkdir(
    join(target, ".github/skills/rust-engineering/checker/target/debug"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/rust-engineering/checker/target/debug/build"),
    "build output\n",
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(
    plan.items.some(
      (item) => item.diagnostic.code === "directory-unknown-child",
    ),
    false,
  );
  assertEquals(
    plan.items.find((item) => item.assetId === "tool.rust-checker")?.action,
    "replace",
  );
});

Deno.test("directory asset accepts old nested framework file membership", async () => {
  // Goal: allow legitimate nested Rust checker files to migrate without parent directory conflicts.
  // Scope: unit, planner compatibility path through real source snapshot.
  // Semantics: parent directories required by old framework files are covered by the directory asset.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets = old.install.assets.filter(
    (asset) => asset.id !== "tool.rust-checker",
  );
  old.install.assets.push({
    id: "tool.rust-checker-rule-use-alias",
    source: ".github/skills/rust-engineering/checker/src/rules/use_alias.rs",
    target: ".github/skills/rust-engineering/checker/src/rules/use_alias.rs",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.mkdir(
    join(target, ".github/skills/rust-engineering/checker/src/rules"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(
      target,
      ".github/skills/rust-engineering/checker/src/rules/use_alias.rs",
    ),
    "old framework rule\n",
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(
    plan.items.some(
      (item) => item.diagnostic.code === "directory-unknown-child",
    ),
    false,
  );
  assertEquals(
    plan.items.find((item) => item.assetId === "tool.rust-checker")
      ?.action,
    "replace",
  );
});

Deno.test("directory asset accepts old docs checker script membership", async () => {
  // Goal: allow doc-validation scripts to migrate from per-file assets without tombstones.
  // Scope: unit, planner compatibility path through real source snapshot.
  // Semantics: old framework-owned docs checker files are covered by the scripts directory asset.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets = old.install.assets.filter(
    (asset) => asset.id !== "tool.docs-scripts",
  );
  old.install.assets.push({
    id: "tool.docs-cli",
    source: ".github/skills/doc-validation/scripts/check-docs.ts",
    target: ".github/skills/doc-validation/scripts/check-docs.ts",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.mkdir(
    join(target, ".github/skills/doc-validation/scripts"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/doc-validation/scripts/check-docs.ts"),
    "old framework docs checker\n",
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(
    plan.items.some(
      (item) => item.diagnostic.code === "retirement-tombstone-missing",
    ),
    false,
  );
  assertEquals(
    plan.items.find((item) => item.assetId === "tool.docs-scripts")?.action,
    "replace",
  );
});

Deno.test("directory asset rejects unknown child during file migration", async () => {
  // Goal: prevent a directory migration from silently deleting user-created files.
  // Scope: unit, planner compatibility boundary through real source snapshot.
  // Semantics: an extra child without old framework membership blocks the plan.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets = old.install.assets.filter(
    (asset) => asset.id !== "tool.rust-checker",
  );
  old.install.assets.push({
    id: "tool.rust-checker-lib",
    source: ".github/skills/rust-engineering/checker/src/lib.rs",
    target: ".github/skills/rust-engineering/checker/src/lib.rs",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.mkdir(
    join(target, ".github/skills/rust-engineering/checker/src"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/rust-engineering/checker/src/lib.rs"),
    "old framework lib\n",
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/rust-engineering/checker/src/local.rs"),
    "user local\n",
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(
    plan.items.some(
      (item) => item.diagnostic.code === "directory-unknown-child",
    ),
    true,
  );
});

Deno.test("directory asset rejects unknown empty directory during migration", async () => {
  // Goal: prevent migration from silently adopting empty directories outside old membership.
  // Scope: unit, planner compatibility boundary through real source snapshot.
  // Semantics: an empty child directory blocks before manifest-last can commit ownership.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets = old.install.assets.filter(
    (asset) => asset.id !== "tool.rust-checker",
  );
  old.install.assets.push({
    id: "tool.rust-checker-lib",
    source: ".github/skills/rust-engineering/checker/src/lib.rs",
    target: ".github/skills/rust-engineering/checker/src/lib.rs",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  await Deno.mkdir(
    join(target, ".github/skills/rust-engineering/checker/src/local"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(target, ".github/skills/rust-engineering/checker/src/lib.rs"),
    "old framework lib\n",
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(
    plan.items.some(
      (item) =>
        item.diagnostic.code === "directory-unknown-child" &&
        item.target.endsWith("/local"),
    ),
    true,
  );
});

Deno.test("directory asset rejects old project slot child path", async () => {
  // Goal: keep project fact slots outside framework directory ownership.
  // Scope: unit, planner target-manifest compatibility check.
  // Semantics: a slot under the new directory target blocks planning.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const old = structuredClone(snapshot.manifest);
  old.install.assets = old.install.assets.filter(
    (asset) => asset.id !== "tool.rust-checker",
  );
  old.install.assets.push({
    id: "tool.rust-checker-lib",
    source: ".github/skills/rust-engineering/checker/src/lib.rs",
    target: ".github/skills/rust-engineering/checker/src/lib.rs",
    kind: "tool",
    ownership: "framework",
    update: "replace",
    retire: "delete",
  });
  old.projectFacts.push({
    id: "project.rust-local",
    paths: [".github/skills/rust-engineering/checker/src/local.rs"],
    required: false,
  });
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify(old),
  );
  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(
    plan.items.some(
      (item) => item.diagnostic.code === "project-slot-reclassified",
    ),
    true,
  );
});
