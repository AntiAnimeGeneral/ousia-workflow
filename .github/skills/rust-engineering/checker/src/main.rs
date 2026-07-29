mod cli;

use std::io::Write;

use clap::Parser;

use cli::{Cli, Mode};

#[doc = "ousia: ownerless-fn process entry"]
fn main() {
    let command = match Cli::parse().mode() {
        Mode::Check { cargo_inputs } => {
            complete_check(ousia_rust_checker::check_cargo_inputs(&cargo_inputs))
        }
        Mode::CheckProject { project_root } => complete_project_check(&project_root),
        Mode::Identity => complete_report(ousia_rust_checker::build_identity_json()),
        Mode::FunctionUsageReport { cargo_inputs } => {
            complete_report(ousia_rust_checker::report_function_usage(&cargo_inputs))
        }
        Mode::ModuleLayoutReport { cargo_inputs } => {
            complete_report(ousia_rust_checker::report_module_layout(&cargo_inputs))
        }
        Mode::TestInventoryReport {
            cargo_inputs,
            format,
        } => complete_report(ousia_rust_checker::report_test_inventory(
            &cargo_inputs,
            format,
        )),
        Mode::ZeroFieldTypesReport { cargo_inputs } => {
            complete_report(ousia_rust_checker::report_zero_field_types(&cargo_inputs))
        }
    };
    match command {
        Ok(command) => commit(command),
        Err(error) => commit(CompletedCommand::fatal(error)),
    }
}

struct CompletedCommand {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: i32,
}

#[doc = "ousia: ownerless-fn CLI orchestration"]
fn complete_project_check(
    project_root: &std::path::Path,
) -> Result<CompletedCommand, ousia_rust_checker::FatalError> {
    match ousia_rust_checker::check_project(project_root) {
        Ok(ousia_rust_checker::ProjectCheckResult::Checked(outcome)) => {
            Ok(CompletedCommand::check(outcome))
        }
        Ok(ousia_rust_checker::ProjectCheckResult::NotApplicable) => Ok(CompletedCommand::success(
            "NOT APPLICABLE: no Rust project subject configured\n",
        )),
        Err(error) => Err(error),
    }
}

#[doc = "ousia: ownerless-fn CLI orchestration"]
fn complete_check(
    outcome: Result<ousia_rust_checker::CheckOutcome, ousia_rust_checker::FatalError>,
) -> Result<CompletedCommand, ousia_rust_checker::FatalError> {
    outcome.map(CompletedCommand::check)
}

#[doc = "ousia: ownerless-fn CLI orchestration"]
fn complete_report(
    report: Result<String, ousia_rust_checker::FatalError>,
) -> Result<CompletedCommand, ousia_rust_checker::FatalError> {
    report.map(CompletedCommand::success)
}

impl CompletedCommand {
    fn success(stdout: impl Into<Vec<u8>>) -> Self {
        Self {
            stdout: stdout.into(),
            stderr: Vec::new(),
            exit_code: 0,
        }
    }

    fn check(outcome: ousia_rust_checker::CheckOutcome) -> Self {
        match outcome {
            ousia_rust_checker::CheckOutcome::Passed => Self::success("OK: Rust checker passed\n"),
            ousia_rust_checker::CheckOutcome::Invalid(diagnostics) => Self {
                stdout: Vec::new(),
                stderr: diagnostics
                    .into_iter()
                    .map(|diagnostic| format!("{diagnostic}\n"))
                    .collect::<String>()
                    .into_bytes(),
                exit_code: 1,
            },
        }
    }

    fn fatal(error: ousia_rust_checker::FatalError) -> Self {
        Self {
            stdout: Vec::new(),
            stderr: format!("error: {error}\n").into_bytes(),
            exit_code: 2,
        }
    }
}

#[doc = "ousia: ownerless-fn output commit boundary"]
fn commit(command: CompletedCommand) -> ! {
    let result = std::io::stdout().lock().write_all(&command.stdout);
    if let Err(error) = result {
        commit_failure(error);
    }
    if let Err(error) = std::io::stderr().lock().write_all(&command.stderr) {
        commit_failure(error);
    }
    std::process::exit(command.exit_code);
}

#[doc = "ousia: ownerless-fn output commit failure boundary"]
fn commit_failure(error: std::io::Error) -> ! {
    let fatal = ousia_rust_checker::FatalError::output_commit(error);
    let _ = std::io::stderr()
        .lock()
        .write_all(format!("error: {fatal}\n").as_bytes());
    std::process::exit(2);
}
