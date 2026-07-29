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
      item.action === "delete" ||
      item.action === "retire-directory",
  );
  assertEquals(mutable.at(-1)?.target, ".ousia/framework.json");
});

Deno.test("supported checker predecessor produces typed retirement evidence", async () => {
  // Goal: authorize the only supported checker generation with target and survivor evidence.
  // Scope: contract, planner boundary using the frozen 3b7d447 manifest bytes.
  // Semantics: matching membership, manifest digest, managed tree and survivor produce retire-directory.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const predecessor = await Deno.readFile(
    join(
      projectFixture.repoRoot,
      "fixtures/predecessor-framework-3b7d447.json",
    ),
  );
  assertEquals(
    await digest.sha256(predecessor),
    "e09e3ab5ff5aa1321d69aafa6587773142c2043c1aa30c9e54622a14879016dd",
  );
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeFile(join(target, ".ousia/framework.json"), predecessor);
  const checker = join(target, ".github/skills/rust-engineering/checker");
  await Deno.mkdir(join(checker, "target/debug"), { recursive: true });
  await Deno.writeTextFile(join(checker, "managed.rs"), "managed\n");
  await Deno.writeTextFile(join(checker, "target/debug/build"), "keep\n");
  const tombstone = snapshot.manifest.install.retiredAssets.find(
    (item): item is manifest.RetiredDirectoryAsset =>
      item.id === "tool.rust-checker" && item.shape === "directory",
  )!;
  tombstone.treeSha256 = await digest.treeSha256([{
    path: "managed.rs",
    sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
  }]);

  const plan = await planner.planInstall(snapshot, target);
  const retirement = plan.items.find((item) =>
    item.action === "retire-directory"
  );
  assertEquals(plan.blocked, false);
  assertEquals(retirement?.acceptedPredecessor, {
    generation: "rust-checker-directory-v1",
    manifestSha256:
      "e09e3ab5ff5aa1321d69aafa6587773142c2043c1aa30c9e54622a14879016dd",
  });
  assertEquals(
    retirement?.survivors.map((item) => ({
      relativePath: item.relativePath,
      shape: item.shape,
      sha256: item.sha256,
    })),
    [{
      relativePath: "target",
      shape: "directory",
      sha256: await digest.treeSha256([{
        path: "debug/build",
        sha256: await digest.sha256(new TextEncoder().encode("keep\n")),
      }]),
    }],
  );
});

Deno.test("checker tombstone predecessor digest mismatch blocks retirement", async () => {
  // Goal: make the source tombstone digest part of the predecessor authorization chain.
  // Scope: contract, planner supported-generation retirement authority.
  // Semantics: a mismatched tombstone blocks before any mutable retirement item is accepted.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const predecessor = await Deno.readFile(
    join(
      projectFixture.repoRoot,
      "fixtures/predecessor-framework-3b7d447.json",
    ),
  );
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeFile(join(target, ".ousia/framework.json"), predecessor);
  const checker = join(target, ".github/skills/rust-engineering/checker");
  await Deno.mkdir(checker, { recursive: true });
  await Deno.writeTextFile(join(checker, "managed.rs"), "managed\n");
  const tombstone = snapshot.manifest.install.retiredAssets.find(
    (item): item is manifest.RetiredDirectoryAsset =>
      item.id === "tool.rust-checker" && item.shape === "directory",
  )!;
  tombstone.treeSha256 = await digest.treeSha256([{
    path: "managed.rs",
    sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
  }]);
  tombstone.previousManifestSha256 = "a".repeat(64);

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(
    plan.items.find((item) => item.assetId === "tool.rust-checker")?.diagnostic
      .code,
    "retirement-conflict",
  );
});

Deno.test("unsupported checker generation has a stable blocked diagnostic", async () => {
  // Goal: reject old checker generations without introducing a general schema adapter.
  // Scope: contract, planner target-generation classifier.
  // Semantics: non-cohort 1.0 bytes return the stable upgrade code and no retirement action.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const predecessor = JSON.parse(
    await Deno.readTextFile(
      join(
        projectFixture.repoRoot,
        "fixtures/predecessor-framework-3b7d447.json",
      ),
    ),
  );
  predecessor.workflow.version = "0.9.0";
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    `${JSON.stringify(predecessor, null, 2)}\n`,
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(
    plan.items[0].diagnostic.code,
    "unsupported-rust-checker-upgrade-generation",
  );
  assertEquals(
    plan.items.some((item) => item.action === "retire-directory"),
    false,
  );
});

Deno.test("malformed schema 1.0 remains an invalid target manifest", async () => {
  // Goal: reserve two-hop remediation for structurally valid unsupported generations.
  // Scope: contract, planner target-manifest classifier.
  // Semantics: a damaged 1.0 container reports invalid instead of pretending to be upgradeable.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      workflow: { id: "ousia-workflow", version: "1.0.0" },
    }),
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(plan.items[0].diagnostic.code, "target-manifest-invalid");
});

Deno.test("schema 1.0 without checker membership remains invalid", async () => {
  // Goal: avoid prescribing a checker two-hop upgrade when no checker generation is evidenced.
  // Scope: contract, planner target-manifest classifier with a complete outer container.
  // Semantics: a 1.0 manifest without checker membership reports invalid, not unsupported checker generation.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const predecessor = JSON.parse(
    await Deno.readTextFile(
      join(
        projectFixture.repoRoot,
        "fixtures/predecessor-framework-3b7d447.json",
      ),
    ),
  );
  predecessor.install.assets = predecessor.install.assets.filter(
    (asset: { id: string }) => asset.id !== "tool.rust-checker",
  );
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeTextFile(
    join(target, ".ousia/framework.json"),
    `${JSON.stringify(predecessor, null, 2)}\n`,
  );

  const plan = await planner.planInstall(snapshot, target);
  assertEquals(plan.blocked, true);
  assertEquals(plan.items[0].diagnostic.code, "target-manifest-invalid");
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
