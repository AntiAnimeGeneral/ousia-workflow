import { assert, assertEquals, assertThrows } from "@std/assert";
import * as manifest from "../src/manifest.ts";
import type { RouteInput } from "../src/manifest.ts";
import * as source from "../src/source.ts";
import * as projectFixture from "./project-fixture.ts";

Deno.test(
  "framework manifest resolves deterministic implementation route",
  async () => {
    // Goal: protect the single static route contract.
    // Scope: unit, manifest validator/resolver through real source manifest.
    // Semantics: concern order and asset order follow manifest declarations.
    const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
    const result = manifest.resolveRoute(snapshot.manifest, {
      task: "implement",
      concerns: ["testing", "engineering"],
      paths: [],
    });
    assert(result.ok);
    assertEquals(result.value.concerns.slice(0, 2), ["engineering", "testing"]);
    assertEquals(result.value.routeId, "route.implement");
    assertEquals(result.value.assetIds, [
      "instruction.workflow",
      "instruction.engineering",
      "skill.engineering-quality",
      "skill.test-engineering",
    ]);
  },
);

Deno.test("framework manifest declares the complete route matrix", async () => {
  // Goal: protect every legal task discriminator and its single entry owner.
  // Scope: unit, route resolver through the real source snapshot.
  // Semantics: all eleven tuples resolve without compatibility fallbacks.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const cases: Array<[RouteInput, string, string | undefined]> = [
    [
      {
        task: "plan",
        mode: "refactor",
        subject: "product",
        concerns: [],
        paths: [],
      },
      "route.plan-refactor-product",
      "skill.architecture-planner",
    ],
    [
      {
        task: "plan",
        mode: "refactor",
        subject: "code",
        concerns: [],
        paths: [],
      },
      "route.plan-refactor-code",
      "skill.architecture-planner",
    ],
    [
      {
        task: "plan",
        mode: "new-module",
        subject: "product",
        concerns: [],
        paths: [],
      },
      "route.plan-new-product",
      "skill.architecture-planner",
    ],
    [
      {
        task: "plan",
        mode: "new-module",
        subject: "code",
        concerns: [],
        paths: [],
      },
      "route.plan-new-code",
      "skill.architecture-planner",
    ],
    [
      {
        task: "review",
        mode: "diff",
        subject: "proposal",
        concerns: [],
        paths: [],
      },
      "route.review-diff-proposal",
      "skill.black-team-review",
    ],
    [
      {
        task: "review",
        mode: "diff",
        subject: "implementation",
        concerns: [],
        paths: [],
      },
      "route.review-diff-implementation",
      "skill.black-team-review",
    ],
    [
      {
        task: "review",
        mode: "scan",
        subject: "proposal",
        concerns: [],
        paths: [],
      },
      "route.review-scan-proposal",
      "skill.black-team-review",
    ],
    [
      {
        task: "review",
        mode: "scan",
        subject: "implementation",
        concerns: [],
        paths: [],
      },
      "route.review-scan-implementation",
      "skill.black-team-review",
    ],
    [
      { task: "implement", concerns: [], paths: [] },
      "route.implement",
      undefined,
    ],
    [
      { task: "document", concerns: [], paths: [] },
      "route.document",
      "skill.documentation-authoring",
    ],
    [
      { task: "validate", concerns: [], paths: [] },
      "route.validate",
      "skill.doc-validation",
    ],
  ];
  for (const [input, routeId, entry] of cases) {
    const result = manifest.resolveRoute(snapshot.manifest, input);
    assert(result.ok, routeId);
    assertEquals(result.value.routeId, routeId);
    assertEquals(
      result.value.projectFactSlotIds.includes("project.proposal-archive"),
      false,
      `${routeId} must not load archived proposals by default`,
    );
    if (entry) assert(result.value.assetIds.includes(entry));
    else {
      assertEquals(
        result.value.assetIds.some(
          (id) =>
            id === "skill.architecture-planner" ||
            id === "skill.black-team-review",
        ),
        false,
      );
    }
  }
});

Deno.test("path concerns are deterministic and deduplicated", async () => {
  // Goal: preserve manifest-owned path classification without a Markdown route matrix.
  // Scope: unit, path classifier.
  // Semantics: overlapping globs emit each concern once in manifest order.
  const { manifest: frameworkManifest } = await source.readSourceSnapshot(
    projectFixture.repoRoot,
  );
  const cases: Array<[string[], string[]]> = [
    [["src/manifest.ts"], ["engineering"]],
    [["test/manifest_test.ts"], ["testing"]],
    [["tests/unit/example.ts"], ["testing"]],
    [["packages/ousia/test/installer_test.ts"], ["testing"]],
    [["README.md"], ["documentation"]],
    [[".ousia/framework.json"], ["prompt-surface", "documentation"]],
    [[".github/skills/example/SKILL.md"], ["prompt-surface", "documentation"]],
    [["Cargo.toml"], ["rust"]],
    [["crates/core/Cargo.toml"], ["rust"]],
    [["crates/core/src/lib.rs"], ["rust"]],
    [
      [".github/skills/rust-engineering/checker/src/lib.rs"],
      ["prompt-surface", "documentation", "rust"],
    ],
    [
      [".github/skills/doc-validation/scripts/rules.ts"],
      ["testing", "prompt-surface", "documentation", "doc-validation"],
    ],
  ];
  for (const [paths, expected] of cases) {
    const result = manifest.classifyPathConcerns(frameworkManifest, [
      ...paths,
      ...paths,
    ]);
    assert(result.ok);
    assertEquals(result.value, expected);
  }
});

Deno.test("restricted suffix globs match only path segments", () => {
  // Goal: support language source concerns without admitting arbitrary glob syntax.
  // Scope: unit, manifest glob matcher.
  // Semantics: `*.suffix` matches a complete segment suffix and nothing else.
  assertEquals(manifest.matchesGlob("src/lib.rs", "**/*.rs"), true);
  assertEquals(manifest.matchesGlob("src/lib.ts", "**/*.rs"), false);
  assertEquals(manifest.matchesGlob("src/rs", "**/*.rs"), false);
});

Deno.test("ordinary implementation has a narrow exact closure", async () => {
  // Goal: keep ordinary implementation context narrow and deterministic.
  // Scope: unit, route resolver.
  // Semantics: a source path loads workflow plus engineering, not planning/review.
  const { manifest: frameworkManifest } = await source.readSourceSnapshot(
    projectFixture.repoRoot,
  );
  const result = manifest.resolveRoute(frameworkManifest, {
    task: "implement",
    concerns: [],
    paths: ["src/manifest.ts"],
  });
  assert(result.ok);
  assertEquals(result.value.concerns, ["engineering"]);
  assertEquals(result.value.assetIds, [
    "instruction.workflow",
    "instruction.engineering",
    "skill.engineering-quality",
  ]);
  assertEquals(result.value.projectFactSlotIds, [
    "project.identity",
    "project.architecture",
  ]);
  assertEquals(result.value.budget.maxAssets, 12);
  assertEquals(result.value.budget.maxPromptAssetCharacters, 36000);
});

Deno.test(
  "proposal archive is distributed but excluded from current routes",
  async () => {
    // Goal: keep closed proposals discoverable without loading them as current decisions.
    // Scope: integration, real manifest inventory, slots, and planning route.
    // Semantics: archive has its own seed/slot while planning reads only active proposals.
    const { manifest: frameworkManifest } = await source.readSourceSnapshot(
      projectFixture.repoRoot,
    );
    const archiveSeed = frameworkManifest.install.assets.find(
      (asset) => asset.id === "seed.proposal-archive-index",
    );
    assertEquals(
      archiveSeed?.target,
      ".ousia/design/proposal/archive/index.md",
    );
    assertEquals(archiveSeed?.projectFactSlot, "project.proposal-archive");
    const result = manifest.resolveRoute(frameworkManifest, {
      task: "plan",
      mode: "refactor",
      subject: "product",
      concerns: [],
      paths: [],
    });
    assert(result.ok);
    assertEquals(result.value.projectFactSlotIds, [
      "project.identity",
      "project.architecture",
      "project.proposal",
    ]);
    assertEquals(
      result.value.projectFactSlotIds.includes("project.proposal-archive"),
      false,
    );
    const promptConcern = manifest.resolveRoute(frameworkManifest, {
      task: "implement",
      concerns: ["prompt-surface"],
      paths: [],
    });
    assert(promptConcern.ok);
    assertEquals(promptConcern.value.projectFactSlotIds, [
      "project.identity",
      "project.architecture",
      "project.proposal",
    ]);
  },
);

Deno.test(
  "code planning and implementation review load engineering evidence",
  async () => {
    // Goal: close entry-skill dependencies through the canonical manifest route.
    // Scope: integration, real source manifest route resolution.
    // Semantics: code subjects load engineering evidence while product/proposal subjects stay narrow.
    const { manifest: frameworkManifest } = await source.readSourceSnapshot(
      projectFixture.repoRoot,
    );
    const cases: Array<[RouteInput, string[]]> = [
      [
        {
          task: "plan",
          mode: "refactor",
          subject: "product",
          concerns: [],
          paths: [],
        },
        [
          "instruction.workflow",
          "instruction.engineering",
          "skill.architecture-planner",
        ],
      ],
      [
        {
          task: "plan",
          mode: "refactor",
          subject: "code",
          concerns: [],
          paths: [],
        },
        [
          "instruction.workflow",
          "instruction.engineering",
          "skill.architecture-planner",
          "skill.engineering-quality",
        ],
      ],
      [
        {
          task: "review",
          mode: "diff",
          subject: "proposal",
          concerns: [],
          paths: [],
        },
        [
          "instruction.workflow",
          "instruction.engineering",
          "skill.black-team-review",
        ],
      ],
      [
        {
          task: "review",
          mode: "diff",
          subject: "implementation",
          concerns: [],
          paths: [],
        },
        [
          "instruction.workflow",
          "instruction.engineering",
          "skill.black-team-review",
          "skill.engineering-quality",
        ],
      ],
    ];
    for (const [input, expectedAssets] of cases) {
      const result = manifest.resolveRoute(frameworkManifest, input);
      assert(result.ok);
      assertEquals(result.value.assetIds, expectedAssets);
    }
  },
);

Deno.test(
  "Rust checker assets and validation route are distributed",
  async () => {
    // Goal: prove Rust validation is owned by rust-engineering and installed with the baseline.
    // Scope: integration, real manifest inventory and validation route.
    // Semantics: checker files are framework assets and Rust path changes trigger the Rust validation command.
    const { manifest: frameworkManifest } = await source.readSourceSnapshot(
      projectFixture.repoRoot,
    );
    const rustAssetIds = frameworkManifest.install.assets
      .filter((asset) => asset.id.startsWith("tool.rust-checker"))
      .map((asset) => asset.id);
    assertEquals(rustAssetIds, ["tool.rust-checker"]);
    const rustSource = frameworkManifest.install.assets.find(
      (asset) => asset.id === "tool.rust-checker",
    );
    assertEquals(rustSource?.shape, "directory");
    assertEquals(
      rustSource?.target,
      ".github/skills/rust-engineering/checker",
    );
    assertEquals(rustSource?.exclude, ["target"]);
    const check = frameworkManifest.validation.checks.find(
      (item) => item.id === "check.rust-functions",
    );
    assertEquals(check?.command, [
      "cargo",
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      ".github/skills/rust-engineering/checker/Cargo.toml",
      "--",
      "check",
      ".github/skills/rust-engineering/checker/Cargo.toml",
    ]);
    assertEquals(check?.whenChanged, [
      "Cargo.toml",
      "**/Cargo.toml",
      "**/*.rs",
      ".github/skills/rust-engineering/**",
    ]);
  },
);

Deno.test("route resolution requires bound prompt metrics", async () => {
  // Goal: prevent budget checks from silently using missing source metrics.
  // Scope: unit, route resolver precondition.
  // Semantics: an unbound manifest fails with a stable diagnostic.
  const frameworkManifest = manifest.loadFrameworkManifest(
    await Deno.readTextFile(`${projectFixture.repoRoot}/.ousia/framework.json`),
  );
  const result = manifest.resolveRoute(frameworkManifest, {
    task: "implement",
    concerns: [],
    paths: [],
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.diagnostics[0].code, "route-metrics-missing");
  }
});

Deno.test("routes reject non-prompt asset references", async () => {
  // Goal: prevent route closure from loading tools as prompt context.
  // Scope: unit, manifest loader.
  // Semantics: a route referencing a non-prompt asset is rejected at load time.
  const content = JSON.parse(
    await Deno.readTextFile(`${projectFixture.repoRoot}/.ousia/framework.json`),
  );
  content.routing.tasks
    .find((item: { id: string }) => item.id === "route.implement")
    .read.push("tool.docs-scripts");
  assertThrows(
    () => manifest.loadFrameworkManifest(JSON.stringify(content)),
    manifest.ManifestError,
    "引用不存在",
  );
});

Deno.test("framework manifest rejects unknown fields", async () => {
  // Goal: keep schema authority strict.
  // Scope: unit, manifest loader.
  // Semantics: undeclared fields fail before source planning.
  const content = await Deno.readTextFile(
    `${projectFixture.repoRoot}/.ousia/framework.json`,
  );
  const parsed = JSON.parse(content);
  parsed.unknown = true;
  assertThrows(
    () => manifest.loadFrameworkManifest(JSON.stringify(parsed)),
    manifest.ManifestError,
    "字段未声明",
  );
});

Deno.test("route asset count budget failure is owned by resolver", async () => {
  // Goal: keep route closure width enforcement in the canonical resolver.
  // Scope: unit, route resolver.
  // Semantics: too many assets returns a stable failure, never success.
  const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
  const budget = snapshot.manifest.validation.promptBudgets.find(
    (item) => item.routeId === "route.implement",
  )!;
  budget.maxAssets = 1;
  const result = manifest.resolveRoute(snapshot.manifest, {
    task: "implement",
    concerns: ["engineering", "testing"],
    paths: [],
  });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.diagnostics[0].code, "route-budget-exceeded");
  }
});

Deno.test(
  "single prompt asset budget failure is owned by resolver",
  async () => {
    // Goal: bound oversized individual prompt assets without punishing lazy-load route totals.
    // Scope: unit, route resolver with real metrics.
    // Semantics: one oversized prompt asset fails, while aggregate route characters are not checked.
    const snapshot = await source.readSourceSnapshot(projectFixture.repoRoot);
    const budget = snapshot.manifest.validation.promptBudgets.find(
      (item) => item.routeId === "route.implement",
    )!;
    budget.maxPromptAssetCharacters = 1;
    const result = manifest.resolveRoute(snapshot.manifest, {
      task: "implement",
      concerns: [],
      paths: [],
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.diagnostics[0].code, "prompt-asset-budget-exceeded");
    }
  },
);

Deno.test(
  "malformed manifest containers return ManifestError diagnostics",
  async () => {
    // Goal: reject malformed container shapes before planning.
    // Scope: unit, manifest loader table.
    // Semantics: every labeled structural corruption raises ManifestError.
    const content = JSON.parse(
      await Deno.readTextFile(
        `${projectFixture.repoRoot}/.ousia/framework.json`,
      ),
    );
    const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
      [
        "routing.tasks must be an array",
        (
          value: Record<string, unknown>,
        ) => ((value.routing as Record<string, unknown>).tasks = {}),
      ],
      [
        "validation.checks must be an array",
        (
          value: Record<string, unknown>,
        ) => ((value.validation as Record<string, unknown>).checks = null),
      ],
      [
        "install.assets entries must be objects",
        (
          value: Record<string, unknown>,
        ) => ((value.install as Record<string, unknown>).assets = [null]),
      ],
      [
        "projectFacts entries must be objects",
        (value: Record<string, unknown>) => (value.projectFacts = ["bad"]),
      ],
      [
        "promptBudgets must be an array",
        (
          value: Record<string, unknown>,
        ) => ((value.validation as Record<string, unknown>).promptBudgets = {}),
      ],
      [
        "asset target must be a string",
        (value: Record<string, unknown>) => ((
          (value.install as Record<string, unknown>).assets as Record<
            string,
            unknown
          >[]
        )[0].target = 1),
      ],
      [
        "project fact paths must contain strings",
        (
          value: Record<string, unknown>,
        ) => ((value.projectFacts as Record<string, unknown>[])[0].paths = [1]),
      ],
      [
        "retired target must be a string",
        (value: Record<string, unknown>) => {
          (value.install as Record<string, unknown>).retiredAssets = [
            {
              id: "old.bad",
              target: 1,
              sha256: "a".repeat(64),
            },
          ];
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      const invalid = structuredClone(content);
      mutate(invalid);
      assertThrows(
        () => manifest.loadFrameworkManifest(JSON.stringify(invalid)),
        manifest.ManifestError,
        undefined,
        label,
      );
    }
  },
);

Deno.test(
  "retired targets are unique and cannot use staging namespace",
  async () => {
    // Goal: keep retirement authorization unambiguous and outside staging.
    // Scope: unit, manifest loader.
    // Semantics: duplicate or reserved tombstone targets are rejected.
    const base = JSON.parse(
      await Deno.readTextFile(
        `${projectFixture.repoRoot}/.ousia/framework.json`,
      ),
    );
    const duplicate = structuredClone(base);
    duplicate.install.retiredAssets = [
      { id: "old.one", target: "old.md", sha256: "a".repeat(64) },
      { id: "old.two", target: "old.md", sha256: "b".repeat(64) },
    ];
    assertThrows(
      () => manifest.loadFrameworkManifest(JSON.stringify(duplicate)),
      manifest.ManifestError,
      "tombstone target重复",
    );
    const reserved = structuredClone(base);
    reserved.install.retiredAssets = [
      {
        id: "old.staging",
        target: ".ousia-install-staging/old.md",
        sha256: "a".repeat(64),
      },
    ];
    assertThrows(
      () => manifest.loadFrameworkManifest(JSON.stringify(reserved)),
      manifest.ManifestError,
      "staging namespace冲突",
    );
  },
);

Deno.test("tombstone cannot overlap a project fact slot", async () => {
  // Goal: prevent framework retirement from deleting project-owned facts.
  // Scope: unit, manifest loader ownership boundary.
  // Semantics: a tombstone inside any project slot is rejected.
  const content = JSON.parse(
    await Deno.readTextFile(`${projectFixture.repoRoot}/.ousia/framework.json`),
  );
  content.install.retiredAssets.push({
    id: "old.project-overlap",
    target: ".ousia/pending.md",
    sha256: "a".repeat(64),
  });
  assertThrows(
    () => manifest.loadFrameworkManifest(JSON.stringify(content)),
    manifest.ManifestError,
    "tombstone 被当前 project fact slot覆盖",
  );
});

Deno.test("directory asset policy is restricted to framework tools", async () => {
  // Goal: keep directory replacement authority out of prompt and project facts.
  // Scope: unit, manifest loader policy validation.
  // Semantics: a directory shape cannot be used as project seed or prompt surface.
  const content = JSON.parse(
    await Deno.readTextFile(`${projectFixture.repoRoot}/.ousia/framework.json`),
  );
  content.install.assets.push({
    id: "seed.bad-dir",
    shape: "directory",
    source: "templates/project/.ousia",
    target: ".ousia/bad",
    kind: "project-seed",
    ownership: "project",
    update: "create",
    retire: "preserve",
    projectFactSlot: "project.pending",
  });
  assertThrows(
    () => manifest.loadFrameworkManifest(JSON.stringify(content)),
    manifest.ManifestError,
    "directory asset 只允许 framework-owned tool replace/delete",
  );
});

Deno.test("directory asset cannot overlap a project slot child path", async () => {
  // Goal: reject manifest inventory that would classify project facts as framework tree content.
  // Scope: unit, manifest loader ownership boundary.
  // Semantics: a project slot under a directory asset is a prefix conflict.
  const content = JSON.parse(
    await Deno.readTextFile(`${projectFixture.repoRoot}/.ousia/framework.json`),
  );
  content.projectFacts.push({
    id: "project.rust-local",
    paths: [".github/skills/rust-engineering/checker/src/local.rs"],
    required: false,
  });
  assertThrows(
    () => manifest.loadFrameworkManifest(JSON.stringify(content)),
    manifest.ManifestError,
    "framework asset 被 project slot覆盖",
  );
});
