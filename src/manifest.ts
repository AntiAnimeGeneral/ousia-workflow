export const FRAMEWORK_MANIFEST_PATH = ".ousia/framework.json";

export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  remediation: string;
}
export class ManifestError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(
      diagnostics.map((item) => `${item.path}: ${item.message}`).join("\n"),
    );
    this.name = "ManifestError";
  }
}

export type AssetKind =
  | "manifest"
  | "instruction"
  | "skill"
  | "tool"
  | "project-seed";
export interface InstallAsset {
  id: string;
  source: string;
  target: string;
  kind: AssetKind;
  ownership: "framework" | "project";
  update: "replace" | "create";
  retire: "delete" | "preserve";
  projectFactSlot?: string;
  native?: { name?: string; applyTo?: string };
}
export interface RetiredAsset {
  id: string;
  target: string;
  sha256: string;
}
export interface ProjectFactSlot {
  id: string;
  paths: string[];
  required: boolean;
}
export type Task = "plan" | "implement" | "review" | "document" | "validate";
export type Concern =
  | "engineering"
  | "testing"
  | "prompt-surface"
  | "documentation"
  | "doc-validation"
  | "rust";
export interface TaskRoute {
  id: string;
  task: Task;
  mode?: "refactor" | "new-module" | "diff" | "scan";
  subject?: "product" | "code" | "proposal" | "implementation";
  entry?: string;
  read: string[];
  readProjectFacts: string[];
}
export interface ConcernRoute {
  concern: Concern;
  read: string[];
  readProjectFacts: string[];
}
export interface PathConcern {
  paths: string[];
  concerns: Concern[];
}
export interface ValidationCheck {
  id: string;
  command: string[];
  cwd: string;
  whenChanged: string[];
}
export interface PromptBudget {
  routeId: string;
  maxAssets: number;
  maxCharacters: number;
}
export interface FrameworkManifest {
  schemaVersion: "1.0.0";
  workflow: { id: string; version: string };
  install: { assets: InstallAsset[]; retiredAssets: RetiredAsset[] };
  projectFacts: ProjectFactSlot[];
  routing: {
    tasks: TaskRoute[];
    concerns: ConcernRoute[];
    pathConcerns: PathConcern[];
  };
  validation: { checks: ValidationCheck[]; promptBudgets: PromptBudget[] };
  promptCharacters?: Readonly<Record<string, number>>;
}
export interface RouteInput {
  task: Task;
  mode?: TaskRoute["mode"];
  subject?: TaskRoute["subject"];
  concerns: Concern[];
  paths: string[];
}
export interface ResolvedRoute {
  routeId: string;
  concerns: Concern[];
  assetIds: string[];
  projectFactSlotIds: string[];
  budget: PromptBudget;
  assetCount: number;
  characterCount: number;
}
export type RouteResolutionResult<T> =
  | { ok: true; value: T }
  | {
    ok: false;
    diagnostics: Diagnostic[];
  };

const ID = /^[a-z0-9][a-z0-9.:-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STAGING_NAMESPACE = ".ousia-install-staging";
const VALID_CONCERNS: Concern[] = [
  "engineering",
  "testing",
  "prompt-surface",
  "documentation",
  "doc-validation",
  "rust",
];

export function loadFrameworkManifest(content: string): FrameworkManifest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new ManifestError([
      diagnostic(
        "manifest-json",
        FRAMEWORK_MANIFEST_PATH,
        `JSON 无效：${error instanceof Error ? error.message : String(error)}`,
        "修复 JSON 后重新检查。",
      ),
    ]);
  }
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    throw new ManifestError([
      diagnostic(
        "manifest-object",
        "$",
        "manifest 必须是对象。",
        "提供 FrameworkManifest 对象。",
      ),
    ]);
  }
  rejectUnknown(
    value,
    [
      "schemaVersion",
      "workflow",
      "install",
      "projectFacts",
      "routing",
      "validation",
    ],
    "$",
    diagnostics,
  );
  if (value.schemaVersion !== "1.0.0") {
    diagnostics.push(
      diagnostic(
        "manifest-schema",
        "$.schemaVersion",
        "只支持 schemaVersion 1.0.0。",
        "禁止旧 schema adapter。",
      ),
    );
  }
  object(value.workflow, ["id", "version"], "$.workflow", diagnostics);
  object(value.install, ["assets", "retiredAssets"], "$.install", diagnostics);
  object(
    value.routing,
    ["tasks", "concerns", "pathConcerns"],
    "$.routing",
    diagnostics,
  );
  object(
    value.validation,
    ["checks", "promptBudgets"],
    "$.validation",
    diagnostics,
  );
  if (isRecord(value.install)) {
    recordArray(value.install.assets, "$.install.assets", diagnostics);
    recordArray(
      value.install.retiredAssets,
      "$.install.retiredAssets",
      diagnostics,
    );
  }
  recordArray(value.projectFacts, "$.projectFacts", diagnostics);
  if (isRecord(value.routing)) {
    recordArray(value.routing.tasks, "$.routing.tasks", diagnostics);
    recordArray(value.routing.concerns, "$.routing.concerns", diagnostics);
    recordArray(
      value.routing.pathConcerns,
      "$.routing.pathConcerns",
      diagnostics,
    );
    arrayFields(
      value.routing.tasks,
      ["read", "readProjectFacts"],
      "$.routing.tasks",
      diagnostics,
    );
    arrayFields(
      value.routing.concerns,
      ["read", "readProjectFacts"],
      "$.routing.concerns",
      diagnostics,
    );
    arrayFields(
      value.routing.pathConcerns,
      ["paths", "concerns"],
      "$.routing.pathConcerns",
      diagnostics,
    );
  }
  if (isRecord(value.validation)) {
    recordArray(value.validation.checks, "$.validation.checks", diagnostics);
    recordArray(
      value.validation.promptBudgets,
      "$.validation.promptBudgets",
      diagnostics,
    );
  }
  if (diagnostics.length) throw new ManifestError(diagnostics);
  const manifest = value as unknown as FrameworkManifest;
  validateManifest(manifest, diagnostics);
  if (diagnostics.length) throw new ManifestError(diagnostics);
  return manifest;
}

export function bindPromptCharacters(
  manifest: FrameworkManifest,
  characters: Readonly<Record<string, number>>,
): void {
  Object.defineProperty(manifest, "promptCharacters", {
    value: characters,
    enumerable: false,
  });
}

export function classifyPathConcerns(
  manifest: FrameworkManifest,
  paths: string[],
): RouteResolutionResult<Concern[]> {
  const diagnostics: Diagnostic[] = [];
  paths.forEach((path, index) =>
    validatePath(path, `paths[${index}]`, false, diagnostics)
  );
  if (diagnostics.length) return { ok: false, diagnostics };
  const matched = new Set<Concern>();
  for (const mapping of manifest.routing.pathConcerns) {
    if (
      paths.some((path) =>
        mapping.paths.some((pattern) => matchesGlob(path, pattern))
      )
    ) {
      mapping.concerns.forEach((item) => matched.add(item));
    }
  }
  return {
    ok: true,
    value: manifest.routing.concerns
      .map((route) => route.concern)
      .filter((item) => matched.has(item)),
  };
}

export function resolveRoute(
  manifest: FrameworkManifest,
  input: RouteInput,
): RouteResolutionResult<ResolvedRoute> {
  const diagnostics: Diagnostic[] = [];
  if (!routeInputKey(input)) {
    diagnostics.push(
      diagnostic(
        "route-input",
        "routeInput",
        "task/mode/subject组合非法。",
        "使用合法 route矩阵。",
      ),
    );
  }
  input.concerns.forEach((item) => {
    if (!VALID_CONCERNS.includes(item)) {
      diagnostics.push(
        diagnostic(
          "route-concern",
          "concerns",
          `未知 concern：${item}`,
          "使用已声明 concern。",
        ),
      );
    }
  });
  const pathConcerns = classifyPathConcerns(manifest, input.paths);
  if (!pathConcerns.ok) diagnostics.push(...pathConcerns.diagnostics);
  if (diagnostics.length || !pathConcerns.ok) return { ok: false, diagnostics };
  const selected = new Set<Concern>([...input.concerns, ...pathConcerns.value]);
  if (input.task === "implement" && selected.size === 0) {
    selected.add("engineering");
  }
  const concerns = manifest.routing.concerns
    .map((route) => route.concern)
    .filter((item) => selected.has(item));
  const route = manifest.routing.tasks.find((item) =>
    routeMatches(item, input)
  );
  if (!route) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "route-missing",
          "routing.tasks",
          "没有唯一匹配 route。",
          "修复输入或 route矩阵。",
        ),
      ],
    };
  }
  const assetSet = new Set(route.read);
  const slotSet = new Set(route.readProjectFacts);
  for (const concern of concerns) {
    const addition = manifest.routing.concerns.find(
      (item) => item.concern === concern,
    )!;
    addition.read.forEach((id) => assetSet.add(id));
    addition.readProjectFacts.forEach((id) => slotSet.add(id));
  }
  const assetIds = manifest.install.assets
    .map((item) => item.id)
    .filter((id) => assetSet.has(id));
  const projectFactSlotIds = manifest.projectFacts
    .map((item) => item.id)
    .filter((id) => slotSet.has(id));
  const budget = manifest.validation.promptBudgets.find(
    (item) => item.routeId === route.id,
  )!;
  const missingMetrics = assetIds.filter(
    (id) => manifest.promptCharacters?.[id] === undefined,
  );
  if (missingMetrics.length) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "route-metrics-missing",
          "promptCharacters",
          `缺少prompt字符计量：${missingMetrics.join(", ")}`,
          "通过validated source snapshot绑定prompt字符数后再解析route。",
        ),
      ],
    };
  }
  const characterCount = assetIds.reduce(
    (sum, id) => sum + manifest.promptCharacters![id],
    0,
  );
  if (
    assetIds.length > budget.maxAssets ||
    characterCount > budget.maxCharacters
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "route-budget-exceeded",
          `validation.promptBudgets.${route.id}`,
          `route 使用 ${assetIds.length} assets/${characterCount} characters，超过 ${budget.maxAssets}/${budget.maxCharacters}。`,
          "缩小读取闭包或提高预算。",
        ),
      ],
    };
  }
  return {
    ok: true,
    value: {
      routeId: route.id,
      concerns,
      assetIds,
      projectFactSlotIds,
      budget,
      assetCount: assetIds.length,
      characterCount,
    },
  };
}

function validateManifest(
  manifest: FrameworkManifest,
  diagnostics: Diagnostic[],
): void {
  if (
    !ID.test(manifest.workflow?.id ?? "") ||
    typeof manifest.workflow?.version !== "string"
  ) {
    diagnostics.push(
      diagnostic(
        "workflow",
        "$.workflow",
        "workflow id/version 无效。",
        "填写稳定小写 ID 和版本。",
      ),
    );
  }
  const rawAssets = array(
    manifest.install?.assets,
    "$.install.assets",
    diagnostics,
  ) as InstallAsset[];
  const rawRetired = array(
    manifest.install?.retiredAssets,
    "$.install.retiredAssets",
    diagnostics,
  ) as RetiredAsset[];
  const rawSlots = array(
    manifest.projectFacts,
    "$.projectFacts",
    diagnostics,
  ) as ProjectFactSlot[];
  const assets = rawAssets.filter(
    (asset) =>
      isRecord(asset) &&
      typeof asset.target === "string" &&
      typeof asset.source === "string",
  );
  const slots = rawSlots.filter(
    (slot) =>
      isRecord(slot) &&
      Array.isArray(slot.paths) &&
      slot.paths.every((path) => typeof path === "string"),
  );
  const ids = new Set<string>();
  const register = (id: unknown, path: string) => {
    if (typeof id !== "string" || !ID.test(id)) {
      diagnostics.push(
        diagnostic(
          "manifest-id",
          path,
          "ID 无效。",
          "使用小写 ASCII、数字、`.`、`:`、`-`。",
        ),
      );
    } else if (ids.has(id)) {
      diagnostics.push(
        diagnostic(
          "manifest-id-duplicate",
          path,
          `ID 重复：${id}`,
          "使用全局唯一 ID。",
        ),
      );
    } else ids.add(id);
  };
  const targets = new Set<string>();
  rawAssets.forEach((asset, index) => {
    const path = `$.install.assets[${index}]`;
    if (!isRecord(asset)) return;
    rejectUnknown(
      asset,
      [
        "id",
        "source",
        "target",
        "kind",
        "ownership",
        "update",
        "retire",
        "projectFactSlot",
        "native",
      ],
      path,
      diagnostics,
      ["projectFactSlot", "native"],
    );
    register(asset.id, `${path}.id`);
    validatePath(asset.source, `${path}.source`, false, diagnostics);
    validatePath(asset.target, `${path}.target`, false, diagnostics);
    validateReservedPath(asset.target, `${path}.target`, diagnostics);
    if (
      !["manifest", "instruction", "skill", "tool", "project-seed"].includes(
        asset.kind,
      )
    ) {
      diagnostics.push(
        diagnostic(
          "asset-kind",
          `${path}.kind`,
          "kind 无效。",
          "使用已声明 kind。",
        ),
      );
    }
    const seed = asset.kind === "project-seed";
    if (
      seed
        ? !(
          asset.ownership === "project" &&
          asset.update === "create" &&
          asset.retire === "preserve" &&
          asset.projectFactSlot
        )
        : !(
          asset.ownership === "framework" &&
          asset.update === "replace" &&
          asset.retire === "delete" &&
          !asset.projectFactSlot
        )
    ) {
      diagnostics.push(
        diagnostic(
          "asset-policy",
          path,
          "ownership/update/retire组合无效。",
          "Framework使用replace/delete；seed使用create/preserve。",
        ),
      );
    }
    if (asset.kind === "instruction") {
      native(asset.native, "applyTo", path, diagnostics);
    } else if (asset.kind === "skill") {
      native(asset.native, "name", path, diagnostics);
    } else if (asset.native) {
      diagnostics.push(
        diagnostic(
          "asset-native",
          `${path}.native`,
          "该 kind 禁止 native。",
          "删除 native。",
        ),
      );
    }
    if (targets.has(asset.target)) {
      diagnostics.push(
        diagnostic(
          "asset-target-duplicate",
          `${path}.target`,
          "target 重复。",
          "每个 target只声明一次。",
        ),
      );
    }
    targets.add(asset.target);
  });
  for (let left = 0; left < assets.length; left++) {
    for (let right = left + 1; right < assets.length; right++) {
      if (pathPrefixConflict(assets[left].target, assets[right].target)) {
        diagnostics.push(
          diagnostic(
            "asset-prefix-conflict",
            `$.install.assets[${right}].target`,
            `与 ${assets[left].target} 存在文件/目录前缀冲突。`,
            "使用互不作为前缀的文件 targets。",
          ),
        );
      }
    }
  }
  const self = assets.filter((item) => item.kind === "manifest");
  if (
    self.length !== 1 ||
    self[0]?.source !== FRAMEWORK_MANIFEST_PATH ||
    self[0]?.target !== FRAMEWORK_MANIFEST_PATH
  ) {
    diagnostics.push(
      diagnostic(
        "manifest-self",
        "$.install.assets",
        "必须恰有一个 framework manifest self asset。",
        "声明 source/target均为 .ousia/framework.json。",
      ),
    );
  }
  rawSlots.forEach((slot, index) => {
    const path = `$.projectFacts[${index}]`;
    if (!isRecord(slot)) return;
    rejectUnknown(slot, ["id", "paths", "required"], path, diagnostics);
    register(slot.id, `${path}.id`);
    array(slot.paths, `${path}.paths`, diagnostics).forEach((item, p) => {
      validatePath(item, `${path}.paths[${p}]`, true, diagnostics);
      validateReservedPath(item, `${path}.paths[${p}]`, diagnostics);
    });
    if (typeof slot.required !== "boolean") {
      diagnostics.push(
        diagnostic(
          "slot-required",
          `${path}.required`,
          "required 必须是 boolean。",
          "设置 true 或 false。",
        ),
      );
    }
  });
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      if (patternsIntersect(slots[i].paths, slots[j].paths)) {
        diagnostics.push(
          diagnostic(
            "slot-overlap",
            `$.projectFacts[${j}]`,
            `与 ${slots[i].id} 相交。`,
            "使用互斥 paths。",
          ),
        );
      }
    }
  }
  assets.forEach((asset) => {
    const covering = slots.filter((slot) =>
      patternsIntersect([asset.target], slot.paths)
    );
    if (asset.ownership === "framework" && covering.length) {
      diagnostics.push(
        diagnostic(
          "asset-slot-overlap",
          asset.target,
          "framework asset 被 project slot覆盖。",
          "使二者互斥。",
        ),
      );
    }
    if (
      asset.kind === "project-seed" &&
      (covering.length !== 1 || covering[0]?.id !== asset.projectFactSlot)
    ) {
      diagnostics.push(
        diagnostic(
          "seed-slot",
          asset.target,
          "seed 必须由声明的唯一 slot覆盖。",
          "修复 projectFactSlot。",
        ),
      );
    }
  });
  const retiredTargets = new Set<string>();
  rawRetired.forEach((item, index) => {
    const path = `$.install.retiredAssets[${index}]`;
    if (!isRecord(item)) return;
    rejectUnknown(item, ["id", "target", "sha256"], path, diagnostics);
    register(item.id, `${path}.id`);
    validatePath(item.target, `${path}.target`, false, diagnostics);
    validateReservedPath(item.target, `${path}.target`, diagnostics);
    if (typeof item.target !== "string") return;
    if (retiredTargets.has(item.target)) {
      diagnostics.push(
        diagnostic(
          "retired-target-duplicate",
          `${path}.target`,
          "tombstone target重复。",
          "每个retired target只声明一次。",
        ),
      );
    }
    for (const previous of retiredTargets) {
      if (pathPrefixConflict(previous, item.target)) {
        diagnostics.push(
          diagnostic(
            "retired-target-prefix-conflict",
            `${path}.target`,
            `与 retired target ${previous} 存在前缀冲突。`,
            "使retired targets完全分离。",
          ),
        );
      }
    }
    retiredTargets.add(item.target);
    if (!SHA256.test(item.sha256)) {
      diagnostics.push(
        diagnostic(
          "retired-digest",
          `${path}.sha256`,
          "sha256无效。",
          "填写小写64位摘要。",
        ),
      );
    }
    if (targets.has(item.target)) {
      diagnostics.push(
        diagnostic(
          "retired-active",
          `${path}.target`,
          "active/tombstone重叠。",
          "只保留一种声明。",
        ),
      );
    }
    if (slots.some((slot) => patternsIntersect([item.target], slot.paths))) {
      diagnostics.push(
        diagnostic(
          "retired-slot-overlap",
          `${path}.target`,
          "tombstone 被当前 project fact slot覆盖。",
          "project facts不可通过framework retirement删除。",
        ),
      );
    }
    for (const asset of assets) {
      if (pathPrefixConflict(asset.target, item.target)) {
        diagnostics.push(
          diagnostic(
            "retired-prefix-conflict",
            `${path}.target`,
            `与 active target ${asset.target} 存在前缀冲突。`,
            "使 active 与 retired targets 完全分离。",
          ),
        );
      }
    }
  });
  validateRoutes(manifest, diagnostics, register);
  manifest.validation.checks.forEach((check, index) => {
    const path = `$.validation.checks[${index}]`;
    if (!isRecord(check)) return;
    rejectUnknown(
      check,
      ["id", "command", "cwd", "whenChanged"],
      path,
      diagnostics,
    );
    register(check.id, `${path}.id`);
    const command = array(check.command, `${path}.command`, diagnostics);
    if (
      command.length === 0 ||
      command.some((item) => typeof item !== "string" || item.length === 0)
    ) {
      diagnostics.push(
        diagnostic(
          "validation-command",
          `${path}.command`,
          "command 必须是非空字符串数组。",
          "声明可执行命令及参数。",
        ),
      );
    }
    if (check.cwd !== ".") {
      validatePath(check.cwd, `${path}.cwd`, true, diagnostics);
    }
    array(check.whenChanged, `${path}.whenChanged`, diagnostics).forEach(
      (item, p) =>
        validatePath(item, `${path}.whenChanged[${p}]`, true, diagnostics),
    );
  });
}

function validateRoutes(
  manifest: FrameworkManifest,
  diagnostics: Diagnostic[],
  register: (id: unknown, path: string) => void,
): void {
  const assetIds = new Set(manifest.install.assets.map((item) => item.id));
  const promptAssetIds = new Set(
    manifest.install.assets
      .filter((item) => item.kind === "instruction" || item.kind === "skill")
      .map((item) => item.id),
  );
  const slotIds = new Set(manifest.projectFacts.map((item) => item.id));
  const routeKeys = new Set<string>();
  manifest.routing.tasks.forEach((route, index) => {
    const path = `$.routing.tasks[${index}]`;
    if (!isRecord(route)) return;
    rejectUnknown(
      route,
      ["id", "task", "mode", "subject", "entry", "read", "readProjectFacts"],
      path,
      diagnostics,
      ["mode", "subject", "entry"],
    );
    register(route.id, `${path}.id`);
    const key = taskRouteKey(route);
    if (!key || routeKeys.has(key)) {
      diagnostics.push(
        diagnostic(
          "route-cardinality",
          path,
          "route discriminator非法或重复。",
          "完整且唯一声明11个route。",
        ),
      );
    } else routeKeys.add(key);
    references(route.read, assetIds, `${path}.read`, diagnostics);
    references(route.read, promptAssetIds, `${path}.read`, diagnostics);
    references(
      route.readProjectFacts,
      slotIds,
      `${path}.readProjectFacts`,
      diagnostics,
    );
    const entryAsset = manifest.install.assets.find(
      (asset) => asset.id === route.entry,
    );
    if (
      route.task === "implement" ? route.entry !== undefined : !entryAsset ||
        entryAsset.kind !== "skill" ||
        !route.read.includes(route.entry!)
    ) {
      diagnostics.push(
        diagnostic(
          "route-entry",
          `${path}.entry`,
          "entry cardinality或引用无效。",
          "implement禁止entry；其他task引用asset。",
        ),
      );
    }
  });
  [
    "plan:refactor:product",
    "plan:refactor:code",
    "plan:new-module:product",
    "plan:new-module:code",
    "review:diff:proposal",
    "review:diff:implementation",
    "review:scan:proposal",
    "review:scan:implementation",
    "implement",
    "document",
    "validate",
  ].forEach((key) => {
    if (!routeKeys.has(key)) {
      diagnostics.push(
        diagnostic(
          "route-missing-combination",
          "$.routing.tasks",
          `缺少 ${key}`,
          "补齐route矩阵。",
        ),
      );
    }
  });
  const seenConcerns = new Set<Concern>();
  manifest.routing.concerns.forEach((item, index) => {
    const path = `$.routing.concerns[${index}]`;
    if (!isRecord(item)) return;
    rejectUnknown(
      item,
      ["concern", "read", "readProjectFacts"],
      path,
      diagnostics,
    );
    if (
      !VALID_CONCERNS.includes(item.concern) ||
      seenConcerns.has(item.concern)
    ) {
      diagnostics.push(
        diagnostic(
          "concern-cardinality",
          `${path}.concern`,
          "concern未知或重复。",
          "每种concern声明一次。",
        ),
      );
    }
    seenConcerns.add(item.concern);
    references(item.read, assetIds, `${path}.read`, diagnostics);
    references(item.read, promptAssetIds, `${path}.read`, diagnostics);
    references(
      item.readProjectFacts,
      slotIds,
      `${path}.readProjectFacts`,
      diagnostics,
    );
  });
  VALID_CONCERNS.forEach((item) => {
    if (!seenConcerns.has(item)) {
      diagnostics.push(
        diagnostic(
          "concern-missing",
          "$.routing.concerns",
          `缺少 ${item}`,
          "补齐concern。",
        ),
      );
    }
  });
  manifest.routing.pathConcerns.forEach((item, index) => {
    const path = `$.routing.pathConcerns[${index}]`;
    if (!isRecord(item)) return;
    rejectUnknown(item, ["paths", "concerns"], path, diagnostics);
    array(item.paths, `${path}.paths`, diagnostics).forEach((value, p) =>
      validatePath(value, `${path}.paths[${p}]`, true, diagnostics)
    );
    array(item.concerns, `${path}.concerns`, diagnostics).forEach((value) => {
      if (!VALID_CONCERNS.includes(value as Concern)) {
        diagnostics.push(
          diagnostic(
            "path-concern",
            `${path}.concerns`,
            `未知 concern：${value}`,
            "使用已声明concern。",
          ),
        );
      }
    });
  });
  const routeIds = new Set(manifest.routing.tasks.map((item) => item.id));
  const budgetRoutes = new Set<string>();
  manifest.validation.promptBudgets.forEach((item, index) => {
    const path = `$.validation.promptBudgets[${index}]`;
    if (!isRecord(item)) return;
    rejectUnknown(
      item,
      ["routeId", "maxAssets", "maxCharacters"],
      path,
      diagnostics,
    );
    if (!routeIds.has(item.routeId) || budgetRoutes.has(item.routeId)) {
      diagnostics.push(
        diagnostic(
          "budget-route",
          `${path}.routeId`,
          "route引用无效或重复。",
          "每个route恰有一个budget。",
        ),
      );
    }
    budgetRoutes.add(item.routeId);
    if (
      !Number.isInteger(item.maxAssets) ||
      item.maxAssets <= 0 ||
      !Number.isInteger(item.maxCharacters) ||
      item.maxCharacters <= 0
    ) {
      diagnostics.push(
        diagnostic(
          "budget-value",
          path,
          "budget必须为正整数。",
          "设置正整数。",
        ),
      );
    }
  });
  routeIds.forEach((id) => {
    if (!budgetRoutes.has(id)) {
      diagnostics.push(
        diagnostic(
          "budget-missing",
          "$.validation.promptBudgets",
          `${id} 缺少budget。`,
          "添加唯一budget。",
        ),
      );
    }
  });
  const reachable = new Set<string>();
  manifest.routing.tasks.forEach((route) =>
    route.read.forEach((id) => reachable.add(id))
  );
  manifest.routing.concerns.forEach((route) =>
    route.read.forEach((id) => reachable.add(id))
  );
  manifest.install.assets
    .filter((asset) => asset.kind === "instruction" || asset.kind === "skill")
    .forEach((asset) => {
      if (!reachable.has(asset.id)) {
        diagnostics.push(
          diagnostic(
            "prompt-asset-unreachable",
            asset.id,
            "prompt asset 不可从任何 route 到达。",
            "将其加入 owning route/concern 或移出 inventory。",
          ),
        );
      }
    });
}

function taskRouteKey(route: TaskRoute): string | null {
  if (
    route.task === "plan" &&
    ["refactor", "new-module"].includes(route.mode ?? "") &&
    ["product", "code"].includes(route.subject ?? "")
  ) {
    return `plan:${route.mode}:${route.subject}`;
  }
  if (
    route.task === "review" &&
    ["diff", "scan"].includes(route.mode ?? "") &&
    ["proposal", "implementation"].includes(route.subject ?? "")
  ) {
    return `review:${route.mode}:${route.subject}`;
  }
  if (
    ["implement", "document", "validate"].includes(route.task) &&
    route.mode === undefined &&
    route.subject === undefined
  ) {
    return route.task;
  }
  return null;
}
function routeInputKey(input: RouteInput): string | null {
  return taskRouteKey({
    id: "input",
    task: input.task,
    mode: input.mode,
    subject: input.subject,
    read: [],
    readProjectFacts: [],
  });
}
function routeMatches(route: TaskRoute, input: RouteInput): boolean {
  return (
    route.task === input.task &&
    route.mode === input.mode &&
    route.subject === input.subject
  );
}
function native(
  value: unknown,
  required: "name" | "applyTo",
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic(
        "asset-native",
        `${path}.native`,
        `缺少 native.${required}。`,
        "声明frontmatter projection。",
      ),
    );
    return;
  }
  rejectUnknown(value, [required], `${path}.native`, diagnostics);
  if (typeof value[required] !== "string" || !value[required]) {
    diagnostics.push(
      diagnostic(
        "asset-native",
        `${path}.native.${required}`,
        "必须是非空字符串。",
        "填写projection。",
      ),
    );
  }
}
function references(
  values: unknown,
  allowed: Set<string>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  array(values, path, diagnostics).forEach((item) => {
    if (typeof item !== "string" || !allowed.has(item)) {
      diagnostics.push(
        diagnostic(
          "manifest-reference",
          path,
          `引用不存在：${item}`,
          "引用已声明ID。",
        ),
      );
    }
  });
}
function object(
  value: unknown,
  keys: string[],
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic("manifest-object", path, "必须是对象。", "提供对象。"),
    );
  } else rejectUnknown(value, keys, path, diagnostics);
}
function rejectUnknown(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
  diagnostics: Diagnostic[],
  optional: string[] = [],
): void {
  Object.keys(value).forEach((key) => {
    if (!keys.includes(key)) {
      diagnostics.push(
        diagnostic(
          "manifest-unknown-field",
          `${path}.${key}`,
          "字段未声明。",
          "删除未知字段。",
        ),
      );
    }
  });
  keys.forEach((key) => {
    if (!(key in value) && !optional.includes(key)) {
      diagnostics.push(
        diagnostic(
          "manifest-missing-field",
          `${path}.${key}`,
          "缺少必填字段。",
          "补充字段。",
        ),
      );
    }
  });
}
function array(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): unknown[] {
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic("manifest-array", path, "必须是数组。", "提供数组。"),
    );
    return [];
  }
  return value;
}
function recordArray(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic("manifest-array", path, "必须是数组。", "提供对象数组。"),
    );
    return;
  }
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      diagnostics.push(
        diagnostic(
          "manifest-object",
          `${path}[${index}]`,
          "数组元素必须是对象。",
          "提供声明对象。",
        ),
      );
    }
  });
}
function arrayFields(
  value: unknown,
  fields: string[],
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    fields.forEach((field) => {
      if (!Array.isArray(item[field])) {
        diagnostics.push(
          diagnostic(
            "manifest-array",
            `${path}[${index}].${field}`,
            "必须是数组。",
            "提供声明数组。",
          ),
        );
      }
    });
  });
}
function validatePath(
  value: unknown,
  path: string,
  glob: boolean,
  diagnostics: Diagnostic[],
): void {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    (!glob && value.includes("*")) ||
    /[?!\[\]{}]/.test(value) ||
    (glob &&
      value
        .split("/")
        .some((part) =>
          part.includes("*") &&
          part !== "*" &&
          part !== "**" &&
          !/^\*\.[A-Za-z0-9._-]+$/.test(part)
        ))
  ) {
    diagnostics.push(
      diagnostic(
        "manifest-path",
        path,
        "路径不是 canonical POSIX relative path或受限glob。",
        "使用字面段、`*`、`**` 或 `*.suffix`。",
      ),
    );
  }
}
function validateReservedPath(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (
    typeof value === "string" &&
    (value === STAGING_NAMESPACE ||
      value.startsWith(`${STAGING_NAMESPACE}/`) ||
      STAGING_NAMESPACE.startsWith(`${value}/`))
  ) {
    diagnostics.push(
      diagnostic(
        "manifest-reserved-path",
        path,
        "路径与installer staging namespace冲突。",
        "不要声明 .ousia-install-staging 或其父子路径。",
      ),
    );
  }
}
function patternsIntersect(left: string[], right: string[]): boolean {
  return left.some((a) =>
    right.some((b) => intersect(a.split("/"), b.split("/"), 0, 0, new Set()))
  );
}
function pathPrefixConflict(left: string, right: string): boolean {
  return (
    left !== right &&
    (left.startsWith(`${right}/`) || right.startsWith(`${left}/`))
  );
}
function intersect(
  a: string[],
  b: string[],
  i: number,
  j: number,
  seen: Set<string>,
): boolean {
  const key = `${i}:${j}`;
  if (seen.has(key)) return false;
  seen.add(key);
  if (i === a.length && j === b.length) return true;
  if (a[i] === "**") {
    return (
      intersect(a, b, i + 1, j, seen) ||
      (j < b.length && intersect(a, b, i, j + 1, seen))
    );
  }
  if (b[j] === "**") {
    return (
      intersect(a, b, i, j + 1, seen) ||
      (i < a.length && intersect(a, b, i + 1, j, seen))
    );
  }
  if (i >= a.length || j >= b.length) return false;
  return (
    segmentsIntersect(a[i], b[j]) &&
    intersect(a, b, i + 1, j + 1, seen)
  );
}
export function matchesGlob(path: string, pattern: string): boolean {
  const values = path.split("/");
  const parts = pattern.split("/");
  const visit = (i: number, j: number): boolean =>
    j === parts.length
      ? i === values.length
      : parts[j] === "**"
      ? visit(i, j + 1) || (i < values.length && visit(i + 1, j))
      : i < values.length &&
        segmentMatches(values[i], parts[j]) &&
        visit(i + 1, j + 1);
  return visit(0, 0);
}
function segmentMatches(value: string, pattern: string): boolean {
  if (pattern === "*" || value === pattern) return true;
  return pattern.startsWith("*.") && value.endsWith(pattern.slice(1));
}
function segmentsIntersect(left: string, right: string): boolean {
  if (left === "*" || right === "*" || left === right) return true;
  if (left.startsWith("*.") && right.startsWith("*.")) {
    const leftSuffix = left.slice(1);
    const rightSuffix = right.slice(1);
    return leftSuffix.endsWith(rightSuffix) || rightSuffix.endsWith(leftSuffix);
  }
  if (left.startsWith("*.")) return right.endsWith(left.slice(1));
  if (right.startsWith("*.")) return left.endsWith(right.slice(1));
  return false;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function diagnostic(
  code: string,
  path: string,
  message: string,
  remediation: string,
): Diagnostic {
  return { code, path, message, remediation };
}
