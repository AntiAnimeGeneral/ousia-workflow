#![doc = "ousia: module-owner rust-checker-cli-entry"]

mod cli;

use clap::Parser;

use cli::{Cli, Mode};

fn main() {
    match Cli::parse().mode() {
        Mode::Check { paths } => run_check(&paths),
        Mode::FunctionUsageReport { paths } => run_function_usage_report(&paths),
        Mode::ModuleLayoutReport { paths } => run_module_layout_report(&paths),
    }
}

fn run_check(paths: &[std::path::PathBuf]) {
    match checker::check_paths(paths) {
        Ok(diagnostics) => {
            for diagnostic in &diagnostics {
                eprintln!("{diagnostic}");
            }
            if diagnostics.is_empty() {
                println!("OK: Rust checker passed");
            } else {
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("error: {error}");
            std::process::exit(2);
        }
    }
}

fn run_function_usage_report(paths: &[std::path::PathBuf]) {
    match checker::report_function_usage(paths) {
        Ok(report) => print!("{report}"),
        Err(error) => {
            eprintln!("error: {error}");
            std::process::exit(2);
        }
    }
}

fn run_module_layout_report(paths: &[std::path::PathBuf]) {
    match checker::report_module_layout(paths) {
        Ok(report) => print!("{report}"),
        Err(error) => {
            eprintln!("error: {error}");
            std::process::exit(2);
        }
    }
}
