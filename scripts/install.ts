import {
  dirname,
  fromFileUrl,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import {
  checkRustCheckerIdentity,
  decodeRustCheckerBuildIdentityJson,
  type RustCheckerBuildIdentity,
} from "./rust-checker-identity.ts";

export type BootstrapPhase =
  | "preflight"
  | "install-rust-checker"
  | "install-cli";
export interface BootstrapResult {
  checkerState: "verified-installed";
  cliState: "installed";
}
export interface BootstrapCommand {
  command: string;
  args: string[];
  cwd: string;
}
export interface BootstrapCommandResult {
  success: boolean;
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}
export interface BootstrapOptions {
  packageRoot?: string;
  runCommand?: (
    command: BootstrapCommand,
  ) => Promise<BootstrapCommandResult>;
  denoExecutable?: string;
}
export interface BootstrapProcessOutput {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}
export class BootstrapError extends Error {
  constructor(
    readonly phase: BootstrapPhase,
    readonly code: string,
    readonly checkerState: "unchanged" | "verified-installed" | "unknown",
    readonly cliState: "unchanged" | "installed" | "unknown",
    readonly stderr: string,
    readonly remediation: string,
    readonly evidence: Record<string, string>,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "BootstrapError";
  }
}

export async function bootstrapMachineTools(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const packageRoot = resolve(options.packageRoot ?? defaultPackageRoot());
  const runCommand = options.runCommand ?? defaultRunCommand;
  let expected: RustCheckerBuildIdentity;
  let commands: { cargo: BootstrapCommand; deno: BootstrapCommand };
  try {
    expected = await checkRustCheckerIdentity(packageRoot);
    commands = await bootstrapPreflight(
      packageRoot,
      options.denoExecutable ?? Deno.execPath(),
    );
  } catch (error) {
    throw new BootstrapError(
      "preflight",
      "bootstrap-preflight-failed",
      "unchanged",
      "unchanged",
      "",
      "修复source checkout、build identity或固定bootstrap输入后重试。",
      { packageRoot },
      `machine bootstrap preflight failed: ${error}`,
      error,
    );
  }

  const cargo = await executeBootstrapCommand(
    runCommand,
    commands.cargo,
    "install-rust-checker",
    "unchanged",
    "unchanged",
  );

  let identity: BootstrapCommandResult;
  try {
    identity = await runCommand({
      command: "ousia-rust-checker",
      args: ["identity", "--format", "json"],
      cwd: packageRoot,
    });
  } catch (error) {
    throw new BootstrapError(
      "install-rust-checker",
      "bootstrap-checker-identity-missing",
      "unknown",
      "unchanged",
      "",
      "确保 `ousia-rust-checker` 已进入PATH并与当前source identity一致后重试。",
      { locator: "ousia-rust-checker" },
      `installed checker identity could not run: ${error}`,
      error,
    );
  }
  if (!identity.success) {
    throw commandFailure(
      "install-rust-checker",
      "bootstrap-checker-identity-failed",
      "unknown",
      "unchanged",
      identity,
      "installed checker identity command failed",
    );
  }
  const actual = decodeRustCheckerIdentity(identity.stdout);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new BootstrapError(
      "install-rust-checker",
      "bootstrap-checker-identity-mismatch",
      "unknown",
      "unchanged",
      decode(identity.stderr),
      "重新运行checker安装并确认PATH未被其他generation遮蔽。",
      {
        expectedSourceSha256: expected.sourceSha256,
        actualSourceSha256: actual.sourceSha256,
      },
      "installed checker identity does not match current source",
    );
  }

  const deno = await executeBootstrapCommand(
    runCommand,
    commands.deno,
    "install-cli",
    "verified-installed",
    "unchanged",
  );
  printOutput(cargo);
  printOutput(deno);
  return { checkerState: "verified-installed", cliState: "installed" };
}

async function bootstrapPreflight(
  packageRoot: string,
  denoExecutable: string,
): Promise<{ cargo: BootstrapCommand; deno: BootstrapCommand }> {
  const checkerRoot = join(
    packageRoot,
    ".github/skills/rust-engineering/checker",
  );
  for (
    const path of [
      join(checkerRoot, "Cargo.toml"),
      join(checkerRoot, "Cargo.lock"),
      join(packageRoot, "deno.json"),
      join(packageRoot, "src/cli.ts"),
    ]
  ) await assertRegularCheckoutFile(packageRoot, path);

  const cargo: BootstrapCommand = {
    command: "cargo",
    args: [
      "install",
      "--locked",
      "--force",
      "--path",
      checkerRoot,
      "--bin",
      "ousia-rust-checker",
    ],
    cwd: packageRoot,
  };
  const deno: BootstrapCommand = {
    command: denoExecutable,
    args: [
      "install",
      "--global",
      "--force",
      "--config",
      join(packageRoot, "deno.json"),
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-sys=uid",
      "--allow-run=ousia-rust-checker",
      "--name",
      "ousia",
      join(packageRoot, "src/cli.ts"),
    ],
    cwd: packageRoot,
  };
  assertFixedCommandPlan(cargo, deno);
  return { cargo, deno };
}

async function assertRegularCheckoutFile(
  root: string,
  path: string,
): Promise<void> {
  const suffix = relative(root, path);
  if (
    suffix === "" || suffix === ".." ||
    suffix.startsWith(`..${SEPARATOR}`)
  ) throw new Error(`bootstrap path escapes checkout: ${path}`);
  const rootInfo = await Deno.lstat(root);
  if (rootInfo.isSymlink || !rootInfo.isDirectory) {
    throw new Error(
      `bootstrap checkout root must be a regular directory: ${root}`,
    );
  }
  let current = root;
  for (const part of dirname(suffix).split(SEPARATOR).filter(Boolean)) {
    current = join(current, part);
    const ancestor = await Deno.lstat(current);
    if (ancestor.isSymlink || !ancestor.isDirectory) {
      throw new Error(`bootstrap input ancestor must be regular: ${current}`);
    }
  }
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isFile) {
    throw new Error(`bootstrap input must be a regular file: ${path}`);
  }
}

function assertFixedCommandPlan(
  cargo: BootstrapCommand,
  deno: BootstrapCommand,
): void {
  const all = [cargo.command, ...cargo.args, deno.command, ...deno.args];
  if (
    cargo.command !== "cargo" || cargo.args.includes("--root") ||
    cargo.args.includes("run") ||
    cargo.args[cargo.args.length - 1] !== "ousia-rust-checker" ||
    !deno.args.includes("--allow-run=ousia-rust-checker") ||
    all.includes("checker")
  ) {
    throw new Error(
      "bootstrap command plan violates the fixed locator contract",
    );
  }
}

async function executeBootstrapCommand(
  runCommand: NonNullable<BootstrapOptions["runCommand"]>,
  command: BootstrapCommand,
  phase: BootstrapPhase,
  checkerState: "unchanged" | "verified-installed" | "unknown",
  cliSpawnState: "unchanged" | "unknown",
): Promise<BootstrapCommandResult> {
  let output: BootstrapCommandResult;
  try {
    output = await runCommand(command);
  } catch (error) {
    throw new BootstrapError(
      phase,
      `bootstrap-${phase}-missing`,
      checkerState,
      "unchanged",
      "",
      `确保 ${command.command} 可执行后重试；未启动的阶段保持unchanged。`,
      { command: command.command },
      `${command.command} could not run: ${error}`,
      error,
    );
  }
  if (!output.success) {
    throw commandFailure(
      phase,
      `bootstrap-${phase}-failed`,
      phase === "install-rust-checker" ? "unknown" : checkerState,
      cliSpawnState === "unchanged" && phase === "install-cli"
        ? "unknown"
        : cliSpawnState,
      output,
      `${command.command} ${command.args.join(" ")} failed`,
    );
  }
  return output;
}

function commandFailure(
  phase: BootstrapPhase,
  code: string,
  checkerState: "unchanged" | "verified-installed" | "unknown",
  cliState: "unchanged" | "unknown",
  output: BootstrapCommandResult,
  message: string,
): BootstrapError {
  return new BootstrapError(
    phase,
    code,
    checkerState,
    cliState,
    decode(output.stderr),
    phase === "install-cli"
      ? "修复Deno安装失败后重试；checker已验证时无需回滚。"
      : "修复Cargo/checker安装失败后重试；不要继续安装CLI。",
    {
      command: message.split(" failed")[0],
      exitCode: output.code.toString(),
      stderr: decode(output.stderr),
    },
    `${message} (exit ${output.code})`,
  );
}

function decodeRustCheckerIdentity(
  bytes: Uint8Array,
): RustCheckerBuildIdentity {
  try {
    return decodeRustCheckerBuildIdentityJson(
      decode(bytes),
      "installed checker identity",
    );
  } catch (error) {
    throw new BootstrapError(
      "install-rust-checker",
      "bootstrap-checker-identity-invalid",
      "unknown",
      "unchanged",
      "",
      "重新安装checker并确认identity命令输出canonical JSON。",
      { locator: "ousia-rust-checker" },
      `installed checker identity is invalid: ${error}`,
      error,
    );
  }
}

function defaultPackageRoot(): string {
  return resolve(dirname(fromFileUrl(import.meta.url)), "..");
}

async function defaultRunCommand(
  command: BootstrapCommand,
): Promise<BootstrapCommandResult> {
  return await new Deno.Command(command.command, {
    args: command.args,
    cwd: command.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function printOutput(output: BootstrapCommandResult): void {
  const stdout = decode(output.stdout);
  const stderr = decode(output.stderr);
  if (stdout.trim()) console.log(stdout.trimEnd());
  if (stderr.trim()) console.error(stderr.trimEnd());
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

export async function runBootstrapProcess(
  options?: BootstrapOptions,
  output: BootstrapProcessOutput = {
    stdout: console.log,
    stderr: console.error,
  },
): Promise<number> {
  try {
    await bootstrapMachineTools(options);
    output.stdout("Installed ousia and ousia-rust-checker.");
    return 0;
  } catch (error) {
    if (!(error instanceof BootstrapError)) throw error;
    output.stderr(JSON.stringify({
      phase: error.phase,
      code: error.code,
      checkerState: error.checkerState,
      cliState: error.cliState,
      stderr: error.stderr,
      message: error.message,
      remediation: error.remediation,
      evidence: error.evidence,
    }));
    return 1;
  }
}

if (import.meta.main) {
  Deno.exitCode = await runBootstrapProcess();
}
