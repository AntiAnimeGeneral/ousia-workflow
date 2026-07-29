use std::path::PathBuf;

use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "ousia-rust-checker",
    about = "Validate Ousia Rust engineering contracts and produce analysis reports"
)]
pub(crate) struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, clap::Subcommand)]
enum Command {
    Check(CheckArgs),
    CheckProject(CheckProjectArgs),
    Identity(IdentityArgs),
    #[command(subcommand)]
    Report(ReportCommand),
}

#[derive(Debug, clap::Args)]
struct IdentityArgs {
    #[arg(long, value_enum)]
    format: IdentityFormatArg,
}

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
enum IdentityFormatArg {
    Json,
}

#[derive(Debug, clap::Args)]
struct CheckArgs {
    #[arg(
        default_value = ".",
        value_name = "CARGO_INPUT",
        help = "Cargo.toml or a directory directly containing Cargo.toml"
    )]
    cargo_inputs: Vec<PathBuf>,
}

#[derive(Debug, clap::Args)]
struct CheckProjectArgs {
    #[arg(default_value = ".")]
    project_root: PathBuf,
}

#[derive(Debug, clap::Subcommand)]
enum ReportCommand {
    FunctionUsage(ReportArgs),
    ModuleLayout(ReportArgs),
    TestInventory(TestInventoryArgs),
    ZeroFieldTypes(ReportArgs),
}

#[derive(Debug, clap::Args)]
struct ReportArgs {
    #[arg(
        default_value = ".",
        value_name = "CARGO_INPUT",
        help = "Cargo.toml or a directory directly containing Cargo.toml"
    )]
    cargo_inputs: Vec<PathBuf>,
}

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
enum TestInventoryFormatArg {
    Json,
    Markdown,
}

#[derive(Debug, clap::Args)]
struct TestInventoryArgs {
    #[arg(long, value_enum)]
    format: TestInventoryFormatArg,
    #[arg(
        default_value = ".",
        value_name = "CARGO_INPUT",
        help = "Cargo.toml or a directory directly containing Cargo.toml"
    )]
    cargo_inputs: Vec<PathBuf>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Check {
        cargo_inputs: Vec<PathBuf>,
    },
    CheckProject {
        project_root: PathBuf,
    },
    Identity,
    FunctionUsageReport {
        cargo_inputs: Vec<PathBuf>,
    },
    ModuleLayoutReport {
        cargo_inputs: Vec<PathBuf>,
    },
    TestInventoryReport {
        cargo_inputs: Vec<PathBuf>,
        format: ousia_rust_checker::TestInventoryFormat,
    },
    ZeroFieldTypesReport {
        cargo_inputs: Vec<PathBuf>,
    },
}

impl Cli {
    pub(crate) fn mode(self) -> Mode {
        match self.command {
            Some(Command::Check(args)) => Mode::Check {
                cargo_inputs: args.cargo_inputs,
            },
            Some(Command::CheckProject(args)) => Mode::CheckProject {
                project_root: args.project_root,
            },
            Some(Command::Identity(IdentityArgs {
                format: IdentityFormatArg::Json,
            })) => Mode::Identity,
            Some(Command::Report(ReportCommand::FunctionUsage(args))) => {
                Mode::FunctionUsageReport {
                    cargo_inputs: args.cargo_inputs,
                }
            }
            Some(Command::Report(ReportCommand::ModuleLayout(args))) => Mode::ModuleLayoutReport {
                cargo_inputs: args.cargo_inputs,
            },
            Some(Command::Report(ReportCommand::TestInventory(args))) => {
                Mode::TestInventoryReport {
                    cargo_inputs: args.cargo_inputs,
                    format: match args.format {
                        TestInventoryFormatArg::Json => {
                            ousia_rust_checker::TestInventoryFormat::Json
                        }
                        TestInventoryFormatArg::Markdown => {
                            ousia_rust_checker::TestInventoryFormat::Markdown
                        }
                    },
                }
            }
            Some(Command::Report(ReportCommand::ZeroFieldTypes(args))) => {
                Mode::ZeroFieldTypesReport {
                    cargo_inputs: args.cargo_inputs,
                }
            }
            None => Mode::Check {
                cargo_inputs: vec![PathBuf::from(".")],
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    /// Goal: preserve the representative argument routing for each checker mode and inventory format.
    /// Scope: level=contract; boundary=cli::Cli::mode
    /// Semantics: each named argument vector maps to the exact mode, format, root, and ordered paths declared by its case.
    #[rstest]
    #[case::default_check_current_directory(
        &["ousia-rust-checker"],
        Mode::Check { cargo_inputs: vec![PathBuf::from(".")] }
    )]
    #[case::check_multiple_cargo_inputs(
        &["ousia-rust-checker", "check", "left/Cargo.toml", "right"],
        Mode::Check { cargo_inputs: vec![PathBuf::from("left/Cargo.toml"), PathBuf::from("right")] }
    )]
    #[case::function_usage_report(
        &["ousia-rust-checker", "report", "function-usage", "Cargo.toml"],
        Mode::FunctionUsageReport { cargo_inputs: vec![PathBuf::from("Cargo.toml")] }
    )]
    #[case::module_layout_report(
        &["ousia-rust-checker", "report", "module-layout", "Cargo.toml"],
        Mode::ModuleLayoutReport { cargo_inputs: vec![PathBuf::from("Cargo.toml")] }
    )]
    #[case::check_project_root(
        &["ousia-rust-checker", "check-project", "fixture"],
        Mode::CheckProject { project_root: PathBuf::from("fixture") }
    )]
    #[case::test_inventory_markdown(
        &["ousia-rust-checker", "report", "test-inventory", "--format", "markdown", "Cargo.toml"],
        Mode::TestInventoryReport {
            cargo_inputs: vec![PathBuf::from("Cargo.toml")],
            format: ousia_rust_checker::TestInventoryFormat::Markdown,
        }
    )]
    #[case::test_inventory_json(
        &["ousia-rust-checker", "report", "test-inventory", "--format", "json", "fixture"],
        Mode::TestInventoryReport {
            cargo_inputs: vec![PathBuf::from("fixture")],
            format: ousia_rust_checker::TestInventoryFormat::Json,
        }
    )]
    #[case::zero_field_types_report(
        &["ousia-rust-checker", "report", "zero-field-types", "Cargo.toml"],
        Mode::ZeroFieldTypesReport { cargo_inputs: vec![PathBuf::from("Cargo.toml")] }
    )]
    #[case::build_identity(
        &["ousia-rust-checker", "identity", "--format", "json"],
        Mode::Identity
    )]
    fn cli_mode_parsing(#[case] arguments: &[&str], #[case] expected: Mode) {
        assert_eq!(Cli::parse_from(arguments).mode(), expected);
    }
}
