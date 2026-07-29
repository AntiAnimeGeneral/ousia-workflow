import {
  type BootstrapCommandResult,
  runBootstrapProcess,
} from "../scripts/install.ts";

interface ProcessFixture {
  cargo: FixtureResult;
  identity: FixtureResult;
  deno: FixtureResult;
}
interface FixtureResult {
  success: boolean;
  code: number;
  stdout?: string;
  stderr?: string;
}

if (import.meta.main) {
  const fixture = JSON.parse(
    Deno.env.get("OUSIA_BOOTSTRAP_TEST_FIXTURE")!,
  ) as ProcessFixture;
  const result = (entry: FixtureResult): BootstrapCommandResult => ({
    success: entry.success,
    code: entry.code,
    stdout: new TextEncoder().encode(entry.stdout ?? ""),
    stderr: new TextEncoder().encode(entry.stderr ?? ""),
  });
  Deno.exitCode = await runBootstrapProcess({
    runCommand: (command) => {
      if (command.command === "cargo") {
        return Promise.resolve(result(fixture.cargo));
      }
      if (command.command === "ousia-rust-checker") {
        return Promise.resolve(result(fixture.identity));
      }
      return Promise.resolve(result(fixture.deno));
    },
  });
}
