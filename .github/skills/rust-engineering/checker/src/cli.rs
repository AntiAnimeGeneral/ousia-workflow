use std::path::PathBuf;

use clap::Parser;

#[derive(Debug, Parser)]
#[command(name = "checker", about = "Validate Ousia Rust function owner markers")]
pub(crate) struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, clap::Subcommand)]
enum Command {
    Check(CheckArgs),
    #[command(subcommand)]
    Report(ReportCommand),
}

#[derive(Debug, clap::Args)]
struct CheckArgs {
    #[arg(default_value = ".")]
    paths: Vec<PathBuf>,
}

#[derive(Debug, clap::Subcommand)]
enum ReportCommand {
    FunctionUsage(ReportArgs),
    ModuleLayout(ReportArgs),
}

#[derive(Debug, clap::Args)]
struct ReportArgs {
    #[arg(default_value = ".")]
    paths: Vec<PathBuf>,
}

pub(crate) enum Mode {
    Check { paths: Vec<PathBuf> },
    FunctionUsageReport { paths: Vec<PathBuf> },
    ModuleLayoutReport { paths: Vec<PathBuf> },
}

impl Cli {
    pub(crate) fn mode(self) -> Mode {
        match self.command {
            Some(Command::Check(args)) => Mode::Check { paths: args.paths },
            Some(Command::Report(ReportCommand::FunctionUsage(args))) => {
                Mode::FunctionUsageReport { paths: args.paths }
            }
            Some(Command::Report(ReportCommand::ModuleLayout(args))) => {
                Mode::ModuleLayoutReport { paths: args.paths }
            }
            None => Mode::Check {
                paths: vec![PathBuf::from(".")],
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_command_checks_current_directory() {
        let cli = Cli::parse_from(["checker"]);
        assert!(matches!(cli.mode(), Mode::Check { paths } if paths == [PathBuf::from(".")]));
    }

    #[test]
    fn check_command_accepts_paths() {
        let cli = Cli::parse_from(["checker", "check", "src", "tests"]);
        assert!(
            matches!(cli.mode(), Mode::Check { paths } if paths == [PathBuf::from("src"), PathBuf::from("tests")])
        );
    }

    #[test]
    fn report_command_accepts_paths() {
        let cli = Cli::parse_from(["checker", "report", "function-usage", "Cargo.toml"]);
        assert!(
            matches!(cli.mode(), Mode::FunctionUsageReport { paths } if paths == [PathBuf::from("Cargo.toml")])
        );
    }

    #[test]
    fn module_layout_report_command_accepts_paths() {
        let cli = Cli::parse_from(["checker", "report", "module-layout", "Cargo.toml"]);
        assert!(
            matches!(cli.mode(), Mode::ModuleLayoutReport { paths } if paths == [PathBuf::from("Cargo.toml")])
        );
    }
}
