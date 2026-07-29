use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

use rstest::rstest;

const VALID_TEST: &str = r#"
/// Goal: preserve a valid source test contract.
/// Scope: level=unit; boundary=fixture::valid
/// Semantics: the test body completes successfully.
#[test]
fn valid() { assert!(true); }
"#;

/// Goal: expose the installed checker build identity without entering source analysis.
/// Scope: level=contract; boundary=ousia-rust-checker::identity
/// Semantics: the process exits zero and emits only the exact typed identity JSON wire.
#[test]
fn identity_process_emits_typed_build_identity() {
    let output = checker(&["identity", "--format", "json"]);

    assert!(output.status.success(), "output was {output:?}");
    assert!(output.stderr.is_empty(), "output was {output:?}");
    let identity: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("valid identity JSON");
    assert_eq!(identity["schema"], "ousia.rust-checker-build.v1");
    assert_eq!(identity["package"], "ousia-rust-checker");
    assert_eq!(identity["binary"], "ousia-rust-checker");
    assert_eq!(
        identity["sourceSha256"]
            .as_str()
            .expect("source digest")
            .len(),
        64
    );
    assert_eq!(identity.as_object().expect("identity object").len(), 4);
}

/// Goal: accept a source test with a complete GSS contract through the executable check path.
/// Scope: level=contract; boundary=checker::main
/// Semantics: the process exits zero and reports a successful Rust checker run.
#[test]
fn check_process_accepts_complete_contract() {
    let root = write_cargo_fixture(VALID_TEST);
    let output = checker(&["check", root.to_str().expect("UTF-8 fixture path")]);

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("OK: Rust checker passed"));
    std::fs::remove_dir_all(root).expect("remove fixture");
}

/// Goal: reject a source test without GSS through the executable check path.
/// Scope: level=contract; boundary=checker::main
/// Semantics: the process exits one and stderr contains the stable missing-contract diagnostic with a source location.
#[test]
fn check_process_rejects_missing_contract() {
    let root = write_cargo_fixture("#[test]\nfn invalid() {}\n");
    let output = checker(&["check", root.to_str().expect("UTF-8 fixture path")]);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(output.status.code(), Some(1));
    assert!(stderr.contains("rust-test-contract-missing"));
    assert!(stderr.contains(":2:"));
    std::fs::remove_dir_all(root).expect("remove fixture");
}

/// Goal: keep invalid contracts visible without turning inventory reporting into a hard gate.
/// Scope: level=contract; boundary=checker::main
/// Semantics: JSON reporting exits zero and serializes the missing-contract issue.
#[test]
fn inventory_process_reports_invalid_contract_without_failure() {
    let root = write_cargo_fixture("#[test]\nfn invalid() {}\n");
    let output = checker(&[
        "report",
        "test-inventory",
        "--format",
        "json",
        root.to_str().expect("UTF-8 fixture path"),
    ]);

    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("rust-test-contract-missing"));
    std::fs::remove_dir_all(root).expect("remove fixture");
}

/// Goal: distinguish fatal source discovery errors from hard diagnostics.
/// Scope: level=contract; boundary=checker::main
/// Semantics: a missing source path exits two and prints the stable error prefix.
#[test]
fn check_process_uses_exit_two_for_fatal_input_errors() {
    let missing =
        std::env::temp_dir().join(format!("ousia-rust-checker-missing-{}", std::process::id(),));
    let output = checker(&["check", missing.to_str().expect("UTF-8 fixture path")]);

    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).starts_with("error:"));
}

/// Goal: reject every removed raw-input shape at the process boundary.
/// Scope: level=contract; boundary=checker::main
/// Semantics: source files, ordinary files, and manifestless directories exit two with the Cargo-required code and no stdout.
#[rstest]
#[case::source_file("lib.rs", Some("fn value() {}\n"))]
#[case::ordinary_file("notes.txt", Some("notes\n"))]
#[case::manifestless_directory("sources", None)]
fn check_process_rejects_non_cargo_inputs(#[case] name: &str, #[case] contents: Option<&str>) {
    let root = fixture_root();
    std::fs::create_dir_all(&root).expect("create fixture root");
    let input = root.join(name);
    if let Some(contents) = contents {
        std::fs::write(&input, contents).expect("write input");
    } else {
        std::fs::create_dir_all(&input).expect("create input directory");
    }

    let output = checker(&["check", input.to_str().expect("UTF-8 fixture path")]);

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("subject-cargo-manifest-required"));
    std::fs::remove_dir_all(root).expect("remove fixture");
}

/// Goal: reject removed raw selectors from the installed project gate.
/// Scope: level=contract; boundary=checker::main
/// Semantics: each invalid project sourcePaths shape exits two with project-source-path-invalid and commits no stdout.
#[rstest]
#[case::source_file("src/lib.rs", true)]
#[case::ordinary_file("notes.txt", true)]
#[case::manifestless_directory("sources", false)]
fn check_project_rejects_non_cargo_source_paths(#[case] selector: &str, #[case] file: bool) {
    let root = fixture_root();
    let input = root.join(selector);
    if file {
        std::fs::create_dir_all(input.parent().expect("input parent"))
            .expect("create input parent");
        std::fs::write(&input, "fixture\n").expect("write input");
    } else {
        std::fs::create_dir_all(&input).expect("create input directory");
    }
    std::fs::create_dir_all(root.join(".ousia")).expect("create project facts directory");
    std::fs::write(
        root.join(".ousia/project.json"),
        format!(r#"{{"project":{{"rust":{{"sourcePaths":["{selector}"]}}}}}}"#),
    )
    .expect("write project facts");

    let output = checker(&["check-project", root.to_str().expect("UTF-8 fixture path")]);

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("project-source-path-invalid"));
    std::fs::remove_dir_all(root).expect("remove fixture");
}

/// Goal: make source parse failure fatal before any hard diagnostic is committed.
/// Scope: level=contract; boundary=checker::main
/// Semantics: malformed input at every argument position exits two with empty stdout and without the valid sibling's missing-contract diagnostic.
#[rstest]
#[case::malformed_first(0)]
#[case::malformed_middle(1)]
#[case::malformed_last(2)]
fn check_process_commits_no_partial_diagnostics_before_parse_fatal(#[case] position: usize) {
    let malformed = write_cargo_fixture("fn malformed( {\n");
    let invalid = write_cargo_fixture("#[test]\nfn missing_contract() {}\n");
    let valid = write_cargo_fixture(VALID_TEST);
    let mut paths = [invalid.clone(), valid.clone(), valid.clone()];
    paths[position] = malformed.clone();
    let args = paths
        .iter()
        .map(|path| path.to_str().expect("UTF-8 fixture path"))
        .collect::<Vec<_>>();
    let mut command = vec!["check"];
    command.extend(args);

    let output = checker(&command);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty(), "stdout was {output:?}");
    assert!(stderr.starts_with("error:"), "stderr was {stderr}");
    assert!(!stderr.contains("rust-test-contract-missing"));
    for path in [malformed, invalid, valid] {
        let _ = std::fs::remove_dir_all(path);
    }
}

/// Goal: apply the same fatal parse boundary to every report evaluator.
/// Scope: level=contract; boundary=checker::main
/// Semantics: each report exits two with empty stdout instead of emitting a partial header or payload.
#[rstest]
#[case::function_usage(&["report", "function-usage"])]
#[case::module_layout(&["report", "module-layout"])]
#[case::test_inventory_json(&["report", "test-inventory", "--format", "json"])]
#[case::test_inventory_markdown(&["report", "test-inventory", "--format", "markdown"])]
#[case::zero_field_types(&["report", "zero-field-types"])]
fn report_process_commits_no_partial_payload_before_parse_fatal(#[case] mode: &[&str]) {
    let valid = write_cargo_fixture(VALID_TEST);
    let malformed = write_cargo_fixture("fn malformed( {\n");
    let mut args = mode.to_vec();
    args.push(valid.to_str().expect("UTF-8 fixture path"));
    args.push(malformed.to_str().expect("UTF-8 fixture path"));

    let output = checker(&args);

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty(), "stdout was {output:?}");
    assert!(String::from_utf8_lossy(&output.stderr).starts_with("error:"));
    std::fs::remove_dir_all(valid).expect("remove valid fixture");
    std::fs::remove_dir_all(malformed).expect("remove malformed fixture");
}

/// Goal: expose type-association uncertainty as a successful zero-field report payload.
/// Scope: level=contract; boundary=checker::main
/// Semantics: a cyclic named re-export frontier exits zero, writes valid JSON with the stable unresolved warning to stdout, and leaves stderr empty.
#[test]
fn zero_field_report_process_serializes_association_uncertainty() {
    let root = write_cargo_fixture(
        "mod a { pub use crate::b::Marker; }\nmod b { pub use crate::a::Marker; }\nuse a::*;\nimpl Marker {}\n",
    );
    let output = checker(&[
        "report",
        "zero-field-types",
        root.to_str().expect("UTF-8 fixture path"),
    ]);

    assert!(output.status.success(), "output was {output:?}");
    assert!(output.stderr.is_empty(), "stderr was {output:?}");
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("valid report JSON");
    assert!(
        value["warnings"]
            .as_array()
            .expect("warnings")
            .iter()
            .any(|warning| warning["code"] == "type-association-unresolved")
    );
    std::fs::remove_dir_all(root).expect("remove fixture");
}

fn checker(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_ousia-rust-checker"))
        .args(args)
        .output()
        .expect("run checker binary")
}

fn write_cargo_fixture(source: &str) -> PathBuf {
    static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);
    let ordinal = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-exit-{}-{ordinal}",
        std::process::id(),
    ));
    std::fs::create_dir_all(root.join("src")).expect("create fixture source directory");
    std::fs::write(
        root.join("Cargo.toml"),
        format!(
            "[package]\nname = \"exit_fixture_{ordinal}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"
        ),
    )
    .expect("write fixture manifest");
    std::fs::write(root.join("src/lib.rs"), source).expect("write fixture source");
    root
}

fn fixture_root() -> PathBuf {
    static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(10_000);
    let ordinal = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "ousia-rust-checker-input-{}-{ordinal}",
        std::process::id()
    ))
}
