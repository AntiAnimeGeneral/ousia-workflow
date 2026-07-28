use crate::analysis::{AnalysisSession, FatalError};
use crate::test_analysis::TestContractInventory;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TestInventoryFormat {
    Json,
    Markdown,
}

#[doc = "ousia: ownerless-fn test inventory report application"]
pub(crate) fn build_session(
    session: &mut AnalysisSession,
    format: TestInventoryFormat,
) -> Result<String, FatalError> {
    let inventory = TestContractInventory::build_session(session)?;
    match format {
        TestInventoryFormat::Json => serde_json::to_string_pretty(&inventory)
            .map(|mut output| {
                output.push('\n');
                output
            })
            .map_err(FatalError::render),
        TestInventoryFormat::Markdown => Ok(render_markdown(&inventory)),
    }
}

#[doc = "ousia: ownerless-fn Markdown projection for Rust test inventory"]
fn render_markdown(inventory: &TestContractInventory) -> String {
    let mut output = String::from("# Rust Test Inventory\n\n");
    output.push_str("## Summary\n\n");
    output.push_str(&format!(
        "- Tests: {}\n- Complete contracts: {}\n- Invalid contracts: {}\n- Valid shapes: {}\n- Invalid shapes: {}\n- Plain tests: {}\n- rstest templates: {}\n- Declared cases: {}\n\n",
        inventory.summary.tests,
        inventory.summary.contracts_complete,
        inventory.summary.contracts_invalid,
        inventory.summary.shapes_valid,
        inventory.summary.shapes_invalid,
        inventory.summary.plain_tests,
        inventory.summary.rstest_templates,
        inventory.summary.declared_cases,
    ));
    output.push_str("## Tests\n\n");
    let groups = grouped_tests(inventory);
    if groups.is_empty() {
        output.push_str("_None._\n\n");
    }
    for ((manifest, package), targets) in groups {
        output.push_str(&format!("### Package `{package}` (`{manifest}`)\n\n"));
        for ((target_kind, target_name), modules) in targets {
            output.push_str(&format!("#### Target `{target_kind}:{target_name}`\n\n"));
            for (module, scopes) in modules {
                output.push_str(&format!("##### Module `{module}`\n\n"));
                for ((scope_level, scope_boundary), tests) in scopes {
                    let declared_cases = tests
                        .iter()
                        .map(|test| test.shape.rstest.cases.len())
                        .sum::<usize>();
                    output.push_str(&format!(
                        "###### Scope level=`{scope_level}`; boundary=`{scope_boundary}`\n\n"
                    ));
                    output.push_str(&format!(
                        "- Templates: {}\n- Declared cases: {}\n\n",
                        tests.len(),
                        declared_cases,
                    ));
                    for test in &tests {
                        render_test(&mut output, test);
                    }
                    let candidates = inventory
                        .candidate_groups
                        .iter()
                        .filter(|candidate| {
                            candidate
                                .tests
                                .iter()
                                .any(|test_id| tests.iter().any(|test| test.test_id == *test_id))
                        })
                        .collect::<Vec<_>>();
                    if !candidates.is_empty() {
                        output.push_str("- Candidate evidence:\n");
                        for candidate in candidates {
                            output.push_str(&format!(
                                "  - `{}` ({}) — tests: {}; evidence: {}\n",
                                candidate.code,
                                candidate.confidence,
                                candidate.tests.join(", "),
                                candidate.evidence.join("; "),
                            ));
                        }
                        output.push('\n');
                    }
                }
            }
        }
    }
    output.push_str("## Candidate Groups\n\n");
    if inventory.candidate_groups.is_empty() {
        output.push_str("_None._\n");
    } else {
        for candidate in &inventory.candidate_groups {
            output.push_str(&format!(
                "- `{}` ({}) — tests: {}; evidence: {}\n",
                candidate.code,
                candidate.confidence,
                candidate.tests.join(", "),
                candidate.evidence.join("; "),
            ));
        }
    }
    output
}

type ScopeKey = (String, String);
type ModuleGroups<'a> =
    BTreeMap<String, BTreeMap<ScopeKey, Vec<&'a crate::test_analysis::TestEntry>>>;
type TargetGroups<'a> = BTreeMap<(String, String), ModuleGroups<'a>>;
type PackageGroups<'a> = BTreeMap<(String, String), TargetGroups<'a>>;

#[doc = "ousia: ownerless-fn deterministic inventory display grouping"]
fn grouped_tests(inventory: &TestContractInventory) -> PackageGroups<'_> {
    let mut groups = PackageGroups::new();
    for test in &inventory.tests {
        let scope = if test.contract.status == "complete" {
            (
                test.contract
                    .scope
                    .level
                    .clone()
                    .expect("complete contract scope level"),
                test.contract
                    .scope
                    .boundary
                    .clone()
                    .expect("complete contract scope boundary"),
            )
        } else {
            ("invalid".to_owned(), "invalid".to_owned())
        };
        groups
            .entry((test.package.manifest.clone(), test.package.name.clone()))
            .or_default()
            .entry((test.target.kind.to_owned(), test.target.name.clone()))
            .or_default()
            .entry(test.module.clone())
            .or_default()
            .entry(scope)
            .or_default()
            .push(test);
    }
    groups
}

#[doc = "ousia: ownerless-fn grouped Rust test inventory entry rendering"]
fn render_test(output: &mut String, test: &crate::test_analysis::TestEntry) {
    output.push_str(&format!("- Test `{}` (`{}`)\n", test.name, test.test_id));
    output.push_str(&format!(
        "  - Source: `{}`:{}:{}\n  - Template: `{}`\n  - Goal: {}\n  - Semantics: {}\n",
        test.source.path,
        test.source.line,
        test.source.column,
        test.template_kind,
        test.contract.goal.as_deref().unwrap_or("_invalid_"),
        test.contract.semantics.as_deref().unwrap_or("_invalid_"),
    ));
    if !test.shape.rstest.cases.is_empty() {
        output.push_str("  - Cases:\n");
        for case in &test.shape.rstest.cases {
            output.push_str(&format!(
                "    - `{}`\n",
                case.label.as_deref().unwrap_or("<unnamed>")
            ));
        }
    }
    output.push_str(&format!(
        "  - Direct calls: {}\n  - Receiver methods: {}\n  - Oracles: {}\n",
        display_or_none(&test.facts.direct_function_calls),
        display_or_none(&test.facts.receiver_methods),
        if test.facts.oracles.is_empty() {
            "_none_".to_owned()
        } else {
            test.facts.oracles.join(", ")
        },
    ));
    if !test.issues.is_empty() {
        output.push_str("  - Issues:\n");
        for issue in &test.issues {
            output.push_str(&format!(
                "    - `{}` at {}:{} — {}\n",
                issue.code.as_str(),
                issue.line,
                issue.column,
                issue.message
            ));
        }
    }
    output.push('\n');
}

#[doc = "ousia: ownerless-fn empty-list display for test inventory Markdown"]
fn display_or_none(values: &[String]) -> String {
    if values.is_empty() {
        "_none_".to_owned()
    } else {
        values.join(", ")
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static FIXTURE_ID: AtomicUsize = AtomicUsize::new(0);

    /// Goal: serialize the mandatory V1 Cargo package projection in declared wire order.
    /// Scope: level=contract; boundary=report::test_inventory::build_session
    /// Semantics: every test carries package name then manifest from Cargo metadata without deriving either from root_id.
    #[test]
    fn json_inventory_serializes_authoritative_package_fields() {
        let root = fixture_root("json-package");
        write_package(
            &root,
            "wire_package",
            r#"/// Goal: expose package metadata.
/// Scope: level=contract; boundary=inventory::package
/// Semantics: the serialized entry remains attached to its Cargo package.
#[test]
fn package_identity() { assert!(true); }
"#,
        );
        let mut session =
            AnalysisSession::build(&[root.join("Cargo.toml")]).expect("analyze fixture");
        let report = build_session(&mut session, TestInventoryFormat::Json).expect("build report");
        let package = report.find("\"package\": {").expect("package field");
        let name = report[package..]
            .find("\"name\": \"wire_package\"")
            .expect("package name");
        let manifest = report[package..]
            .find("\"manifest\": \"Cargo.toml\"")
            .expect("package manifest");
        assert!(name < manifest);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    /// Goal: project one aggregate into stable package, target, module, and Scope review groups.
    /// Scope: level=contract; boundary=report::test_inventory::build_session
    /// Semantics: Markdown preserves all test names, puts invalid GSS in the local invalid bucket, counts templates/cases, and associates candidate evidence.
    #[test]
    fn markdown_inventory_groups_and_counts_the_json_test_set() {
        let root = fixture_root("markdown-groups");
        write_workspace(&root);
        let manifest = root.join("Cargo.toml");
        let mut json_session =
            AnalysisSession::build(std::slice::from_ref(&manifest)).expect("analyze JSON fixture");
        let json =
            build_session(&mut json_session, TestInventoryFormat::Json).expect("build JSON report");
        let value: serde_json::Value = serde_json::from_str(&json).expect("parse JSON report");
        let test_ids = value["tests"]
            .as_array()
            .expect("tests array")
            .iter()
            .map(|test| test["test_id"].as_str().expect("test ID").to_owned())
            .collect::<Vec<_>>();

        let mut markdown_session =
            AnalysisSession::build(&[manifest]).expect("analyze Markdown fixture");
        let markdown = build_session(&mut markdown_session, TestInventoryFormat::Markdown)
            .expect("build Markdown report");
        let mut markdown_test_ids = markdown
            .lines()
            .filter_map(|line| line.strip_prefix("- Test `"))
            .filter_map(|line| line.split_once(" (`").map(|(_, rest)| rest))
            .filter_map(|rest| rest.strip_suffix("`)"))
            .map(str::to_owned)
            .collect::<Vec<_>>();
        markdown_test_ids.sort();
        let mut test_ids = test_ids;
        test_ids.sort();
        assert_eq!(markdown_test_ids, test_ids);
        assert!(markdown.contains("### Package `alpha` (`alpha/Cargo.toml`)"));
        assert!(markdown.contains("### Package `beta` (`beta/Cargo.toml`)"));
        assert!(markdown.contains("#### Target `lib:alpha`"));
        assert!(markdown.contains("##### Module `nested`"));
        assert!(markdown.contains("###### Scope level=`unit`; boundary=`worker::run`"));
        assert!(markdown.contains("###### Scope level=`invalid`; boundary=`invalid`"));
        assert!(markdown.contains("- Templates: 1\n- Declared cases: 2"));
        assert!(markdown.contains("- Goal: exercise one matrix contract."));
        assert!(
            markdown.contains("- Semantics: each named case reaches the same observable boundary.")
        );
        assert!(markdown.contains("    - `first`\n    - `second`"));
        assert!(markdown.contains("- Direct calls: helper::run"));
        assert!(markdown.contains("- Receiver methods: observe"));
        assert!(markdown.contains("- Oracles: assert-eq"));
        assert!(markdown.contains("`rust-test-contract-placeholder`"));
        assert!(markdown.contains("- Candidate evidence:"));
        assert!(markdown.contains("`weak-oracle-candidate`"));
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    fn fixture_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-test-inventory-{name}-{}-{}",
            std::process::id(),
            FIXTURE_ID.fetch_add(1, Ordering::Relaxed),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create fixture root");
        root
    }

    fn write_package(root: &Path, name: &str, source: &str) {
        std::fs::create_dir_all(root.join("src")).expect("create package source");
        std::fs::write(
            root.join("Cargo.toml"),
            format!("[package]\nname = \"{name}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"),
        )
        .expect("write package manifest");
        std::fs::write(root.join("src/lib.rs"), source).expect("write package source");
    }

    fn write_workspace(root: &Path) {
        std::fs::write(
            root.join("Cargo.toml"),
            "[workspace]\nmembers = [\"alpha\", \"beta\"]\nresolver = \"3\"\n",
        )
        .expect("write workspace manifest");
        write_package(
            &root.join("alpha"),
            "alpha",
            r#"mod nested {
    /// Goal: exercise one matrix contract.
    /// Scope: level=unit; boundary=worker::run
    /// Semantics: each named case reaches the same observable boundary.
    #[rstest::rstest]
    #[case::first(1)]
    #[case::second(2)]
    fn matrix(#[case] value: usize) {
        assert_eq!(helper::run(value), value);
        service.observe();
    }
}
"#,
        );
        write_package(
            &root.join("beta"),
            "beta",
            r#"/// Goal: TODO
/// Scope: level=contract; boundary=inventory::invalid
/// Semantics: preserve invalid contracts for review.
#[test]
fn invalid_contract() {}
"#,
        );
    }
}
