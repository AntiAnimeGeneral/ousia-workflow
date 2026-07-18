import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import * as applier from "../src/applier.ts";
import * as digest from "../src/digest.ts";
import type { InstallPlan } from "../src/planner.ts";
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
    const { source, plan } = fixture(root, [
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
    const { source, plan } = fixture(root, [
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
    const { source, plan } = fixture(root, [
      { target: "new.md", content: "new\n" },
    ]);
    const error = await assertRejects(
      () =>
        applier.applyInstallPlan(source, plan, {
          beforeMutation: async ({ staging }) => {
            await Deno.remove(staging);
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
    const { source, plan } = fixture(root, [
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
            await Deno.remove(staging);
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
    const { source, plan } = fixture(root, [
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
    const { source, plan } = fixture(root, [
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

Deno.test("blocked plan fails before every mutation", async () => {
  // Goal: prevent direct applier callers from bypassing planner conflicts.
  // Scope: integration, public applier boundary with a mixed blocked plan.
  // Semantics: conflict rejects before staging and leaves every target absent.
  const root = await projectFixture.makeTempProject();
  const { source, plan } = fixture(root, [
    { target: "new.md", content: "new\n" },
  ]);
  plan.blocked = true;
  plan.items.push({
    assetId: "conflict",
    source: null,
    target: "blocked.md",
    ownership: "framework",
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

function fixture(
  root: string,
  assets: {
    target: string;
    content: string;
    action?: "create" | "replace" | "delete";
    targetSha256?: string;
  }[],
): { source: SourceSnapshot; plan: InstallPlan } {
  const encoder = new TextEncoder();
  const sourceAssets = assets.filter((entry) => entry.action !== "delete").map((
    entry,
    index,
  ) => ({
    id: `asset.${index}`,
    source: entry.target,
    target: entry.target,
    kind: "tool" as const,
    ownership: "framework" as const,
    update: "replace" as const,
    retire: "delete" as const,
    content: encoder.encode(entry.content),
    sha256: "source",
  }));
  return {
    source: {
      root,
      manifest: {} as SourceSnapshot["manifest"],
      assets: sourceAssets,
    },
    plan: {
      targetRoot: root,
      blocked: false,
      items: assets.map((entry, index) => {
        const asset = sourceAssets.find((item) => item.target === entry.target);
        return {
          assetId: asset?.id ?? `retired.${index}`,
          source: asset?.source ?? null,
          target: entry.target,
          ownership: "framework",
          action: entry.action ?? "create",
          precondition: entry.action === "replace" || entry.action === "delete"
            ? { kind: "digest" as const, sha256: entry.targetSha256! }
            : { kind: "missing" as const },
          sourceSha256: asset?.sha256 ?? null,
          diagnostic: {
            phase: "plan",
            code: "test",
            severity: "info",
            relativePath: entry.target,
            message: "test",
            remediation: null,
          },
        };
      }),
    },
  };
}
