#![doc = "ousia: module-owner rust-checker-api"]

use std::path::PathBuf;

mod crate_ast;
mod diagnostic;
mod engine;
mod markers;
mod report;
mod rules;
mod signature_analysis;
mod source_files;

use diagnostic::Diagnostic;

pub fn check_paths(paths: &[PathBuf]) -> Result<Vec<Diagnostic>, std::io::Error> {
    let sources = source_files::SourceSet::discover(paths)?;
    let parsed = crate_ast::ParsedCrateSet::parse(&sources)?;
    let mut diagnostics = Vec::new();
    for module in parsed.modules() {
        match module.parsed_file() {
            Ok(file) => {
                diagnostics.extend(engine::RuleEngine::new(module.path()).check_file(file));
            }
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }
    Ok(diagnostics)
}

pub fn report_function_usage(paths: &[PathBuf]) -> Result<String, std::io::Error> {
    let sources = source_files::SourceSet::discover(paths)?;
    let parsed = crate_ast::ParsedCrateSet::parse(&sources)?;
    report::FunctionUsageReport::build(&parsed)
}

pub fn report_module_layout(paths: &[PathBuf]) -> Result<String, std::io::Error> {
    let sources = source_files::SourceSet::discover(paths)?;
    let parsed = crate_ast::ParsedCrateSet::parse(&sources)?;
    report::ModuleLayoutReport::build(&parsed)
}
