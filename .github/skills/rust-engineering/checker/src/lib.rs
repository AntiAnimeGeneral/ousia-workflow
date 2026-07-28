use std::path::PathBuf;

mod analysis;
mod check;
mod diagnostic;
mod engine;
mod markers;
mod report;
mod rules;
mod test_analysis;

pub use analysis::FatalError;
pub use check::{CheckOutcome, ProjectCheckResult, check_cargo_inputs, check_project};
pub use diagnostic::Diagnostic;
pub use report::TestInventoryFormat;

#[doc = "ousia: ownerless-fn public function-usage report orchestration"]
pub fn report_function_usage(cargo_inputs: &[PathBuf]) -> Result<String, FatalError> {
    let mut session = analysis::AnalysisSession::build(cargo_inputs)?;
    report::function_usage::build_session(&mut session)
}

#[doc = "ousia: ownerless-fn public module-layout report orchestration"]
pub fn report_module_layout(cargo_inputs: &[PathBuf]) -> Result<String, FatalError> {
    let mut session = analysis::AnalysisSession::build(cargo_inputs)?;
    report::module_layout::build_session(&mut session)
}

#[doc = "ousia: ownerless-fn public test-inventory report orchestration"]
pub fn report_test_inventory(
    cargo_inputs: &[PathBuf],
    format: TestInventoryFormat,
) -> Result<String, FatalError> {
    let mut session = analysis::AnalysisSession::build(cargo_inputs)?;
    report::test_inventory::build_session(&mut session, format)
}

#[doc = "ousia: ownerless-fn public zero-field-types report orchestration"]
pub fn report_zero_field_types(cargo_inputs: &[std::path::PathBuf]) -> Result<String, FatalError> {
    let session = analysis::AnalysisSession::build(cargo_inputs)?;
    report::zero_field_types::build_session(&session)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use rstest::rstest;

    use super::{CheckOutcome, check_cargo_inputs};

    /// Goal: preserve module-owner inheritance across the public logical occurrence projection.
    /// Scope: level=contract; boundary=lib::check_cargo_inputs
    /// Semantics: an enclosing owner covers a function in an inline child without producing missing or unused owner diagnostics.
    #[test]
    fn public_check_preserves_inline_module_owner_inheritance() {
        let root = fixture_root("inline-owner");
        write_cargo_fixture(
            &root,
            r#"#![doc = "ousia: module-owner routing"]
mod nested {
    pub fn child() {}
}
"#,
        );

        let outcome =
            check_cargo_inputs(std::slice::from_ref(&root)).expect("public check succeeds");
        std::fs::remove_dir_all(&root).expect("remove fixture directory");
        assert!(matches!(outcome, CheckOutcome::Passed), "{outcome:?}");
    }

    /// Goal: enforce ownerless marker consistency through the production analysis projection.
    /// Scope: level=contract; boundary=lib::check_cargo_inputs
    /// Semantics: each named owner shape emits the exact ordered diagnostic family admitted by Proposal 05.
    #[rstest]
    #[case::self_bearing_method(
        r#"struct Service;
impl Service {
    #[doc = "ousia: ownerless-method redundant constructor"]
    fn new() -> Self { Self }
}
"#,
        &["rust-ownerless-method-unnecessary"]
    )]
    #[case::trait_impl_without_marker(
        r#"struct Service;
trait Factory { fn create() -> Service; }
impl Factory for Service { fn create() -> Service { Service } }
"#,
        &[]
    )]
    #[case::trait_impl_with_marker(
        r#"struct Service;
trait Factory { fn create() -> Service; }
impl Factory for Service {
    #[doc = "ousia: ownerless-method redundant trait method"]
    fn create() -> Service { Service }
}
"#,
        &["rust-ownerless-method-unnecessary"]
    )]
    #[case::trait_impl_with_empty_marker(
        r#"struct Service;
trait Factory { fn create() -> Service; }
impl Factory for Service {
    #[doc = "ousia: ownerless-method"]
    fn create() -> Service { Service }
}
"#,
        &["rust-ownerless-method-reason"]
    )]
    #[case::module_owned_function(
        r#"#![doc = "ousia: module-owner routing"]
#[doc = "ousia: ownerless-fn redundant helper"]
fn helper() {}
"#,
        &["rust-ownerless-fn-conflict"]
    )]
    #[case::module_owned_function_with_empty_marker(
        r#"#![doc = "ousia: module-owner routing"]
#[doc = "ousia: ownerless-fn"]
fn helper() {}
"#,
        &["rust-ownerless-fn-reason"]
    )]
    #[case::duplicate_valid_markers(
        r#"#[doc = "ousia: ownerless-fn first reason"]
#[doc = "ousia: ownerless-fn second reason"]
fn helper() {}
"#,
        &["rust-owner-marker-duplicate"]
    )]
    #[case::duplicate_with_invalid_second_reason(
        r#"#[doc = "ousia: ownerless-fn first reason"]
#[doc = "ousia: ownerless-fn"]
fn helper() {}
"#,
        &["rust-ownerless-fn-reason", "rust-owner-marker-duplicate"]
    )]
    #[case::invalid_first_valid_second_on_owned_function(
        r#"#![doc = "ousia: module-owner routing"]
#[doc = "ousia: ownerless-fn"]
#[doc = "ousia: ownerless-fn valid second reason"]
fn helper() {}
"#,
        &[
            "rust-ownerless-fn-reason",
            "rust-owner-marker-duplicate",
            "rust-ownerless-fn-conflict",
        ]
    )]
    #[case::three_function_markers_report_one_duplicate(
        r#"#[doc = "ousia: ownerless-fn first reason"]
#[doc = "ousia: ownerless-fn second reason"]
#[doc = "ousia: ownerless-fn third reason"]
fn helper() {}
"#,
        &["rust-owner-marker-duplicate"]
    )]
    #[case::duplicate_method_markers(
        r#"struct Service;
impl Service {
    #[doc = "ousia: ownerless-method first reason"]
    #[doc = "ousia: ownerless-method second reason"]
    fn helper(path: &str) {}
}
"#,
        &["rust-owner-marker-duplicate"]
    )]
    #[case::cross_kind_marker_keeps_placement_owner(
        r#"#[doc = "ousia: ownerless-method wrong kind"]
#[doc = "ousia: ownerless-fn valid owner"]
fn helper() {}
"#,
        &["rust-ownerless-method-placement"]
    )]
    #[case::valid_static_helper(
        r#"struct Service;
impl Service {
    #[doc = "ousia: ownerless-method path parser colocated with Service"]
    fn helper(path: &str) {}
}
"#,
        &[]
    )]
    #[case::missing_static_helper_owner(
        r#"struct Service;
impl Service { fn helper(path: &str) {} }
"#,
        &["rust-impl-method-owner-missing"]
    )]
    fn public_check_enforces_ownerless_marker_consistency(
        #[case] source_text: &str,
        #[case] expected: &[&str],
    ) {
        let root = fixture_root("marker-consistency");
        write_cargo_fixture(&root, source_text);

        let outcome =
            check_cargo_inputs(std::slice::from_ref(&root)).expect("public check succeeds");
        std::fs::remove_dir_all(&root).expect("remove fixture directory");
        let diagnostics = match outcome {
            CheckOutcome::Passed => Vec::new(),
            CheckOutcome::Invalid(diagnostics) => diagnostics,
        };
        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code)
                .collect::<Vec<_>>(),
            expected,
        );
        if expected.contains(&"rust-owner-marker-duplicate") {
            let duplicate = diagnostics
                .iter()
                .find(|diagnostic| diagnostic.code == "rust-owner-marker-duplicate")
                .expect("duplicate diagnostic");
            let expected_line = if source_text.contains("impl Service") {
                4
            } else if source_text.starts_with("#!") {
                3
            } else {
                2
            };
            assert_eq!(duplicate.line, expected_line);
        }
    }

    /// Goal: keep test-only non-function items outside production hard-rule evaluation.
    /// Scope: level=contract; boundary=lib::check_cargo_inputs
    /// Semantics: each cfg(test) item shape is projected for test reachability but contributes no production owner, placement, alias, or mixed-item diagnostic.
    #[rstest]
    #[case::impl_block(
        r#"#[cfg(test)]
struct Service;
#[cfg(test)]
impl Service { fn helper(path: &str) {} }
"#
    )]
    #[case::impl_method(
        r#"struct Service;
impl Service {
    #[cfg(test)]
    fn helper(path: &str) {}
}
"#
    )]
    #[case::trait_and_foreign(
        r#"#[cfg(test)]
trait Fixture { #[doc = "ousia: ownerless-fn wrong"] fn value(); }
#[cfg(test)]
unsafe extern "C" { #[doc = "ousia: ownerless-fn wrong"] fn value(); }
"#
    )]
    #[case::use_alias(
        r#"#[cfg(test)]
use crate::fixture as hidden;
"#
    )]
    #[case::module_owner_mixed_item(
        r#"#![doc = "ousia: module-owner routing"]
#[cfg(test)]
pub struct Fixture;
pub fn route() {}
"#
    )]
    fn public_check_excludes_test_only_items_from_production_rules(#[case] source: &str) {
        let root = fixture_root("test-only-projection");
        write_cargo_fixture(&root, source);

        let outcome =
            check_cargo_inputs(std::slice::from_ref(&root)).expect("public check succeeds");
        std::fs::remove_dir_all(&root).expect("remove fixture directory");
        assert!(matches!(outcome, CheckOutcome::Passed), "{outcome:?}");
    }

    fn fixture_root(label: &str) -> PathBuf {
        static NEXT_FIXTURE: std::sync::atomic::AtomicUsize =
            std::sync::atomic::AtomicUsize::new(0);
        let ordinal = NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "ousia-checker-{label}-{}-{ordinal}",
            std::process::id(),
        ))
    }

    fn write_cargo_fixture(root: &std::path::Path, source: &str) {
        std::fs::create_dir_all(root.join("src")).expect("create fixture source directory");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write fixture manifest");
        std::fs::write(root.join("src/lib.rs"), source).expect("write fixture source");
    }
}
