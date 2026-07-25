use super::FunctionUsageReport;
use crate::crate_ast::ParsedCrateSet;
use crate::source_files::SourceSet;

#[test]
fn function_usage_report_reports_module_level_callers() {
    let root =
        std::env::temp_dir().join(format!("ousia-rust-checker-report-{}", std::process::id(),));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        r#"mod child;
use crate::child::leaf as imported_leaf;

fn root() {
    helper();
    child::leaf();
    imported_leaf();
}

fn helper() {
    self::root_leaf();
}

fn root_leaf() {}
"#,
    )
    .expect("write lib source fixture");
    std::fs::write(
        root.join("src/child.rs"),
        r#"pub fn leaf() {
    super::helper();
    local();
}

fn local() {}
"#,
    )
    .expect("write child source fixture");

    let sources =
        SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover report source set");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse report source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.starts_with("used_by_functions\ttarget\tfunction\tcallers\tlocation\n"));
    assert!(report.contains("1\tfixture:lib:fixture\tfixture::child::leaf\tfixture::root"));
    assert!(report.contains("1\tfixture:lib:fixture\tfixture::child::local\tfixture::child::leaf"));
    assert!(
        report.contains(
            "2\tfixture:lib:fixture\tfixture::helper\tfixture::child::leaf,fixture::root"
        )
    );
    assert!(report.contains("1\tfixture:lib:fixture\tfixture::root_leaf\tfixture::helper"));
    assert!(report.contains("0\tfixture:lib:fixture\tfixture::root\t"));
    assert!(!report.contains("analysis pending"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_keeps_cargo_targets_separate() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-targets-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src/bin")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        "fn entry() { shared(); }\nfn shared() {}\n",
    )
    .expect("write lib source fixture");
    std::fs::write(
        root.join("src/main.rs"),
        "fn main() { shared(); }\nfn shared() {}\n",
    )
    .expect("write main source fixture");
    std::fs::write(
        root.join("src/bin/tool.rs"),
        "fn main() { shared(); }\nfn shared() {}\n",
    )
    .expect("write bin source fixture");

    let sources =
        SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover report source set");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse report source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::shared\tfixture::entry"));
    assert!(report.contains("1\tfixture:bin:fixture\tfixture::shared\tfixture::main"));
    assert!(report.contains("1\tfixture:bin:tool\tfixture::shared\tfixture::main"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_counts_bin_to_lib_crate_path_calls() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-bin-lib-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        "pub fn check_paths() {}\npub fn report_function_usage() {}\n",
    )
    .expect("write lib source fixture");
    std::fs::write(
        root.join("src/main.rs"),
        "fn main() { fixture::check_paths(); fixture::report_function_usage(); }\n",
    )
    .expect("write main source fixture");

    let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::check_paths\tfixture::main"));
    assert!(
        report.contains("1\tfixture:lib:fixture\tfixture::report_function_usage\tfixture::main")
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_resolves_module_rename_imports() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-module-alias-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        "mod child;\nuse crate::child as c;\nfn root() { c::leaf(); }\n",
    )
    .expect("write lib source fixture");
    std::fs::write(root.join("src/child.rs"), "pub fn leaf() {}\n")
        .expect("write child source fixture");

    let sources =
        SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover report source set");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse report source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::child::leaf\tfixture::root"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_counts_impl_and_trait_default_callers() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-callables-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        r#"fn shared() {}
struct Service;

impl Service {
    fn run() {
        shared();
        Self::helper();
    }

    fn helper() {}
}

trait Workflow {
    fn execute() {
        shared();
    }
}
"#,
    )
    .expect("write lib source fixture");

    let sources =
        SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover report source set");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse report source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.contains(
        "2\tfixture:lib:fixture\tfixture::shared\tfixture::Service::run,fixture::Workflow::execute",
    ));
    assert!(
        report
            .lines()
            .skip(1)
            .all(|line| line.split('\t').nth(2) != Some("fixture::Service::helper"))
    );
    assert!(
        report
            .lines()
            .skip(1)
            .all(|line| line.split('\t').nth(2) != Some("fixture::Service::run"))
    );
    assert!(
        report
            .lines()
            .skip(1)
            .all(|line| line.split('\t').nth(2) != Some("fixture::Workflow::execute"))
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_counts_function_item_path_references() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-function-items-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        r#"mod markers;

fn root(values: &[u8]) -> Vec<u8> {
    values.iter().filter_map(markers::parse).collect()
}
"#,
    )
    .expect("write lib source fixture");
    std::fs::write(
        root.join("src/markers.rs"),
        "pub fn parse(value: &u8) -> Option<u8> { Some(*value) }\n",
    )
    .expect("write markers source fixture");

    let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::markers::parse\tfixture::root"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_counts_module_path_calls_from_impl_methods() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-impl-module-path-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        r#"mod markers;

struct Checker;

impl Checker {
    fn run() {
        markers::parse();
    }
}
"#,
    )
    .expect("write lib source fixture");
    std::fs::write(root.join("src/markers.rs"), "pub fn parse() {}\n")
        .expect("write markers source fixture");

    let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(
        report.contains("1\tfixture:lib:fixture\tfixture::markers::parse\tfixture::Checker::run")
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_resolves_grouped_self_module_imports() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-grouped-self-import-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(root.join("src/lib.rs"), "pub mod markers;\npub mod rule;\n")
        .expect("write lib source fixture");
    std::fs::write(root.join("src/markers.rs"), "pub fn parse() {}\n")
        .expect("write markers source fixture");
    std::fs::write(
        root.join("src/rule.rs"),
        r#"use crate::markers::{self, parse as renamed_parse};

struct Checker;

impl Checker {
    fn run() {
        markers::parse();
        renamed_parse();
    }
}
"#,
    )
    .expect("write rule source fixture");

    let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(
        report.contains(
            "1\tfixture:lib:fixture\tfixture::markers::parse\tfixture::rule::Checker::run"
        )
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_sorts_by_global_usage_count() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-sort-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(
        root.join("src/lib.rs"),
        r#"fn hot() {}
fn warm() {}
fn cold() {}

fn first() {
    hot();
    warm();
}

fn second() {
    hot();
}

struct Service;

impl Service {
    fn third() {
        hot();
    }
}
"#,
    )
    .expect("write lib source fixture");

    let sources =
        SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover report source set");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse report source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");
    let rows = report.lines().skip(1).collect::<Vec<_>>();

    assert!(rows[0].starts_with("3\tfixture:lib:fixture\tfixture::hot\t"));
    assert!(rows[1].starts_with("1\tfixture:lib:fixture\tfixture::warm\t"));
    assert!(
        rows.iter()
            .any(|row| row.starts_with("0\tfixture:lib:fixture\tfixture::cold\t"))
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_keeps_workspace_packages_separate() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-workspace-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("first/src/bin")).expect("create first package fixture");
    std::fs::create_dir_all(root.join("second/src/bin")).expect("create second package fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[workspace]\nmembers = [\"first\", \"second\"]\nresolver = \"3\"\n",
    )
    .expect("write workspace fixture");
    for package in ["first", "second"] {
        std::fs::write(
            root.join(package).join("Cargo.toml"),
            format!("[package]\nname = \"{package}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"),
        )
        .expect("write package cargo fixture");
        std::fs::write(
            root.join(package).join("src/bin/tool.rs"),
            "fn main() { shared(); }\nfn shared() {}\n",
        )
        .expect("write bin source fixture");
    }

    let sources =
        SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover report source set");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse report source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.contains("1\tfirst:bin:tool\tfirst::shared\tfirst::main"));
    assert!(report.contains("1\tsecond:bin:tool\tsecond::shared\tsecond::main"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

#[test]
fn function_usage_report_keeps_non_cargo_roots_separate() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-source-roots-{}",
        std::process::id(),
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("first")).expect("create first source fixture");
    std::fs::create_dir_all(root.join("second")).expect("create second source fixture");
    for directory in ["first", "second"] {
        std::fs::write(
            root.join(directory).join("lib.rs"),
            "fn entry() { shared(); }\nfn shared() {}\n",
        )
        .expect("write source fixture");
    }

    let sources = SourceSet::discover(&[root.join("first/lib.rs"), root.join("second/lib.rs")])
        .expect("discover report source set");
    let parsed = ParsedCrateSet::parse(&sources).expect("parse report source set");
    let report = FunctionUsageReport::build(&parsed).expect("build report");

    assert!(report.contains(&format!(
        "1\tsource:{}\tsource::shared\tsource::entry",
        root.join("first/lib.rs").display(),
    )));
    assert!(report.contains(&format!(
        "1\tsource:{}\tsource::shared\tsource::entry",
        root.join("second/lib.rs").display(),
    )));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}
