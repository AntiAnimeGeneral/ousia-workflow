use crate::diagnostic::Diagnostic;
use crate::rules::context::RuleContext;
use crate::test_analysis::TestContractInventory;

#[doc = "ousia: ownerless-fn test contract issue projection into hard diagnostics"]
pub(crate) fn diagnostics(inventory: &TestContractInventory) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for test in &inventory.tests {
        let mut context = RuleContext::new(&test.diagnostic_path);
        for issue in &test.issues {
            context.emit(issue.code.as_str(), issue.location, issue.message.clone());
        }
        diagnostics.extend(context.into_diagnostics());
    }
    diagnostics
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use rstest::rstest;

    use crate::check_cargo_inputs;

    const VALID_TEST: &str = r#"
/// Goal: preserve a valid source test contract.
/// Scope: level=unit; boundary=fixture::valid
/// Semantics: the test body completes successfully.
#[test]
fn valid() { assert!(true); }
"#;

    /// Goal: enforce every stable Rust test-contract diagnostic through the public checker boundary.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: each invalid source emits its named code with a source location while the adjacent valid source does not emit that code.
    #[rstest]
    #[case::missing_contract(
        r#"#[test]
fn invalid() { assert!(true); }
"#,
        "rust-test-contract-missing"
    )]
    #[case::field_order(
        r#"/// Scope: level=unit; boundary=fixture::invalid
/// Goal: reject fields out of order.
/// Semantics: emits the field-order diagnostic.
#[test]
fn invalid() { assert!(true); }
"#,
        "rust-test-contract-field-order"
    )]
    #[case::duplicate_field(
        r#"/// Goal: reject duplicate fields.
/// Goal: reject the repeated field.
/// Semantics: emits the duplicate-field diagnostic.
#[test]
fn invalid() { assert!(true); }
"#,
        "rust-test-contract-duplicate-field"
    )]
    #[case::empty_field(
        r#"/// Goal:
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the empty-field diagnostic.
#[test]
fn invalid() { assert!(true); }
"#,
        "rust-test-contract-empty-field"
    )]
    #[case::placeholder(
        r#"/// Goal: TODO
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the placeholder diagnostic.
#[test]
fn invalid() { assert!(true); }
"#,
        "rust-test-contract-placeholder"
    )]
    #[case::scope_invalid(
        r#"/// Goal: reject an invalid scope level.
/// Scope: level=component; boundary=fixture::invalid
/// Semantics: emits the scope-invalid diagnostic.
#[test]
fn invalid() { assert!(true); }
"#,
        "rust-test-contract-scope-invalid"
    )]
    #[case::carrier_invalid(
        r#"#[doc = concat!("Goal: ", "invalid carrier")]
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the carrier-invalid diagnostic.
#[test]
fn invalid() { assert!(true); }
"#,
        "rust-test-contract-carrier-invalid"
    )]
    #[case::attribute_invalid(
        r#"/// Goal: reject an unparseable conditional test attribute.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the test-attribute-invalid diagnostic.
#[cfg_attr(feature = "x", test(broken =))]
fn invalid() { assert!(true); }
"#,
        "rust-test-attribute-invalid"
    )]
    #[case::rstest_no_capability(
        r#"/// Goal: reject rstest without a matrix or capability.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the no-capability diagnostic.
#[rstest]
fn invalid() { assert!(true); }
"#,
        "rust-rstest-no-capability"
    )]
    #[case::case_label_missing(
        r#"/// Goal: require semantic labels on matrix cases.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the missing-label diagnostic.
#[rstest]
#[case(1)]
#[case::two(2)]
fn invalid(#[case] value: usize) { assert!(value > 0); }
"#,
        "rust-rstest-case-label-missing"
    )]
    #[case::case_label_duplicate(
        r#"/// Goal: require unique semantic matrix labels.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the duplicate-label diagnostic.
#[rstest]
#[case::same(1)]
#[case::same(2)]
fn invalid(#[case] value: usize) { assert!(value > 0); }
"#,
        "rust-rstest-case-label-duplicate"
    )]
    #[case::values_forbidden(
        r#"/// Goal: reject generated values dimensions.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the values-forbidden diagnostic.
#[rstest]
fn invalid(#[values(1, 2)] value: usize) { assert!(value > 0); }
"#,
        "rust-rstest-values-forbidden"
    )]
    #[case::files_forbidden(
        r#"/// Goal: reject generated files dimensions.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the files-forbidden diagnostic.
#[rstest]
fn invalid(#[files("*.rs")] path: &str) { assert!(!path.is_empty()); }
"#,
        "rust-rstest-files-forbidden"
    )]
    #[case::compact_case_unsupported(
        r#"/// Goal: reject compact rstest cases.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the compact-case diagnostic.
#[rstest(case(1), case(2))]
fn invalid(value: usize) { assert!(value > 0); }
"#,
        "rust-rstest-compact-case-unsupported"
    )]
    #[case::conditional_case_unsupported(
        r#"/// Goal: reject conditional rstest cases.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the conditional-case diagnostic.
#[rstest]
#[case::one(1)]
#[case::two(2)]
#[cfg_attr(feature = "extra", case::three(3))]
fn invalid(#[case] value: usize) { assert!(value > 0); }
"#,
        "rust-rstest-conditional-case-unsupported"
    )]
    #[case::ignore_reason(
        r#"/// Goal: require a meaningful ignore reason.
/// Scope: level=unit; boundary=fixture::invalid
/// Semantics: emits the ignore-reason diagnostic.
#[test]
#[ignore]
fn invalid() { assert!(true); }
"#,
        "rust-test-ignore-reason"
    )]
    fn public_check_enforces_test_contract_family(#[case] invalid: &str, #[case] code: &str) {
        let invalid_root = write_cargo_fixture(invalid);
        let valid_root = write_cargo_fixture(VALID_TEST);
        let invalid_path = invalid_root.join("src/lib.rs");

        let crate::CheckOutcome::Invalid(diagnostics) =
            check_cargo_inputs(std::slice::from_ref(&invalid_root)).expect("check invalid fixture")
        else {
            panic!("invalid fixture unexpectedly passed");
        };
        let diagnostic = diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == code)
            .unwrap_or_else(|| panic!("missing {code} in {diagnostics:?}"));
        assert_eq!(
            diagnostic.path,
            invalid_path
                .canonicalize()
                .expect("canonical invalid fixture")
        );
        assert!(diagnostic.line > 0);
        assert!(diagnostic.column > 0);
        assert!(diagnostic.to_string().contains(code));

        let valid =
            check_cargo_inputs(std::slice::from_ref(&valid_root)).expect("check valid fixture");
        assert!(matches!(valid, crate::CheckOutcome::Passed));
        std::fs::remove_dir_all(invalid_root).expect("remove invalid fixture");
        std::fs::remove_dir_all(valid_root).expect("remove valid fixture");
    }

    fn write_cargo_fixture(source: &str) -> PathBuf {
        static NEXT_FIXTURE: std::sync::atomic::AtomicUsize =
            std::sync::atomic::AtomicUsize::new(0);
        let ordinal = NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-test-contract-{}-{ordinal}",
            std::process::id(),
        ));
        std::fs::create_dir_all(root.join("src")).expect("create contract fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            format!(
                "[package]\nname = \"fixture_{ordinal}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"
            ),
        )
        .expect("write contract manifest");
        std::fs::write(root.join("src/lib.rs"), source).expect("write contract source");
        root
    }
}
