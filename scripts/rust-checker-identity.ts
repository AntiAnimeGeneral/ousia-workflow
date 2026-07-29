import { dirname, join, relative, resolve, SEPARATOR } from "@std/path";
import { parse } from "@std/toml";
import * as digest from "../src/digest.ts";

export interface RustCheckerBuildIdentity {
  schema: "ousia.rust-checker-build.v1";
  package: "ousia-rust-checker";
  binary: "ousia-rust-checker";
  sourceSha256: string;
}

export function decodeRustCheckerBuildIdentity(
  value: unknown,
  label: string,
): RustCheckerBuildIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== "ousia.rust-checker-build.v1" ||
    record.package !== "ousia-rust-checker" ||
    record.binary !== "ousia-rust-checker" ||
    !/^[a-f0-9]{64}$/.test(String(record.sourceSha256 ?? "")) ||
    Object.keys(record).length !== 4
  ) throw new Error(`${label} has an invalid schema`);
  return record as unknown as RustCheckerBuildIdentity;
}

export function decodeRustCheckerBuildIdentityJson(
  text: string,
  label: string,
): RustCheckerBuildIdentity {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not JSON: ${error}`);
  }
  return decodeRustCheckerBuildIdentity(value, label);
}

const checkerPath = ".github/skills/rust-engineering/checker";
const identityPath = `${checkerPath}/build-identity.json`;
const manifestPath = ".ousia/framework.json";
const domain = new TextEncoder().encode("ousia.rust-checker-build.v1\0");

export async function calculateRustCheckerIdentity(
  repositoryRoot: string,
): Promise<RustCheckerBuildIdentity> {
  const root = resolve(repositoryRoot);
  await assertRegularDirectory(root, root);
  await rejectUntrackedCargoInputs(root);
  const cargoToml = await readRegularFile(
    root,
    join(root, checkerPath, "Cargo.toml"),
  );
  validateCargoManifest(new TextDecoder().decode(cargoToml));
  const paths = ["Cargo.toml", "Cargo.lock"];
  await collectRustSources(join(root, checkerPath, "src"), root, paths);
  paths.sort();
  const chunks: Uint8Array[] = [domain];
  for (const path of paths) {
    const content = await readRegularFile(root, join(root, checkerPath, path));
    const pathBytes = new TextEncoder().encode(path);
    chunks.push(
      length(pathBytes.length),
      pathBytes,
      length(content.length),
      content,
    );
  }
  return {
    schema: "ousia.rust-checker-build.v1",
    package: "ousia-rust-checker",
    binary: "ousia-rust-checker",
    sourceSha256: await digest.sha256(concat(chunks)),
  };
}

export async function checkRustCheckerIdentity(
  repositoryRoot: string,
): Promise<RustCheckerBuildIdentity> {
  const root = resolve(repositoryRoot);
  const calculated = await calculateRustCheckerIdentity(root);
  const artifact = decodeRustCheckerBuildIdentityJson(
    new TextDecoder().decode(
      await readRegularFile(root, join(root, identityPath)),
    ),
    identityPath,
  );
  const framework = JSON.parse(
    new TextDecoder().decode(
      await readRegularFile(root, join(root, manifestPath)),
    ),
  );
  assertIdentity(artifact, calculated, identityPath);
  assertIdentity(
    decodeRustCheckerBuildIdentity(
      framework.runtime?.rustChecker?.buildIdentity,
      `${manifestPath}.runtime.rustChecker.buildIdentity`,
    ),
    calculated,
    `${manifestPath}.runtime.rustChecker.buildIdentity`,
  );
  if (framework.runtime?.rustChecker?.identityArtifact !== identityPath) {
    throw new Error("framework rustChecker identityArtifact path is invalid");
  }
  return calculated;
}

export async function writeRustCheckerIdentity(
  repositoryRoot: string,
): Promise<RustCheckerBuildIdentity> {
  const root = resolve(repositoryRoot);
  const identity = await calculateRustCheckerIdentity(root);
  await Deno.writeTextFile(
    join(root, identityPath),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
  const frameworkFile = join(root, manifestPath);
  const framework = JSON.parse(await Deno.readTextFile(frameworkFile));
  framework.runtime = {
    rustChecker: { identityArtifact: identityPath, buildIdentity: identity },
  };
  await Deno.writeTextFile(
    frameworkFile,
    `${JSON.stringify(framework, null, 2)}\n`,
  );
  return identity;
}

function validateCargoManifest(text: string): void {
  const value = parse(text) as Record<string, unknown>;
  const pkg = value.package as Record<string, unknown> | undefined;
  const lib = value.lib as Record<string, unknown> | undefined;
  const bins = value.bin as Array<Record<string, unknown>> | undefined;
  if (pkg?.name !== "ousia-rust-checker" || pkg.build !== undefined) {
    throw new Error("checker package identity or build script is invalid");
  }
  if (lib?.name !== "ousia_rust_checker" || lib.path !== "src/lib.rs") {
    throw new Error("checker library identity is invalid");
  }
  if (
    bins?.length !== 1 || bins[0]?.name !== "ousia-rust-checker" ||
    bins[0]?.path !== "src/main.rs"
  ) throw new Error("checker binary identity is invalid");
  rejectWorkspaceOrPath(
    value,
    "Cargo.toml",
    new Set([
      "Cargo.toml.lib.path",
      "Cargo.toml.bin[0].path",
    ]),
  );
}

function rejectWorkspaceOrPath(
  value: unknown,
  path: string,
  allowedPaths: ReadonlySet<string>,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      rejectWorkspaceOrPath(entry, `${path}[${index}]`, allowedPaths)
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (
      key === "workspace" ||
      (key === "path" && !allowedPaths.has(childPath))
    ) {
      throw new Error(`${childPath} is a forbidden Cargo build input`);
    }
    rejectWorkspaceOrPath(child, childPath, allowedPaths);
  }
}

async function rejectUntrackedCargoInputs(root: string): Promise<void> {
  for (
    const path of [
      join(root, "build.rs"),
      join(root, checkerPath, "build.rs"),
      join(root, ".cargo/config"),
      join(root, ".cargo/config.toml"),
      join(root, checkerPath, ".cargo/config"),
      join(root, checkerPath, ".cargo/config.toml"),
    ]
  ) {
    try {
      await Deno.lstat(path);
      throw new Error(`untracked Cargo build input exists: ${path}`);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

async function collectRustSources(
  current: string,
  repositoryRoot: string,
  paths: string[],
): Promise<void> {
  await assertSafeAncestors(repositoryRoot, current);
  const info = await Deno.lstat(current);
  if (!info.isDirectory || info.isSymlink) {
    throw new Error("checker src must be a regular directory");
  }
  for await (const entry of Deno.readDir(current)) {
    const absolute = join(current, entry.name);
    const child = await Deno.lstat(absolute);
    if (child.isSymlink || (!child.isFile && !child.isDirectory)) {
      throw new Error(`checker source contains unsupported entry: ${absolute}`);
    }
    if (child.isDirectory) {
      await collectRustSources(absolute, repositoryRoot, paths);
    } else {
      paths.push(
        relative(join(repositoryRoot, checkerPath), absolute).split(SEPARATOR)
          .join("/"),
      );
    }
  }
}

async function readRegularFile(
  root: string,
  path: string,
): Promise<Uint8Array> {
  await assertSafeAncestors(root, path);
  const info = await Deno.lstat(path);
  if (!info.isFile || info.isSymlink) {
    throw new Error(`expected regular file: ${path}`);
  }
  return await Deno.readFile(path);
}

async function assertSafeAncestors(root: string, path: string): Promise<void> {
  const suffix = relative(root, path);
  if (
    suffix === ".." || suffix.startsWith(`..${SEPARATOR}`) ||
    suffix.startsWith(SEPARATOR)
  ) throw new Error(`identity input escapes repository: ${path}`);
  let current = root;
  await assertRegularDirectory(root, current);
  for (const part of dirname(suffix).split(SEPARATOR).filter(Boolean)) {
    current = join(current, part);
    await assertRegularDirectory(root, current);
  }
}

async function assertRegularDirectory(
  root: string,
  path: string,
): Promise<void> {
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isDirectory) {
    throw new Error(
      `identity directory is not regular: ${path} (root ${root})`,
    );
  }
}

function assertIdentity(
  actual: unknown,
  expected: RustCheckerBuildIdentity,
  path: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} does not match current checker build inputs`);
  }
}

function length(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
