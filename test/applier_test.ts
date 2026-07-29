import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import * as applier from "../src/applier.ts";
import * as digest from "../src/digest.ts";
import * as manifest from "../src/manifest.ts";
import * as planner from "../src/planner.ts";
import type { InstallPlan } from "../src/planner.ts";
import * as source from "../src/source.ts";
import type { SourceSnapshot } from "../src/source.ts";
import * as fileProbe from "./file-probe.ts";
import * as projectFixture from "./project-fixture.ts";

Deno.test(
  "applier rejects a symlink parent without writing outside root",
  async () => {
    // Goal: prevent install writes from escaping through a symlink ancestor.
    // Scope: integration, public applier boundary.
    // Semantics: the stable error is returned and the outside path remains absent.
    const root = await projectFixture.makeTempProject();
    const outside = await Deno.makeTempDir();
    await Deno.symlink(outside, join(root, "linked"));
    const { source, plan } = await fixture(root, [
      {
        target: "linked/file.md",
        content: "new\n",
      },
    ]);
    const error = await assertRejects(
      () => applier.applyInstallPlan(source, plan),
      applier.ApplyError,
    );
    assertEquals(error.diagnostic.code, "apply-parent-blocked");
    assertEquals(await fileProbe.exists(join(outside, "file.md")), false);
  },
);

Deno.test(
  "replace and delete are rolled back when a later mutation fails",
  async () => {
    // Goal: prove backup journal restores both replacement and retirement.
    // Scope: integration, public applier boundary with deterministic fault injection.
    // Semantics: after failure, original bytes are restored and staging is removed.
    const root = await projectFixture.makeTempProject();
    await Deno.writeTextFile(join(root, "replace.md"), "old replace\n");
    await Deno.writeTextFile(join(root, "delete.md"), "old delete\n");
    const replaceDigest = await digest.sha256(
      new TextEncoder().encode("old replace\n"),
    );
    const deleteDigest = await digest.sha256(
      new TextEncoder().encode("old delete\n"),
    );
    const { source, plan } = await fixture(root, [
      {
        target: "replace.md",
        content: "new replace\n",
        action: "replace",
        targetSha256: replaceDigest,
      },
      {
        target: "delete.md",
        content: "",
        action: "delete",
        targetSha256: deleteDigest,
      },
      { target: "later.md", content: "later\n" },
    ]);
    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeMutation: ({ index }) => {
            if (index === 2) throw new Error("injected failure");
          },
        }),
      applier.ApplyError,
    );
    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readTextFile(join(root, "replace.md")),
      "old replace\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "delete.md")),
      "old delete\n",
    );
    assertEquals(await fileProbe.exists(join(root, "later.md")), false);
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "staging identity replacement enters recovery-required without target mutation",
  async () => {
    // Goal: reject writes after the transaction-owned staging namespace changes.
    // Scope: integration, applier staging identity guard.
    // Semantics: target remains missing and the unknown staging replacement is preserved.
    const root = await projectFixture.makeTempProject();
    const { source, plan } = await fixture(root, [
      { target: "new.md", content: "new\n" },
    ]);
    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeMutation: async ({ staging }) => {
            await Deno.remove(staging, { recursive: true });
            await Deno.mkdir(staging);
            await Deno.writeTextFile(join(staging, "unknown"), "keep\n");
          },
        }),
      applier.ApplyError,
    );
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(await fileProbe.exists(join(root, "new.md")), false);
    assertEquals(
      await Deno.readTextFile(join(root, ".ousia-install-staging/unknown")),
      "keep\n",
    );
  },
);

Deno.test(
  "delete does not move a target after staging identity replacement",
  async () => {
    // Goal: protect retirement from writing through a replaced staging namespace.
    // Scope: integration, delete branch with deterministic staging fault injection.
    // Semantics: original target bytes remain and foreign staging content is preserved.
    const root = await projectFixture.makeTempProject();
    const original = "delete-original\n";
    await Deno.writeTextFile(join(root, "delete.md"), original);
    const originalDigest = await digest.sha256(
      new TextEncoder().encode(original),
    );
    const { source, plan } = await fixture(root, [
      {
        target: "delete.md",
        content: "",
        action: "delete",
        targetSha256: originalDigest,
      },
    ]);
    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeMutation: async ({ staging }) => {
            await Deno.remove(staging, { recursive: true });
            await Deno.mkdir(staging);
            await Deno.writeTextFile(join(staging, "foreign"), "keep\n");
          },
        }),
      applier.ApplyError,
    );
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(join(root, "delete.md")),
      original,
    );
    assertEquals(
      await Deno.readTextFile(join(root, ".ousia-install-staging/foreign")),
      "keep\n",
    );
  },
);

Deno.test(
  "failed create rolls back files and newly-created directories",
  async () => {
    // Goal: remove partial files and directories after a later create failure.
    // Scope: integration, public applier create/rollback path.
    // Semantics: preexisting bytes remain and all transaction-owned objects disappear.
    const root = await projectFixture.makeTempProject();
    await Deno.writeTextFile(join(root, "blocked"), "file\n");
    const { source, plan } = await fixture(root, [
      { target: "new/deep/first.md", content: "first\n" },
      { target: "blocked/second.md", content: "second\n" },
    ]);
    await assertRejects(
      () => applier.applyInstallPlan(source, plan),
      applier.ApplyError,
    );
    assertEquals(await fileProbe.exists(join(root, "new")), false);
    assertEquals(await Deno.readTextFile(join(root, "blocked")), "file\n");
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "source-plan mismatch fails before staging or target mutation",
  async () => {
    // Goal: reject a plan that no longer matches its source snapshot.
    // Scope: integration, applier global preflight.
    // Semantics: mismatch fails before staging creation or target mutation.
    const root = await projectFixture.makeTempProject();
    const { source, plan } = await fixture(root, [
      {
        target: "new/file.md",
        content: "new\n",
      },
    ]);
    plan.items[0].sourceSha256 = "different";
    const error = await assertRejects(
      () => applier.applyInstallPlan(source, plan),
      applier.ApplyError,
    );
    assertEquals(error.diagnostic.code, "apply-source-plan-mismatch");
    assertEquals(await fileProbe.exists(join(root, "new")), false);
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "source mutation hook cannot rewrite authoritative staged bytes",
  async () => {
    // Goal: freeze source content before mutation hooks can influence staging.
    // Scope: integration, public applier source-to-staging boundary.
    // Semantics: hook-side source mutation cannot change committed bytes and leaves no staging residue.
    const root = await projectFixture.makeTempProject();
    const { source, plan } = await fixture(root, [
      { target: "new/file.md", content: "new\n" },
      {
        target: "new/tree",
        content: "tree\n",
        shape: "directory",
      },
    ]);
    await applier.applyInstallPlan(source, plan, {
      beforeMutation: () => {
        source.assets[0].content = new TextEncoder().encode("mutated\n");
        source.assets[1].tree![0].content = new TextEncoder().encode(
          "mutated tree\n",
        );
      },
    });
    assertEquals(await Deno.readTextFile(join(root, "new/file.md")), "new\n");
    assertEquals(
      await Deno.readTextFile(join(root, "new/tree/lib.rs")),
      "tree\n",
    );
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test("blocked plan fails before every mutation", async () => {
  // Goal: prevent direct applier callers from bypassing planner conflicts.
  // Scope: integration, public applier boundary with a mixed blocked plan.
  // Semantics: conflict rejects before staging and leaves every target absent.
  const root = await projectFixture.makeTempProject();
  const { source, plan } = await fixture(root, [
    { target: "new.md", content: "new\n" },
  ]);
  plan.blocked = true;
  plan.items.push({
    assetId: "conflict",
    source: null,
    target: "blocked.md",
    ownership: "framework" as const,
    action: "conflict",
    precondition: null,
    sourceSha256: null,
    diagnostic: {
      phase: "plan",
      code: "test-conflict",
      severity: "error",
      relativePath: "blocked.md",
      message: "test conflict",
      remediation: "resolve test conflict",
    },
  });

  const error = await assertRejects(
    () => applier.applyInstallPlan(source, plan),
    applier.ApplyError,
  );
  assertEquals(error.diagnostic.code, "apply-plan-blocked");
  assertEquals(await fileProbe.exists(join(root, "new.md")), false);
  assertEquals(
    await fileProbe.exists(join(root, ".ousia-install-staging")),
    false,
  );
});

Deno.test("directory replace rolls back when a later mutation fails", async () => {
  // Goal: prove directory asset rollback restores the full old tree.
  // Scope: integration, public applier boundary with directory mutation.
  // Semantics: after failure, old directory bytes return and later create is absent.
  const root = await projectFixture.makeTempProject();
  await Deno.mkdir(join(root, "tool/src"), { recursive: true });
  await Deno.writeTextFile(join(root, "tool/src/old.rs"), "old\n");
  const oldDigest = await digest.treeSha256([
    {
      path: "old.rs",
      sha256: await digest.sha256(new TextEncoder().encode("old\n")),
    },
  ]);
  const { source, plan } = await fixture(root, [
    {
      target: "tool/src",
      content: "new\n",
      action: "replace",
      targetSha256: oldDigest,
      shape: "directory",
    },
    { target: "later.md", content: "later\n" },
  ]);
  const error = await assertRejects(
    () =>
      applier.applyInstallPlan(source, plan, {
        beforeMutation: ({ index }) => {
          if (index === 1) throw new Error("injected failure");
        },
      }),
    applier.ApplyError,
  );
  assertEquals(error.diagnostic.code, "apply-commit-failed");
  assertEquals(await Deno.readTextFile(join(root, "tool/src/old.rs")), "old\n");
  assertEquals(await fileProbe.exists(join(root, "tool/src/lib.rs")), false);
  assertEquals(await fileProbe.exists(join(root, "later.md")), false);
});

Deno.test("directory replace preserves excluded children", async () => {
  // Goal: keep build outputs outside directory asset ownership during replace.
  // Scope: integration, public applier boundary with directory exclude.
  // Semantics: owned files are replaced while excluded children remain in place.
  const root = await projectFixture.makeTempProject();
  await Deno.mkdir(join(root, "tool/target/debug"), { recursive: true });
  await Deno.writeTextFile(join(root, "tool/old.rs"), "old\n");
  await Deno.writeTextFile(join(root, "tool/target/debug/build"), "keep\n");
  const oldDigest = await digest.treeSha256([
    {
      path: "old.rs",
      sha256: await digest.sha256(new TextEncoder().encode("old\n")),
    },
  ]);
  const { source, plan } = await fixture(root, [
    {
      target: "tool",
      content: "new\n",
      action: "replace",
      targetSha256: oldDigest,
      shape: "directory",
      exclude: ["target"],
    },
  ]);

  const result = await applier.applyInstallPlan(source, plan);

  assertEquals(result.written, ["tool"]);
  assertEquals(await fileProbe.exists(join(root, "tool/old.rs")), false);
  assertEquals(await Deno.readTextFile(join(root, "tool/lib.rs")), "new\n");
  assertEquals(
    await Deno.readTextFile(join(root, "tool/target/debug/build")),
    "keep\n",
  );
});

Deno.test("directory replace rollback preserves excluded children", async () => {
  // Goal: keep excluded build outputs through rollback after a later failure.
  // Scope: integration, public applier boundary with directory exclude and rollback.
  // Semantics: original owned tree and excluded children both survive failure.
  const root = await projectFixture.makeTempProject();
  await Deno.mkdir(join(root, "tool/target/debug"), { recursive: true });
  await Deno.writeTextFile(join(root, "tool/old.rs"), "old\n");
  await Deno.writeTextFile(join(root, "tool/target/debug/build"), "keep\n");
  const oldDigest = await digest.treeSha256([
    {
      path: "old.rs",
      sha256: await digest.sha256(new TextEncoder().encode("old\n")),
    },
  ]);
  const { source, plan } = await fixture(root, [
    {
      target: "tool",
      content: "new\n",
      action: "replace",
      targetSha256: oldDigest,
      shape: "directory",
      exclude: ["target"],
    },
    { target: "later.md", content: "later\n" },
  ]);

  const error = await assertRejects(
    () =>
      applier.applyInstallPlan(source, plan, {
        beforeMutation: ({ index }) => {
          if (index === 1) throw new Error("injected failure");
        },
      }),
    applier.ApplyError,
  );

  assertEquals(error.diagnostic.code, "apply-commit-failed");
  assertEquals(await Deno.readTextFile(join(root, "tool/old.rs")), "old\n");
  assertEquals(await fileProbe.exists(join(root, "tool/lib.rs")), false);
  assertEquals(
    await Deno.readTextFile(join(root, "tool/target/debug/build")),
    "keep\n",
  );
  assertEquals(await fileProbe.exists(join(root, "later.md")), false);
});

Deno.test("directory retirement preserves excluded survivors", async () => {
  // Goal: retire framework-managed checker source without deleting its excluded Cargo output.
  // Scope: integration, public applier retire-directory boundary.
  // Semantics: managed files disappear, the excluded target tree survives, and staging is cleaned.
  const root = await projectFixture.makeTempProject();
  await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
  await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
  await Deno.writeTextFile(join(root, "checker/target/debug/build"), "keep\n");
  const managedDigest = await digest.treeSha256([{
    path: "src.rs",
    sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
  }]);
  const { source, plan } = await fixture(root, [{
    target: "checker",
    content: "",
    action: "retire-directory",
    targetSha256: managedDigest,
    shape: "directory",
    exclude: ["target"],
  }]);

  const result = await applier.applyInstallPlan(source, plan);

  assertEquals(result.deleted, ["checker"]);
  assertEquals(await fileProbe.exists(join(root, "checker/src.rs")), false);
  assertEquals(
    await Deno.readTextFile(join(root, "checker/target/debug/build")),
    "keep\n",
  );
  assertEquals(
    await fileProbe.exists(join(root, ".ousia-install-staging")),
    false,
  );
});

Deno.test("directory retirement rollback restores managed and excluded trees", async () => {
  // Goal: preserve the complete pre-retirement directory when a later host mutation fails.
  // Scope: integration, retire-directory followed by injected failure.
  // Semantics: both managed source and excluded output return byte-for-byte and later create is absent.
  const root = await projectFixture.makeTempProject();
  await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
  await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
  await Deno.writeTextFile(join(root, "checker/target/debug/build"), "keep\n");
  const managedDigest = await digest.treeSha256([{
    path: "src.rs",
    sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
  }]);
  const { source, plan } = await fixture(root, [
    {
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    },
    { target: "later.md", content: "later\n" },
  ]);

  const error = await assertRejects(
    () =>
      applier.applyInstallPlan(source, plan, {
        beforeMutation: ({ index }) => {
          if (index === 1) throw new Error("injected failure");
        },
      }),
    applier.ApplyError,
  );

  assertEquals(error.diagnostic.code, "apply-commit-failed");
  assertEquals(
    await Deno.readTextFile(join(root, "checker/src.rs")),
    "managed\n",
  );
  assertEquals(
    await Deno.readTextFile(join(root, "checker/target/debug/build")),
    "keep\n",
  );
  assertEquals(await fileProbe.exists(join(root, "later.md")), false);
});

Deno.test(
  "directory retirement compensates survivor rename when journal commit fails",
  async () => {
    // Goal: prevent excluded survivor loss between its rename and location journal commit.
    // Scope: integration, public applier retirement boundary with C2 fault injection.
    // Semantics: the old managed and excluded trees return byte-for-byte and staging is removed.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementRecordCommit: () => {
            throw new Error("injected survivor journal failure");
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement compensates C1 when BackedUp record commit fails",
  async () => {
    // Goal: restore the original target across the first target-to-backup rename and journal transition.
    // Scope: integration, C1 Preflighted-to-BackedUp adjacent failure through the public applier boundary.
    // Semantics: compensation restores managed and excluded bytes and removes the transaction staging namespace.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementBackedUpRecordCommit: () => {
            throw new Error("injected C1 record failure");
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement preserves C1 evidence when compensation is unprovable",
  async () => {
    // Goal: keep the Preflighted journal and backup bytes when C1 adjacent compensation cannot be proven.
    // Scope: integration, C1 backup mutation before BackedUp record commit.
    // Semantics: recovery-required preserves the changed backup and sealed Preflighted journal without recreating target.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementBackedUpRecordCommit: async ({ backup }) => {
            await Deno.writeTextFile(join(backup, "src.rs"), "changed\n");
            throw new Error("injected C1 record failure");
          },
        }),
      applier.ApplyError,
    );

    const staging = join(root, ".ousia-install-staging");
    const journal = JSON.parse(
      await Deno.readTextFile(join(staging, "journal/retirement-0.json")),
    );
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(await fileProbe.exists(join(root, "checker")), false);
    assertEquals(
      await Deno.readTextFile(join(staging, "backup/checker/src.rs")),
      "changed\n",
    );
    assertEquals(journal.state, "Preflighted");
  },
);

Deno.test(
  "directory retirement preserves recovery evidence when survivor compensation fails",
  async () => {
    // Goal: preserve recoverable survivor evidence when C2 location compensation cannot complete.
    // Scope: integration, public applier recovery-required boundary with two adjacent faults.
    // Semantics: generic cleanup does not run and the excluded bytes remain in guarded staging.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementRecordCommit: () => {
            throw new Error("injected survivor journal failure");
          },
          beforeRetirementCompensation: () => {
            throw new Error("injected survivor compensation failure");
          },
        }),
      applier.ApplyError,
    );

    const staging = join(root, ".ousia-install-staging");
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(await fileProbe.exists(staging), true);
    assertEquals(
      await Deno.readTextFile(
        join(staging, "survivor/checker/target/debug/build"),
      ),
      "keep\n",
    );
    assertEquals(
      await Deno.readTextFile(join(staging, "backup/checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await fileProbe.exists(join(staging, "journal/retirement-0.json")),
      true,
    );
  },
);

Deno.test(
  "directory retirement restores earlier survivors when a later journal commit fails",
  async () => {
    // Goal: keep every excluded root when a later C2 location commit fails.
    // Scope: integration, multi-survivor retirement through the public applier boundary.
    // Semantics: earlier committed and current compensated survivors both return before rollback cleanup.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.mkdir(join(root, "checker/cache"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "target\n",
    );
    await Deno.writeTextFile(join(root, "checker/cache/state"), "cache\n");
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target", "cache"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementRecordCommit: ({ relativePath }) => {
            if (relativePath === "cache") {
              throw new Error("injected second survivor journal failure");
            }
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "target\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "checker/cache/state")),
      "cache\n",
    );
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement preserves staged survivor when restore journal commit fails",
  async () => {
    // Goal: keep journal and survivor location aligned when reverse C2 location commit fails.
    // Scope: integration, multi-survivor recovery through the public applier boundary.
    // Semantics: the failed reverse commit is compensated back to staging and generic cleanup never runs.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.mkdir(join(root, "checker/cache"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "target\n",
    );
    await Deno.writeTextFile(join(root, "checker/cache/state"), "cache\n");
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target", "cache"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementRecordCommit: ({ relativePath }) => {
            if (relativePath === "cache") {
              throw new Error("injected second survivor journal failure");
            }
          },
          beforeRetirementRestoreRecordCommit: ({ relativePath }) => {
            if (relativePath === "target") {
              throw new Error("injected restore journal failure");
            }
          },
        }),
      applier.ApplyError,
    );

    const staging = join(root, ".ousia-install-staging");
    const journal = JSON.parse(
      await Deno.readTextFile(join(staging, "journal/retirement-0.json")),
    );
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(
        join(staging, "survivor/checker/target/debug/build"),
      ),
      "target\n",
    );
    assertEquals(
      await Deno.readTextFile(join(staging, "backup/checker/cache/state")),
      "cache\n",
    );
    assertEquals(journal.survivors, [
      {
        relativePath: "target",
        shape: "directory",
        identity: journal.survivors[0].identity,
        sha256: journal.survivors[0].sha256,
        location: "SurvivorStaging",
      },
      {
        relativePath: "cache",
        shape: "directory",
        identity: journal.survivors[1].identity,
        sha256: journal.survivors[1].sha256,
        location: "Backup",
      },
    ]);
  },
);

Deno.test(
  "directory retirement rolls back a committed survivor container",
  async () => {
    // Goal: restore the complete predecessor after C3 commits survivors and a later mutation fails.
    // Scope: integration, committed retirement container through the public applier boundary.
    // Semantics: managed and excluded bytes return under the original target and staging disappears.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [
      {
        target: "checker",
        content: "",
        action: "retire-directory",
        targetSha256: managedDigest,
        shape: "directory",
        exclude: ["target"],
      },
      { target: "later.md", content: "later\n" },
    ]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeMutation: ({ index }) => {
            if (index === 1) throw new Error("injected later failure");
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement compensates C3 when its journal commit fails",
  async () => {
    // Goal: keep the predecessor tree recoverable across the C3 rename-to-record boundary.
    // Scope: integration, survivor-container commit with deterministic journal failure.
    // Semantics: adjacent compensation returns the container to staging, rollback restores all bytes, and staging disappears.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          afterRetirementContainerCommit: () => {
            throw new Error("injected C3 journal failure");
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement preserves C3 evidence when compensation is unprovable",
  async () => {
    // Goal: prevent rollback or cleanup when the C3 target changes before adjacent compensation.
    // Scope: integration, committed survivor-container identity failure through the public applier boundary.
    // Semantics: recovery-required preserves the changed target, managed backup, and sealed pre-C3 journal.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          afterRetirementContainerCommit: async ({ target }) => {
            await Deno.writeTextFile(
              join(target, "target/debug/build"),
              "changed\n",
            );
            throw new Error("injected C3 journal failure");
          },
        }),
      applier.ApplyError,
    );

    const staging = join(root, ".ousia-install-staging");
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "changed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(staging, "backup/checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await fileProbe.exists(join(staging, "journal/retirement-0.json")),
      true,
    );
  },
);

Deno.test(
  "directory retirement without survivors rolls back after later failure",
  async () => {
    // Goal: restore a fully retired managed directory when no survivor container remains.
    // Scope: integration, TargetAbsent retirement state followed by a later mutation failure.
    // Semantics: the managed tree returns and rollback removes the transaction staging namespace.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker"));
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [
      {
        target: "checker",
        content: "",
        action: "retire-directory",
        targetSha256: managedDigest,
        shape: "directory",
        exclude: [],
      },
      { target: "later.md", content: "later\n" },
    ]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeMutation: ({ index }) => {
            if (index === 1) throw new Error("injected later failure");
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/src.rs")),
      "managed\n",
    );
    assertEquals(
      await fileProbe.exists(join(root, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement rejects a mutated sealed journal before cleanup",
  async () => {
    // Goal: make C5 consume the validated disk journal rather than mutable in-memory retirement state.
    // Scope: contract, sealed retirement journal readback at the cleanup boundary.
    // Semantics: invalid schema yields recovery-required and preserves committed survivor plus managed backup.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementCleanup: async ({ journal }) => {
            const value = JSON.parse(await Deno.readTextFile(journal));
            value.schema = "unknown";
            await Deno.writeTextFile(journal, `${JSON.stringify(value)}\n`);
          },
        }),
      applier.ApplyError,
    );

    const staging = join(root, ".ousia-install-staging");
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await Deno.readTextFile(join(staging, "backup/checker/src.rs")),
      "managed\n",
    );
  },
);

Deno.test(
  "directory retirement preserves unknown backup content during cleanup",
  async () => {
    // Goal: prevent C5 from recursively deleting bytes outside the authorized managed-entry set.
    // Scope: integration, retirement backup cleanup through the public applier boundary.
    // Semantics: cleanup returns recovery-required and preserves the injected unknown bytes in staging.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker"));
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: [],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementCleanup: async ({ backup }) => {
            await Deno.writeTextFile(join(backup, "unknown"), "keep\n");
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(
        join(root, ".ousia-install-staging/backup/checker/unknown"),
      ),
      "keep\n",
    );
  },
);

Deno.test(
  "directory retirement blocks cleanup after survivor target mutation",
  async () => {
    // Goal: keep retirement evidence when the committed survivor target changes before C5.
    // Scope: integration, committed target verification through the public applier boundary.
    // Semantics: cleanup returns recovery-required and leaves managed backup plus changed target intact.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeRetirementCleanup: async ({ target }) => {
            await Deno.writeTextFile(
              join(target, "target/debug/build"),
              "changed\n",
            );
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "changed\n",
    );
    assertEquals(
      await Deno.readTextFile(
        join(root, ".ousia-install-staging/backup/checker/src.rs"),
      ),
      "managed\n",
    );
  },
);

Deno.test(
  "cleanup reports an unsealed transaction state when pending record commit fails",
  async () => {
    // Goal: avoid claiming CommittedCleanupPending authority when its sealed record cannot be committed.
    // Scope: integration, C5 verification failure plus cleanup-pending record failure.
    // Semantics: recovery-required marks transactionState unsealed and preserves new manifest, survivor, backup, and prior transaction record.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          beforeRetirementCleanup: async ({ target }) => {
            await Deno.writeTextFile(
              join(target, "target/debug/build"),
              "changed\n",
            );
          },
          beforeCleanupPendingRecordCommit: () => {
            throw new Error("injected cleanup-pending record failure");
          },
        }),
      applier.ApplyError,
    );

    const staging = join(target, ".ousia-install-staging");
    const record = JSON.parse(
      await Deno.readTextFile(join(staging, "journal/transaction.json")),
    );
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(error.diagnostic.evidence.transactionState, "unsealed");
    assertEquals(record.state, "ManifestCommitted");
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "changed\n",
    );
    assertEquals(
      await Deno.readTextFile(
        join(
          staging,
          "backup/.github/skills/rust-engineering/checker/managed.rs",
        ),
      ),
      "managed\n",
    );
  },
);

Deno.test(
  "directory retirement rejects a replaced target identity before staging",
  async () => {
    // Goal: prevent retirement after the planned directory identity is replaced with equal managed bytes.
    // Scope: integration, real planner-to-applier retirement boundary.
    // Semantics: stale identity fails before staging and the replacement target remains byte-for-byte intact.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);
    const replacement = join(target, "replacement-checker");
    await Deno.mkdir(join(replacement, "target/debug"), { recursive: true });
    await Deno.writeTextFile(join(replacement, "managed.rs"), "managed\n");
    await Deno.writeTextFile(
      join(replacement, "target/debug/build"),
      "keep\n",
    );
    await Deno.remove(checker, { recursive: true });
    await Deno.rename(replacement, checker);

    const error = await assertRejects(
      () => applier.applyInstallPlan(snapshot, plan),
      applier.ApplyError,
    );
    assertEquals(error.diagnostic.code, "apply-target-changed");
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await fileProbe.exists(join(target, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement rejects stale survivor evidence before staging",
  async () => {
    // Goal: prevent retirement after excluded survivor bytes change outside the managed tree digest.
    // Scope: integration, real planner-to-applier survivor precondition boundary.
    // Semantics: stale survivor evidence fails before staging and every target byte remains present.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);
    await Deno.writeTextFile(
      join(checker, "target/debug/build"),
      "changed\n",
    );

    const error = await assertRejects(
      () => applier.applyInstallPlan(snapshot, plan),
      applier.ApplyError,
    );
    assertEquals(error.diagnostic.code, "apply-target-changed");
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "changed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(checker, "managed.rs")),
      "managed\n",
    );
    assertEquals(
      await fileProbe.exists(join(target, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "directory retirement isolates authoritative evidence from mutation hooks",
  async () => {
    // Goal: keep planner authorization immutable after applier preflight.
    // Scope: integration, public mutation hook attempting to rewrite a retire-directory PlanItem.
    // Semantics: the hook only mutates its clone; the authorized checker retires, the forged target remains untouched, and survivor bytes persist.
    const root = await projectFixture.makeTempProject();
    await Deno.mkdir(join(root, "checker/target/debug"), { recursive: true });
    await Deno.mkdir(join(root, "forged"));
    await Deno.writeTextFile(join(root, "checker/src.rs"), "managed\n");
    await Deno.writeTextFile(
      join(root, "checker/target/debug/build"),
      "keep\n",
    );
    await Deno.writeTextFile(join(root, "forged/keep"), "forged\n");
    const managedDigest = await digest.treeSha256([{
      path: "src.rs",
      sha256: await digest.sha256(new TextEncoder().encode("managed\n")),
    }]);
    const { source, plan } = await fixture(root, [{
      target: "checker",
      content: "",
      action: "retire-directory",
      targetSha256: managedDigest,
      shape: "directory",
      exclude: ["target"],
    }]);

    await applier.applyInstallPlan(source, plan, {
      beforeMutation: ({ item }) => {
        if (item.action !== "retire-directory") return;
        item.target = "forged";
        item.precondition.sha256 = "0".repeat(64);
        item.managedEntries.length = 0;
        item.survivors.length = 0;
      },
    });

    assertEquals(await fileProbe.exists(join(root, "checker/src.rs")), false);
    assertEquals(
      await Deno.readTextFile(join(root, "checker/target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "forged/keep")),
      "forged\n",
    );
  },
);

Deno.test(
  "manifest pending with old disk state rolls back directory retirement",
  async () => {
    // Goal: allow pre-C4 rollback only when the sealed record and disk still prove the old manifest.
    // Scope: integration, transaction-wide manifest commit boundary with retirement state.
    // Semantics: the predecessor manifest and complete checker tree return and staging disappears.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);
    const oldManifest = await Deno.readFile(
      join(target, manifest.FRAMEWORK_MANIFEST_PATH),
    );

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          beforeManifestTargetCommit: () => {
            throw new Error("injected pre-manifest failure");
          },
        }),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-commit-failed");
    assertEquals(
      await Deno.readFile(join(target, manifest.FRAMEWORK_MANIFEST_PATH)),
      oldManifest,
    );
    assertEquals(
      await Deno.readTextFile(join(checker, "managed.rs")),
      "managed\n",
    );
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await fileProbe.exists(join(target, ".ousia-install-staging")),
      false,
    );
  },
);

Deno.test(
  "manifest rename success settles pending record as committed cleanup",
  async () => {
    // Goal: prevent rollback after the new manifest reaches disk but record advancement fails.
    // Scope: integration, C4b rename-to-record adjacent failure through the public applier boundary.
    // Semantics: new manifest and survivor remain committed while backup and a cleanup-pending record stay recoverable.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          afterManifestTargetCommit: () => {
            throw new Error("injected manifest record failure");
          },
        }),
      applier.ApplyError,
    );

    const staging = join(target, ".ousia-install-staging");
    const record = JSON.parse(
      await Deno.readTextFile(join(staging, "journal/transaction.json")),
    );
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await digest.sha256(
        await Deno.readFile(join(target, manifest.FRAMEWORK_MANIFEST_PATH)),
      ),
      snapshot.assets.find((asset) =>
        asset.target === manifest.FRAMEWORK_MANIFEST_PATH
      )!.sha256,
    );
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "keep\n",
    );
    assertEquals(await fileProbe.exists(join(checker, "managed.rs")), false);
    assertEquals(
      await Deno.readTextFile(
        join(
          staging,
          "backup/.github/skills/rust-engineering/checker/managed.rs",
        ),
      ),
      "managed\n",
    );
    assertEquals(record.state, "CommittedCleanupPending");
  },
);

Deno.test(
  "repeat install classifies committed cleanup staging from sealed authority",
  async () => {
    // Goal: distinguish an unfinished post-C4 cleanup from an unowned staging conflict on the next install.
    // Scope: contract, repeated public applier entry over a sealed CommittedCleanupPending transaction.
    // Semantics: the second call reports the committed-cleanup code and leaves manifest, survivor, backup, and journal unchanged.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);
    await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          afterManifestTargetCommit: () => {
            throw new Error("injected manifest record failure");
          },
        }),
      applier.ApplyError,
    );
    const staging = join(target, ".ousia-install-staging");
    const manifestBefore = await Deno.readFile(
      join(target, manifest.FRAMEWORK_MANIFEST_PATH),
    );
    const survivorBefore = await Deno.readFile(
      join(checker, "target/debug/build"),
    );
    const backupPath = join(
      staging,
      "backup/.github/skills/rust-engineering/checker/managed.rs",
    );
    const backupBefore = await Deno.readFile(backupPath);

    const error = await assertRejects(
      () => applier.applyInstallPlan(snapshot, plan),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-committed-cleanup-pending");
    assertEquals(
      await Deno.readFile(join(target, manifest.FRAMEWORK_MANIFEST_PATH)),
      manifestBefore,
    );
    assertEquals(
      await Deno.readFile(join(checker, "target/debug/build")),
      survivorBefore,
    );
    assertEquals(await Deno.readFile(backupPath), backupBefore);
    assertEquals(
      await fileProbe.exists(join(staging, "journal/transaction.json")),
      true,
    );
  },
);

Deno.test(
  "repeat install rejects incomplete retirement journal inventory",
  async () => {
    // Goal: avoid treating a transaction record as sealed authority when one declared retirement journal is missing.
    // Scope: contract, repeated applier entry over a damaged committed-cleanup staging inventory.
    // Semantics: the call falls back to an unverified staging conflict and preserves manifest, survivor, backup, and transaction record.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);
    await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          afterManifestTargetCommit: () => {
            throw new Error("injected manifest record failure");
          },
        }),
      applier.ApplyError,
    );
    const staging = join(target, ".ousia-install-staging");
    await Deno.remove(join(staging, "journal/retirement-0.json"));
    const backupPath = join(
      staging,
      "backup/.github/skills/rust-engineering/checker/managed.rs",
    );

    const error = await assertRejects(
      () => applier.applyInstallPlan(snapshot, plan),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-staging-conflict");
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "keep\n",
    );
    assertEquals(await Deno.readTextFile(backupPath), "managed\n");
    assertEquals(
      await fileProbe.exists(join(staging, "journal/transaction.json")),
      true,
    );
  },
);

Deno.test(
  "repeat install rejects semantically forged retirement journal",
  async () => {
    // Goal: reject schema-valid journal content that is no longer bound to the sealed transaction.
    // Scope: contract, repeated applier entry over a forged committed-cleanup journal.
    // Semantics: changed managed authority degrades to staging conflict and preserves all transaction bytes.
    const { snapshot, target } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);
    await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          afterManifestTargetCommit: () => {
            throw new Error("injected manifest record failure");
          },
        }),
      applier.ApplyError,
    );
    const staging = join(target, ".ousia-install-staging");
    const journalPath = join(staging, "journal/retirement-0.json");
    const journal = JSON.parse(await Deno.readTextFile(journalPath));
    journal.state = "TargetAbsent";
    await Deno.writeTextFile(journalPath, JSON.stringify(journal, null, 2));
    const transactionPath = join(staging, "journal/transaction.json");
    const transaction = JSON.parse(await Deno.readTextFile(transactionPath));
    transaction.retirementJournals[0].sha256 = await digest.sha256(
      await Deno.readFile(journalPath),
    );
    await Deno.writeTextFile(
      transactionPath,
      JSON.stringify(transaction, null, 2),
    );

    const error = await assertRejects(
      () => applier.applyInstallPlan(snapshot, plan),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-staging-conflict");
    assertEquals(await fileProbe.exists(journalPath), true);
    assertEquals(
      await fileProbe.exists(join(staging, "journal/transaction.json")),
      true,
    );
  },
);

Deno.test(
  "repeat install rejects transaction predecessor mismatch",
  async () => {
    // Goal: bind the transaction old manifest to every retirement predecessor authority.
    // Scope: contract, repeated applier entry over a cross-record predecessor mismatch.
    // Semantics: a schema-valid mismatched old digest degrades to staging conflict and preserves the sealed files.
    const { snapshot, target } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);
    await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          afterManifestTargetCommit: () => {
            throw new Error("injected manifest record failure");
          },
        }),
      applier.ApplyError,
    );
    const transactionPath = join(
      target,
      ".ousia-install-staging/journal/transaction.json",
    );
    const transaction = JSON.parse(await Deno.readTextFile(transactionPath));
    transaction.oldManifestSha256 = "a".repeat(64);
    await Deno.writeTextFile(
      transactionPath,
      JSON.stringify(transaction, null, 2),
    );

    const error = await assertRejects(
      () => applier.applyInstallPlan(snapshot, plan),
      applier.ApplyError,
    );

    assertEquals(error.diagnostic.code, "apply-staging-conflict");
    assertEquals(await fileProbe.exists(transactionPath), true);
  },
);

Deno.test(
  "unknown manifest disk outcome preserves retirement evidence",
  async () => {
    // Goal: forbid guessing rollback or cleanup when disk matches neither authorized manifest outcome.
    // Scope: integration, C4 disk reconciliation with post-rename manifest mutation.
    // Semantics: recovery-required preserves the changed manifest, survivor, backup, and pending record.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          afterManifestTargetCommit: async ({ target }) => {
            await Deno.writeTextFile(target, "unknown manifest\n");
            throw new Error("injected unknown disk outcome");
          },
        }),
      applier.ApplyError,
    );

    const staging = join(target, ".ousia-install-staging");
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(join(target, manifest.FRAMEWORK_MANIFEST_PATH)),
      "unknown manifest\n",
    );
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await Deno.readTextFile(
        join(
          staging,
          "backup/.github/skills/rust-engineering/checker/managed.rs",
        ),
      ),
      "managed\n",
    );
    assertEquals(
      await fileProbe.exists(join(staging, "journal/transaction.json")),
      true,
    );
  },
);

Deno.test(
  "normal C4 path reconciles an unknown manifest before cleanup",
  async () => {
    // Goal: prevent C5 when the manifest changes after commit even if the adjacent hook returns normally.
    // Scope: integration, normal C4 record advancement path with an unknown disk outcome.
    // Semantics: recovery-required preserves changed manifest, committed survivor, managed backup, and transaction record.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const plan = await planner.planInstall(snapshot, target);

    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(snapshot, plan, {
          afterManifestTargetCommit: async ({ target }) => {
            await Deno.writeTextFile(target, "unknown manifest\n");
          },
        }),
      applier.ApplyError,
    );

    const staging = join(target, ".ousia-install-staging");
    assertEquals(error.diagnostic.code, "apply-recovery-required");
    assertEquals(
      await Deno.readTextFile(join(target, manifest.FRAMEWORK_MANIFEST_PATH)),
      "unknown manifest\n",
    );
    assertEquals(
      await Deno.readTextFile(join(checker, "target/debug/build")),
      "keep\n",
    );
    assertEquals(
      await Deno.readTextFile(
        join(
          staging,
          "backup/.github/skills/rust-engineering/checker/managed.rs",
        ),
      ),
      "managed\n",
    );
    assertEquals(
      await fileProbe.exists(join(staging, "journal/transaction.json")),
      true,
    );
  },
);

Deno.test(
  "directory retirement upgrade is idempotent after current manifest commit",
  async () => {
    // Goal: keep the excluded survivor outside old tombstone authority after a successful upgrade.
    // Scope: integration, predecessor plan/apply followed by current 1.1 re-planning.
    // Semantics: the second plan has no retirement/conflict and preserves survivor bytes.
    const { snapshot, target, checker } = await predecessorRetirementFixture();
    const first = await planner.planInstall(snapshot, target);
    await applier.applyInstallPlan(snapshot, first);
    const survivorBefore = await digest.sha256(
      await Deno.readFile(join(checker, "target/debug/build")),
    );
    const manifestBefore = await digest.sha256(
      await Deno.readFile(join(target, manifest.FRAMEWORK_MANIFEST_PATH)),
    );

    const second = await planner.planInstall(snapshot, target);
    assertEquals(second.blocked, false);
    assertEquals(
      second.items.some((item) => item.action === "retire-directory"),
      false,
    );
    const secondResult = await applier.applyInstallPlan(snapshot, second);
    assertEquals(secondResult.written, []);
    assertEquals(secondResult.deleted, []);
    assertEquals(
      await fileProbe.exists(join(target, ".ousia-install-staging")),
      false,
    );
    assertEquals(
      await digest.sha256(
        await Deno.readFile(join(target, manifest.FRAMEWORK_MANIFEST_PATH)),
      ),
      manifestBefore,
    );
    assertEquals(
      await digest.sha256(
        await Deno.readFile(join(checker, "target/debug/build")),
      ),
      survivorBefore,
    );
  },
);

async function fixture(
  root: string,
  assets: {
    target: string;
    content: string;
    action?: "create" | "replace" | "delete" | "retire-directory";
    targetSha256?: string;
    shape?: "file" | "directory";
    exclude?: string[];
  }[],
): Promise<{ source: SourceSnapshot; plan: InstallPlan }> {
  const encoder = new TextEncoder();
  const sourceAssets = await Promise.all(
    assets.filter((entry) =>
      entry.action !== "delete" && entry.action !== "retire-directory"
    ).map(async (entry, index) => {
      const content = encoder.encode(entry.content);
      const contentSha256 = await digest.sha256(content);
      const tree = entry.shape === "directory"
        ? [{ path: "lib.rs", content, sha256: contentSha256 }]
        : undefined;
      return {
        id: `asset.${index}`,
        source: entry.target,
        target: entry.target,
        kind: "tool" as const,
        ownership: "framework" as const,
        update: "replace" as const,
        retire: "delete" as const,
        shape: entry.shape,
        exclude: entry.exclude,
        content: entry.shape === "directory" ? null : content,
        tree,
        sha256: tree ? await digest.treeSha256(tree) : contentSha256,
      };
    }),
  );
  return {
    source: {
      root,
      manifest: {} as SourceSnapshot["manifest"],
      assets: sourceAssets,
      runtimeRustChecker: {} as SourceSnapshot["runtimeRustChecker"],
    },
    plan: {
      targetRoot: root,
      blocked: false,
      items: await Promise.all(assets.map(
        async (entry, index): Promise<import("../src/planner.ts").PlanItem> => {
          const asset = sourceAssets.find((item) =>
            item.target === entry.target
          );
          const common = {
            assetId: asset?.id ?? `retired.${index}`,
            shape: entry.shape,
            exclude: entry.exclude,
            source: asset?.source ?? null,
            target: entry.target,
            ownership: "framework" as const,
            sourceSha256: asset?.sha256 ?? null,
            diagnostic: {
              phase: "plan" as const,
              code: "test",
              severity: "info" as const,
              relativePath: entry.target,
              message: "test",
              remediation: null,
            },
          };
          const precondition = entry.action === "replace" ||
              entry.action === "delete" ||
              entry.action === "retire-directory"
            ? {
              kind: "digest" as const,
              sha256: entry.targetSha256!,
              shape: entry.shape,
            }
            : { kind: "missing" as const };
          if (entry.action === "retire-directory") {
            const target = join(root, entry.target);
            const targetInfo = await Deno.lstat(target);
            const managedEntries = await directoryEntries(
              target,
              entry.exclude ?? [],
            );
            const survivors:
              import("../src/planner.ts").SurvivorPrecondition[] = [];
            for (const relativePath of entry.exclude ?? []) {
              const path = join(target, relativePath);
              try {
                const info = await Deno.lstat(path);
                const shape = info.isDirectory ? "directory" : "file";
                const sha256 = shape === "directory"
                  ? await directoryDigest(path)
                  : await digest.sha256(await Deno.readFile(path));
                survivors.push({
                  relativePath,
                  shape,
                  identity: fileIdentity(info),
                  sha256,
                });
              } catch (error) {
                if (
                  error instanceof Deno.errors.NotFound ||
                  error instanceof Deno.errors.NotADirectory
                ) continue;
                throw error;
              }
            }
            return {
              ...common,
              action: entry.action,
              shape: "directory",
              exclude: entry.exclude ?? [],
              precondition: {
                kind: "digest",
                sha256: entry.targetSha256!,
                shape: "directory",
              },
              acceptedPredecessor: {
                generation: "rust-checker-directory-v1",
                manifestSha256:
                  "e09e3ab5ff5aa1321d69aafa6587773142c2043c1aa30c9e54622a14879016dd",
              },
              targetIdentity: fileIdentity(targetInfo),
              managedEntries,
              survivors,
            };
          }
          return {
            ...common,
            action: entry.action ?? "create",
            precondition,
          };
        },
      )),
    },
  };
}

async function directoryDigest(root: string): Promise<string> {
  return await digest.treeSha256(await directoryEntries(root, []));
}

async function directoryEntries(
  root: string,
  exclude: string[],
): Promise<digest.TreeEntry[]> {
  const entries: digest.TreeEntry[] = [];
  async function visit(current: string): Promise<void> {
    for await (const entry of Deno.readDir(current)) {
      const path = join(current, entry.name);
      const relativePath = path.slice(root.length + 1);
      if (
        exclude.some((excluded) =>
          relativePath === excluded ||
          relativePath.startsWith(`${excluded}/`)
        )
      ) continue;
      if (entry.isDirectory) {
        await visit(path);
      } else {
        entries.push({
          path: relativePath,
          sha256: await digest.sha256(await Deno.readFile(path)),
        });
      }
    }
  }
  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function fileIdentity(
  info: Deno.FileInfo,
): import("../src/planner.ts").FilesystemIdentity {
  return {
    dev: info.dev ?? null,
    ino: info.ino ?? null,
    birthtime: info.birthtime?.getTime() ?? null,
  };
}

async function predecessorRetirementFixture(): Promise<{
  snapshot: SourceSnapshot;
  target: string;
  checker: string;
}> {
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const target = await projectFixture.makeTempProject();
  const predecessor = await Deno.readFile(
    join(
      projectFixture.repoRoot,
      "fixtures/predecessor-framework-3b7d447.json",
    ),
  );
  await Deno.mkdir(join(target, ".ousia"), { recursive: true });
  await Deno.writeFile(
    join(target, manifest.FRAMEWORK_MANIFEST_PATH),
    predecessor,
  );
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
  return { snapshot, target, checker };
}
