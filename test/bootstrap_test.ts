import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  type BootstrapCommand,
  type BootstrapCommandResult,
  BootstrapError,
  bootstrapMachineTools,
} from "../scripts/install.ts";
import { checkRustCheckerIdentity } from "../scripts/rust-checker-identity.ts";
import * as projectFixture from "./project-fixture.ts";

Deno.test(
  "bootstrap installs checker before CLI with fixed locators",
  async () => {
    // Goal: protect the fixed checker-first machine bootstrap and least-privilege CLI command plan.
    // Scope: integration, importable bootstrap orchestration with a command side-effect adapter.
    // Semantics: Cargo, installed identity, and Deno run once in order without --root, cargo run, or a second locator.
    const expected = await checkRustCheckerIdentity(projectFixture.repoRoot);
    const calls: BootstrapCommand[] = [];
    const result = await bootstrapMachineTools({
      packageRoot: projectFixture.repoRoot,
      denoExecutable: "/test/deno",
      runCommand: (command) => {
        calls.push(command);
        return Promise.resolve(success(
          command.command === "ousia-rust-checker"
            ? JSON.stringify(expected)
            : "",
        ));
      },
    });

    assertEquals(result, {
      checkerState: "verified-installed",
      cliState: "installed",
    });
    assertEquals(calls.map((call) => call.command), [
      "cargo",
      "ousia-rust-checker",
      "/test/deno",
    ]);
    assertEquals(calls[0].args.includes("--root"), false);
    assertEquals(calls[0].args.includes("run"), false);
    assertEquals(calls[0].args.slice(-2), ["--bin", "ousia-rust-checker"]);
    assertEquals(
      calls[2].args.filter((argument) => argument.startsWith("--allow-run")),
      ["--allow-run=ousia-rust-checker"],
    );
  },
);

Deno.test(
  "bootstrap preflight failure runs no machine command",
  async () => {
    // Goal: keep every machine install side effect behind complete source preflight.
    // Scope: integration, bootstrap checkout validation with a missing CLI source.
    // Semantics: preflight returns a typed unchanged-state error and the command adapter is never invoked.
    const root = await Deno.makeTempDir();
    let calls = 0;
    const error = await assertRejects(
      () =>
        bootstrapMachineTools({
          packageRoot: root,
          runCommand: () => {
            calls++;
            return Promise.resolve(success());
          },
        }),
      BootstrapError,
    );

    assertEquals(error.phase, "preflight");
    assertEquals(error.code, "bootstrap-preflight-failed");
    assertEquals(error.checkerState, "unchanged");
    assertEquals(error.cliState, "unchanged");
    assertEquals(calls, 0);
  },
);

Deno.test(
  "bootstrap rejects a symlinked checker ancestor before commands",
  async () => {
    // Goal: prevent Cargo from installing checker source reached through a checkout symlink ancestor.
    // Scope: integration, bootstrap path-confinement preflight over a symlinked .github directory.
    // Semantics: preflight reports unchanged machine state and invokes no Cargo, checker, or Deno command.
    const root = await Deno.makeTempDir();
    await Deno.symlink(
      join(projectFixture.repoRoot, ".github"),
      join(root, ".github"),
    );
    await Deno.symlink(
      join(projectFixture.repoRoot, ".ousia"),
      join(root, ".ousia"),
    );
    await Deno.symlink(
      join(projectFixture.repoRoot, "src"),
      join(root, "src"),
    );
    await Deno.copyFile(
      join(projectFixture.repoRoot, "deno.json"),
      join(root, "deno.json"),
    );
    let calls = 0;

    const error = await assertRejects(
      () =>
        bootstrapMachineTools({
          packageRoot: root,
          runCommand: () => {
            calls++;
            return Promise.resolve(success());
          },
        }),
      BootstrapError,
    );

    assertEquals(error.phase, "preflight");
    assertEquals(error.checkerState, "unchanged");
    assertEquals(error.cliState, "unchanged");
    assertEquals(calls, 0);
  },
);

Deno.test(
  "bootstrap Cargo failure stops before identity and CLI",
  async () => {
    // Goal: prevent CLI replacement when the checker install phase fails.
    // Scope: integration, checker-first bootstrap failure boundary.
    // Semantics: only Cargo runs and the typed diagnostic reports both checker and CLI as uncommitted.
    const calls: BootstrapCommand[] = [];
    const error = await assertRejects(
      () =>
        bootstrapMachineTools({
          packageRoot: projectFixture.repoRoot,
          runCommand: (command) => {
            calls.push(command);
            return Promise.resolve(failure(17, "cargo failed"));
          },
        }),
      BootstrapError,
    );

    assertEquals(error.phase, "install-rust-checker");
    assertEquals(error.code, "bootstrap-install-rust-checker-failed");
    assertEquals(error.checkerState, "unknown");
    assertEquals(error.cliState, "unchanged");
    assertEquals(error.stderr, "cargo failed");
    assertEquals(calls.map((call) => call.command), ["cargo"]);
  },
);

Deno.test(
  "bootstrap identity mismatch stops before CLI",
  async () => {
    // Goal: reject an installed checker generation that differs from the source authority.
    // Scope: contract, Cargo success followed by strict installed identity comparison.
    // Semantics: Cargo and the sole PATH locator run, Deno does not run, and old CLI state remains unchanged.
    const calls: BootstrapCommand[] = [];
    const error = await assertRejects(
      () =>
        bootstrapMachineTools({
          packageRoot: projectFixture.repoRoot,
          runCommand: (command) => {
            calls.push(command);
            if (command.command === "ousia-rust-checker") {
              return Promise.resolve(success(JSON.stringify({
                schema: "ousia.rust-checker-build.v1",
                package: "ousia-rust-checker",
                binary: "ousia-rust-checker",
                sourceSha256: "0".repeat(64),
              })));
            }
            return Promise.resolve(success());
          },
        }),
      BootstrapError,
    );

    assertEquals(error.phase, "install-rust-checker");
    assertEquals(error.code, "bootstrap-checker-identity-mismatch");
    assertEquals(error.checkerState, "unknown");
    assertEquals(error.cliState, "unchanged");
    assertEquals(calls.map((call) => call.command), [
      "cargo",
      "ousia-rust-checker",
    ]);
  },
);

Deno.test(
  "bootstrap CLI failure reports checker complete and CLI unknown",
  async () => {
    // Goal: expose the non-atomic cross-package-manager partial failure without a fake rollback claim.
    // Scope: integration, successful Cargo and identity phases followed by Deno failure.
    // Semantics: the typed error preserves Deno stderr and reports checker installed with CLI state unknown.
    const expected = await checkRustCheckerIdentity(projectFixture.repoRoot);
    const error = await assertRejects(
      () =>
        bootstrapMachineTools({
          packageRoot: projectFixture.repoRoot,
          runCommand: (command) => {
            if (command.command === "ousia-rust-checker") {
              return Promise.resolve(success(JSON.stringify(expected)));
            }
            if (command.command === "cargo") return Promise.resolve(success());
            return Promise.resolve(failure(23, "deno failed"));
          },
        }),
      BootstrapError,
    );

    assertEquals(error.phase, "install-cli");
    assertEquals(error.code, "bootstrap-install-cli-failed");
    assertEquals(error.checkerState, "verified-installed");
    assertEquals(error.cliState, "unknown");
    assertEquals(error.stderr, "deno failed");
  },
);

Deno.test(
  "bootstrap CLI spawn failure preserves unchanged CLI state",
  async () => {
    // Goal: distinguish a Deno command that never started from a process that may have partially replaced the CLI.
    // Scope: integration, install-cli command spawn boundary after verified checker identity.
    // Semantics: the typed error reports checker verified-installed and CLI unchanged.
    const expected = await checkRustCheckerIdentity(projectFixture.repoRoot);
    const error = await assertRejects(
      () =>
        bootstrapMachineTools({
          packageRoot: projectFixture.repoRoot,
          runCommand: (command) => {
            if (command.command === "cargo") return Promise.resolve(success());
            if (command.command === "ousia-rust-checker") {
              return Promise.resolve(success(JSON.stringify(expected)));
            }
            throw new Error("deno missing");
          },
        }),
      BootstrapError,
    );

    assertEquals(error.phase, "install-cli");
    assertEquals(error.code, "bootstrap-install-cli-missing");
    assertEquals(error.checkerState, "verified-installed");
    assertEquals(error.cliState, "unchanged");
  },
);

Deno.test(
  "bootstrap process renders typed partial-state diagnostic",
  async () => {
    // Goal: expose one machine-readable diagnostic across every real script partial-failure phase.
    // Scope: contract, scripts/install.ts process with spawn, identity, and Deno failure inputs.
    // Semantics: each process exits nonzero with JSON-only stderr and preserves exact phase, states, and child stderr.
    const expected = await checkRustCheckerIdentity(projectFixture.repoRoot);
    const cases: {
      label: string;
      script: string;
      env: Record<string, string>;
      code: string;
      checkerState: string;
      cliState: string;
      stderr: string;
    }[] = [
      {
        label: "cargo spawn",
        script: join(projectFixture.repoRoot, "scripts/install.ts"),
        env: { PATH: "" },
        code: "bootstrap-install-rust-checker-missing",
        checkerState: "unchanged",
        cliState: "unchanged",
        stderr: "",
      },
      {
        label: "identity after noisy cargo",
        script: join(
          projectFixture.repoRoot,
          "test/bootstrap-process-fixture.ts",
        ),
        env: {
          OUSIA_BOOTSTRAP_TEST_FIXTURE: JSON.stringify({
            cargo: { success: true, code: 0, stderr: "cargo progress" },
            identity: {
              success: false,
              code: 19,
              stderr: "identity failed",
            },
            deno: { success: true, code: 0 },
          }),
        },
        code: "bootstrap-checker-identity-failed",
        checkerState: "unknown",
        cliState: "unchanged",
        stderr: "identity failed",
      },
      {
        label: "deno after verified checker",
        script: join(
          projectFixture.repoRoot,
          "test/bootstrap-process-fixture.ts",
        ),
        env: {
          OUSIA_BOOTSTRAP_TEST_FIXTURE: JSON.stringify({
            cargo: { success: true, code: 0, stderr: "cargo progress" },
            identity: {
              success: true,
              code: 0,
              stdout: JSON.stringify(expected),
            },
            deno: { success: false, code: 23, stderr: "deno failed" },
          }),
        },
        code: "bootstrap-install-cli-failed",
        checkerState: "verified-installed",
        cliState: "unknown",
        stderr: "deno failed",
      },
    ];
    for (const testCase of cases) {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-run",
          "--allow-env",
          "--allow-sys=uid",
          testCase.script,
        ],
        cwd: projectFixture.repoRoot,
        env: testCase.env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const diagnostic = JSON.parse(new TextDecoder().decode(output.stderr));

      assertEquals(output.success, false, testCase.label);
      assertEquals(diagnostic.code, testCase.code, testCase.label);
      assertEquals(
        diagnostic.checkerState,
        testCase.checkerState,
        testCase.label,
      );
      assertEquals(diagnostic.cliState, testCase.cliState, testCase.label);
      assertEquals(diagnostic.stderr, testCase.stderr, testCase.label);
      assertEquals(typeof diagnostic.remediation, "string", testCase.label);
      assertEquals(new TextDecoder().decode(output.stdout), "", testCase.label);
    }
  },
);

function success(stdout = ""): BootstrapCommandResult {
  return {
    success: true,
    code: 0,
    stdout: new TextEncoder().encode(stdout),
    stderr: new Uint8Array(),
  };
}

function failure(code: number, stderr: string): BootstrapCommandResult {
  return {
    success: false,
    code,
    stdout: new Uint8Array(),
    stderr: new TextEncoder().encode(stderr),
  };
}
