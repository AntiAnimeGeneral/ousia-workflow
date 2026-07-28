use std::collections::BTreeSet;

use crate::analysis::cfg::{CfgExpr, TestCarrierKind};
use crate::analysis::{AnalysisSession, FatalError};

mod candidates;
mod contract;
mod facts;
mod fingerprint;
mod issues;
mod model;
mod shape;

use model::*;
pub(crate) use model::{TestContractInventory, TestEntry};
use shape::{test_attributes, test_shape_issues};

impl TestContractInventory {
    pub(crate) fn build_session(session: &mut AnalysisSession) -> Result<Self, FatalError> {
        let mut roots = BTreeSet::new();
        let mut tests = Vec::new();
        for module in session.modules() {
            roots.insert(InventoryRoot {
                root_id: module.root_id().to_owned(),
                kind: "cargo",
                path: module.root_locator().to_owned(),
            });
        }
        for projection in session.function_projections() {
            if projection.test_possible {
                tests.push(entry_for_projection(session, &projection)?);
            }
        }
        tests.sort_by(|left, right| left.test_id.cmp(&right.test_id));
        for pair in tests.windows(2) {
            if pair[0].test_id == pair[1].test_id {
                return Err(FatalError::new(
                    crate::analysis::error::FatalPhase::Model,
                    "duplicate-test-identity",
                    format!("duplicate Rust test identity `{}`", pair[0].test_id),
                ));
            }
        }
        let summary = InventorySummary::from_tests(&tests);
        let candidate_groups = CandidateGroup::from_tests(&tests);
        let cfg_budget = session.cfg_budget();
        Ok(Self {
            schema_version: "ousia.rust-test-inventory.v1",
            report_kind: "rust-test-inventory",
            subject: InventorySubject {
                roots: roots.into_iter().collect(),
            },
            analysis: InventoryAnalysis {
                universe_policy: "cargo-metadata-test-enabled-v1",
                cfg_evaluation: "symbolic-test-projection-v1",
                rustc_cfg_sha256: session.cfg_digest().to_owned(),
                cfg_budget: CfgBudget {
                    nodes_per_expression: cfg_budget.nodes_per_expression,
                    atoms_per_expression: cfg_budget.atoms_per_expression,
                    assignments_per_expression: cfg_budget.assignments_per_expression,
                    queries_per_session: cfg_budget.queries_per_session,
                },
                target_normalization: "cargo-metadata-0.21-v1",
                path_normalization: "root-relative-forward-slash-v1",
                fingerprint_algorithm: "rust-token-shape-sha256-v1",
            },
            capabilities: InventoryCapabilities {
                source_ast: "collected",
                macro_expansion: "not_collected",
                runtime_inventory: "not_collected",
                coverage: "not_collected",
                mutation: "not_collected",
            },
            summary,
            tests,
            candidate_groups,
            warnings: vec![InventoryWarning {
                code: "source-ast-capability-boundary",
                message: format!(
                    "macro-generated, doctest, runtime, coverage, and mutation tests are not collected; rustc cfg digest {}",
                    session.cfg_digest()
                ),
            }],
        })
    }
}

impl InventorySummary {
    fn from_tests(tests: &[TestEntry]) -> Self {
        let mut summary = Self {
            tests: tests.len(),
            ..Self::default()
        };
        for test in tests {
            if test.contract.status == "complete" {
                summary.contracts_complete += 1;
            } else {
                summary.contracts_invalid += 1;
            }
            if test.template_kind == "rstest" {
                summary.rstest_templates += 1;
            } else {
                summary.plain_tests += 1;
            }
            if test.shape.status == "valid" {
                summary.shapes_valid += 1;
            } else {
                summary.shapes_invalid += 1;
            }
            summary.declared_cases += test.shape.rstest.cases.len();
        }
        summary
    }
}

#[doc = "ousia: ownerless-fn function projection to test entry"]
fn entry_for_projection(
    session: &AnalysisSession,
    projection: &crate::analysis::ProjectedFunctionView<'_>,
) -> Result<TestEntry, FatalError> {
    let root_id = projection.occurrence.root_id();
    let target = projection.occurrence.target();
    let target_kind = projection.occurrence.target_kind().as_str();
    let target_name = projection.occurrence.target_name();
    let source_relative_path = projection.occurrence.source_relative_path();
    let diagnostic_path = projection.occurrence.path();
    let function = projection.function;
    let carriers = projection.attributes.test_carriers();
    let attributes = projection
        .attributes
        .ordered_attributes()
        .collect::<Vec<_>>();
    let module_path = projection.occurrence.module_path();
    let occurrence_id = projection.occurrence.occurrence_wire_id().to_owned();
    let item_guard = projection.effective_guard;
    let test_attributes = test_attributes(&carriers);
    let rstest_activation = CfgExpr::all([
        item_guard.clone(),
        CfgExpr::any(
            carriers
                .iter()
                .filter(|carrier| carrier.kind == TestCarrierKind::Rstest)
                .map(|carrier| carrier.guard.clone()),
        ),
    ]);
    let rstest = RstestFacts::from_function(
        function,
        projection.occurrence.path(),
        &attributes,
        &rstest_activation,
    )?;
    let contract = TestContract::from_facts(&attributes, function.sig.ident.span().start());
    let mut issues = contract.issues.clone();
    let shape_issues = test_shape_issues(
        session,
        function,
        item_guard,
        &carriers,
        &attributes,
        &rstest,
    )?;
    issues.extend(shape_issues.iter().cloned());
    let facts = TestFacts::from_function(
        function,
        session
            .body_facts(projection.item_id)
            .expect("test projection body facts must exist"),
    );
    let source_path = crate::analysis::subject::wire_path(&source_relative_path);
    let module = if module_path.is_empty() {
        "crate".to_owned()
    } else {
        module_path.join("::")
    };
    let name = function.sig.ident.to_string();
    let test_id = format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        root_id,
        target_kind,
        target_name,
        occurrence_id,
        source_path,
        module,
        projection.item_id.as_str(),
        name,
    );
    let location = function.sig.ident.span().start();
    Ok(TestEntry {
        test_id,
        occurrence_id,
        root_id: root_id.to_owned(),
        package: InventoryPackage {
            name: target.package_name.clone(),
            manifest: target.root_locator.clone(),
        },
        target: TestTarget {
            kind: target_kind,
            name: target_name.to_owned(),
        },
        module,
        source: TestSource {
            path: source_path,
            line: location.line,
            column: location.column + 1,
        },
        name,
        template_kind: if carriers
            .iter()
            .any(|carrier| carrier.kind == TestCarrierKind::Rstest)
        {
            "rstest"
        } else {
            "plain"
        },
        test_attributes,
        contract,
        shape: TestShape {
            status: if shape_issues.is_empty() {
                "valid"
            } else {
                "invalid"
            },
            carriers: carriers
                .iter()
                .map(|carrier| TestCarrierFact::from_carrier(carrier, item_guard))
                .collect(),
            rstest,
        },
        issues,
        facts,
        fingerprints: TestFingerprints::from_function(function),
        diagnostic_path: diagnostic_path.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static FIXTURE_ID: AtomicUsize = AtomicUsize::new(0);
    use crate::test_analysis::model::TestIssueCode;
    use std::path::{Path, PathBuf};

    /// Goal: collect a complete GSS rstest template with its named cases and source-visible facts.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: the template is complete, has two named cases, records direct calls and normalized assert-eq evidence, and does not misclassify case parameters as fixtures.
    #[test]
    fn inventory_collects_gss_rstest_cases_calls_and_oracles() {
        let inventory = inventory_for(
            r#"
/// Goal: reject invalid values.
/// Scope: level=contract; boundary=validator::validate
/// Semantics: each case returns the declared diagnostic.
#[rstest]
#[case::empty("", "E_EMPTY")]
#[case::invalid("?", "E_INVALID")]
fn rejects_invalid_values(#[case] input: &str, #[case] expected: &str) {
    assert_eq!(validator::validate(input), Err(expected));
}
"#,
        );

        assert_eq!(inventory.summary.tests, 1);
        let test = &inventory.tests[0];
        assert_eq!(test.contract.status, "complete");
        assert_eq!(test.shape.rstest.cases.len(), 2);
        assert_eq!(test.shape.rstest.cases[0].label.as_deref(), Some("empty"));
        assert_eq!(
            test.facts.direct_function_calls,
            ["Err", "validator::validate"]
        );
        assert_eq!(test.facts.oracles, ["assert-eq"]);
        assert!(test.shape.rstest.fixture_parameters.is_empty());
    }

    /// Goal: project body facts through the complete Test-universe carrier activation.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: a recognized invalid test carrier still activates cfg(test) calls, while an expression under cfg(not(test)) is excluded.
    #[test]
    fn inventory_projects_body_facts_in_test_universe_for_invalid_carriers() {
        let inventory = inventory_for(
            r#"
/// Goal: preserve the recognized test occurrence.
/// Scope: level=unit; boundary=worker::run
/// Semantics: only calls satisfiable in the test universe enter body facts.
#[test = "invalid-shape"]
fn invalid_carrier() {
    #[cfg(test)]
    test_only::call();
    #[cfg(not(test))]
    production_only::call();
}
"#,
        );

        assert_eq!(inventory.summary.tests, 1);
        assert_eq!(
            inventory.tests[0].facts.direct_function_calls,
            ["test_only::call"]
        );
        assert!(
            inventory.tests[0]
                .issues
                .iter()
                .any(|issue| issue.code == TestIssueCode::TestAttributeInvalid)
        );
    }

    /// Goal: apply guarded lexical blockers and expression guards to all shared Test body facts.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: a cfg(test) parameter blocks the same-named direct call, cfg(not(test)) methods are excluded, and the test-only receiver method remains.
    #[test]
    fn inventory_correlates_test_body_blockers_and_receiver_guards() {
        let inventory = inventory_for(
            r#"
/// Goal: collect only test-reachable unblocked body facts.
/// Scope: level=unit; boundary=worker::run
/// Semantics: test-universe lexical and expression guards control direct and receiver calls.
#[test]
fn guarded(#[cfg(test)] helper: fn()) {
    helper();
    #[cfg(test)]
    service.run_test();
    #[cfg(not(test))]
    service.run_production();
}
"#,
        );

        assert!(inventory.tests[0].facts.direct_function_calls.is_empty());
        assert_eq!(inventory.tests[0].facts.receiver_methods, ["run_test"]);
    }

    /// Goal: preserve nested pattern-field guards in shared Test-universe body facts.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: a cfg(not(test)) field binder is absent in the Test universe, so the same-named direct call remains visible.
    #[test]
    fn inventory_correlates_nested_pattern_field_guards() {
        let inventory = inventory_for(
            r#"
struct Value { helper: fn() }

/// Goal: retain the call not shadowed in the Test universe.
/// Scope: level=unit; boundary=worker::run
/// Semantics: the nested cfg(not(test)) binder cannot suppress the test-visible helper call.
#[test]
fn guarded(value: Value) {
    let Value { #[cfg(not(test))] helper } = value;
    helper();
}
"#,
        );

        assert_eq!(inventory.tests[0].facts.direct_function_calls, ["helper"]);
    }

    /// Goal: expose missing GSS and forbidden generated rstest dimensions in one inventory entry.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: the issue set contains both the missing contract and values-forbidden codes without suppressing either family.
    #[test]
    fn inventory_reports_invalid_gss_and_forbidden_rstest_dimensions() {
        let inventory = inventory_for(
            r#"
#[rstest]
fn generated_dimension(#[values(1, 2)] value: usize) {
    assert!(value > 0);
}
"#,
        );

        let codes = inventory.tests[0]
            .issues
            .iter()
            .map(|issue| issue.code.as_str())
            .collect::<BTreeSet<_>>();
        assert!(codes.contains("rust-test-contract-missing"));
        assert!(codes.contains("rust-rstest-values-forbidden"));
    }

    /// Goal: reject conditional doc attributes as GSS carriers.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: conditional-only docs and an extra conditional doc beside complete direct GSS both produce carrier-invalid evidence.
    #[test]
    fn inventory_rejects_conditional_gss_carriers() {
        let inventory = inventory_for(
            r#"
#[cfg_attr(feature = "x", doc = "Goal: conditional goal.")]
#[cfg_attr(feature = "x", doc = "Scope: level=unit; boundary=worker::run")]
#[cfg_attr(feature = "x", doc = "Semantics: conditional semantics.")]
#[test]
fn conditional_only() { assert!(true); }

/// Goal: preserve direct GSS only.
/// Scope: level=unit; boundary=worker::run
/// Semantics: an extra conditional doc remains invalid.
#[cfg_attr(feature = "x", doc = "extra documentation")]
#[test]
fn direct_plus_conditional() { assert!(true); }
"#,
        );

        for test in &inventory.tests {
            assert!(
                test.issues
                    .iter()
                    .any(|issue| { issue.code == TestIssueCode::ContractCarrierInvalid })
            );
        }
    }

    /// Goal: freeze the V1 issue and shape wire ownership without duplicate contract issue arrays.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory serialization
    /// Semantics: issues carry contract or shape categories, contract omits its internal issue cache, and shape exposes carrier activation plus rstest case attributes.
    #[test]
    fn inventory_v1_serializes_typed_issues_and_shape_activation() {
        let inventory = inventory_for(
            r#"
#[ignore = "empty input is unsupported"]
#[case::empty("")]
#[case::value("x")]
#[rstest]
fn validates(#[case] input: &str) { assert!(!input.is_empty()); }
"#,
        );

        let value = serde_json::to_value(&inventory).expect("serialize inventory");
        let test = &value["tests"][0];
        assert!(test["contract"].get("issues").is_none());
        assert_eq!(test["issues"][0]["category"], "contract");
        assert_eq!(test["shape"]["carriers"][0]["binding"], "template");
        assert!(
            test["shape"]["carriers"][0]["activation"]
                .as_str()
                .is_some_and(|activation| !activation.is_empty())
        );
        assert_eq!(
            test["shape"]["rstest"]["cases"][0]["attributes"][0]["syntax"],
            "ignore = \"empty input is unsupported\""
        );
        assert_eq!(
            test["shape"]["rstest"]["cases"][0]["attributes"][0]["binding"],
            "case"
        );
        assert_eq!(
            test["shape"]["rstest"]["cases"][1]["attributes"],
            serde_json::json!([])
        );
        assert!(test["occurrence_id"].as_str().is_some_and(
            |identity| identity.starts_with("occ:") && !identity.contains("occurrence-")
        ));
        assert!(
            test["test_id"]
                .as_str()
                .is_some_and(|identity| !identity.contains("occurrence-"))
        );
    }

    /// Goal: preserve rstest case buffers and trailing template defaults as distinct facts.
    /// Scope: level=contract; boundary=test_analysis::RstestFacts
    /// Semantics: pre-case attributes bind only to the following case while trailing attributes merge into every effective case.
    #[test]
    fn rstest_attributes_preserve_case_and_template_binding() {
        let inventory = inventory_for(
            r#"
/// Goal: preserve rstest attribute placement.
/// Scope: level=contract; boundary=test_analysis::RstestFacts
/// Semantics: case and template attributes retain their source binding.
#[ignore = "first case"]
#[case::first(1)]
#[ignore = "second case"]
#[case::second(2)]
#[should_panic]
#[rstest]
fn matrix(#[case] value: usize) { assert!(value > 0); }
"#,
        );

        let rstest = &inventory.tests[0].shape.rstest;
        assert_eq!(rstest.cases[0].attributes[0].binding, "case");
        assert_eq!(
            rstest.cases[0].attributes[0].syntax,
            "ignore = \"first case\""
        );
        assert_eq!(
            rstest.cases[1].attributes[0].syntax,
            "ignore = \"second case\""
        );
        assert_eq!(rstest.template_attributes[0].binding, "template");
        assert_eq!(rstest.template_attributes[0].syntax, "should_panic");
        assert!(rstest.cases.iter().all(|case| {
            case.effective_attributes
                .iter()
                .any(|fact| fact.syntax == "should_panic")
        }));
        assert!(
            inventory.tests[0]
                .issues
                .iter()
                .all(|issue| issue.code != TestIssueCode::TestIgnoreReason)
        );
    }

    /// Goal: keep rstest parameter ignore as injection metadata rather than fixture capability.
    /// Scope: level=contract; boundary=test_analysis::RstestFacts
    /// Semantics: a single-scenario rstest with only an ignored parameter remains capability-invalid.
    #[test]
    fn rstest_parameter_ignore_does_not_create_fixture_capability() {
        let inventory = inventory_for(
            r#"
/// Goal: reject a false fixture capability.
/// Scope: level=contract; boundary=test_analysis::RstestFacts
/// Semantics: parameter ignore does not satisfy the single-scenario capability requirement.
#[rstest]
fn ignored_parameter(#[ignore] value: usize) { assert_eq!(value, 0); }
"#,
        );

        let test = &inventory.tests[0];
        assert!(test.shape.rstest.fixture_parameters.is_empty());
        assert!(
            test.issues
                .iter()
                .any(|issue| issue.code == TestIssueCode::RstestNoCapability)
        );
    }

    /// Goal: distinguish mutually exclusive conditional ignore reasons from simultaneously effective duplicates.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: inverse guards produce no duplicate-ignore issue while overlapping guards still produce one.
    #[test]
    fn conditional_ignore_requires_sat_overlap() {
        let inventory = inventory_for(
            r#"
/// Goal: preserve one active ignore reason.
/// Scope: level=contract; boundary=worker::run
/// Semantics: each cfg assignment selects at most one reason.
#[cfg_attr(feature = "x", ignore = "x only")]
#[cfg_attr(not(feature = "x"), ignore = "not x only")]
#[test]
fn exclusive() { assert!(true); }

/// Goal: reject two active ignore reasons.
/// Scope: level=contract; boundary=worker::run
/// Semantics: one cfg assignment activates both reasons and is reported.
#[cfg_attr(feature = "x", ignore = "first")]
#[cfg_attr(feature = "x", ignore = "second")]
#[test]
fn overlapping() { assert!(true); }
"#,
        );

        let exclusive = inventory
            .tests
            .iter()
            .find(|test| test.name == "exclusive")
            .expect("exclusive test");
        assert!(
            exclusive
                .issues
                .iter()
                .all(|issue| issue.code != TestIssueCode::TestIgnoreReason)
        );
        let overlapping = inventory
            .tests
            .iter()
            .find(|test| test.name == "overlapping")
            .expect("overlapping test");
        assert_eq!(
            overlapping
                .issues
                .iter()
                .filter(|issue| issue.code == TestIssueCode::TestIgnoreReason)
                .count(),
            1
        );
    }

    /// Goal: classify a qualified rstest carrier and reject compact case syntax.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: rstest::rstest remains an rstest template and its list-form cases produce the unsupported compact-case issue.
    #[test]
    fn qualified_rstest_carrier_preserves_template_and_compact_case_semantics() {
        let inventory = inventory_for(
            r#"
/// Goal: reject compact qualified cases.
/// Scope: level=contract; boundary=validator::validate
/// Semantics: compact case syntax remains unsupported.
#[rstest::rstest(case(1), case(2))]
fn matrix(value: usize) { assert!(value > 0); }
"#,
        );

        let test = &inventory.tests[0];
        assert_eq!(test.template_kind, "rstest");
        assert!(
            test.issues
                .iter()
                .any(|issue| { issue.code == TestIssueCode::RstestCompactCaseUnsupported })
        );
    }

    /// Goal: prevent semantic case labels from masquerading as rstest capabilities.
    /// Scope: level=contract; boundary=test_analysis::RstestFacts
    /// Semantics: a single case named trace has no trace capability and remains capability-invalid.
    #[test]
    fn rstest_case_label_does_not_create_capability() {
        let inventory = inventory_for(
            r#"
/// Goal: reject a false trace capability.
/// Scope: level=contract; boundary=validator::validate
/// Semantics: the case label is not template capability evidence.
#[case::trace(1)]
#[rstest]
fn one_case(#[case] value: usize) { assert!(value > 0); }
"#,
        );

        let test = &inventory.tests[0];
        assert!(test.shape.rstest.capabilities.is_empty());
        assert!(
            test.issues
                .iter()
                .any(|issue| { issue.code == TestIssueCode::RstestNoCapability })
        );
    }

    /// Goal: require rstest capabilities to coexist with the active template.
    /// Scope: level=contract; boundary=test_analysis::RstestFacts
    /// Semantics: an inverse-guard fixture parameter does not satisfy capability, while an overlapping conditional trace attribute does.
    #[test]
    fn rstest_capability_requires_activation_overlap() {
        let inventory = inventory_for(
            r#"
/// Goal: reject an impossible fixture capability.
/// Scope: level=contract; boundary=validator::validate
/// Semantics: the fixture parameter is absent whenever rstest is active.
#[cfg_attr(not(feature = "x"), rstest)]
fn excluded_fixture(#[cfg(feature = "x")] fixture: usize) { assert_eq!(fixture, 0); }

/// Goal: accept an overlapping trace capability.
/// Scope: level=contract; boundary=validator::validate
/// Semantics: trace and rstest activate under the same assignment.
#[cfg_attr(feature = "x", trace)]
#[cfg_attr(feature = "x", rstest)]
fn included_trace() { assert!(true); }
"#,
        );

        let excluded = inventory
            .tests
            .iter()
            .find(|test| test.name == "excluded_fixture")
            .expect("excluded fixture test");
        assert!(
            excluded
                .issues
                .iter()
                .any(|issue| { issue.code == TestIssueCode::RstestNoCapability })
        );
        let included = inventory
            .tests
            .iter()
            .find(|test| test.name == "included_trace")
            .expect("included trace test");
        assert!(
            included
                .issues
                .iter()
                .all(|issue| { issue.code != TestIssueCode::RstestNoCapability })
        );
    }

    /// Goal: keep block-local callable bodies out of the enclosing test's direct-call evidence.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: only calls executed by the test body are recorded; an uncalled nested function does not create a multi-contract candidate.
    #[test]
    fn inventory_excludes_nested_callable_body_facts() {
        let inventory = inventory_for(
            r#"
/// Goal: record only the enclosing test call boundary.
/// Scope: level=contract; boundary=alpha::run
/// Semantics: nested uncalled functions do not contribute direct-call evidence.
#[test]
fn enclosing() {
    fn nested() { beta::run(); }
    alpha::run();
    assert!(true);
}
"#,
        );

        assert_eq!(
            inventory.tests[0].facts.direct_function_calls,
            ["alpha::run"]
        );
        assert!(
            inventory
                .candidate_groups
                .iter()
                .all(|candidate| { candidate.code != "multi-contract-test" })
        );
    }

    /// Goal: compare test shapes without using the function identifier as candidate evidence.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: the two complete same-contract tests form one medium-confidence parameter matrix candidate containing both test identities.
    #[test]
    fn inventory_groups_identity_free_parameter_candidates() {
        let inventory = inventory_for(
            r#"
/// Goal: classify a supported value.
/// Scope: level=unit; boundary=classifier::classify
/// Semantics: returns the expected class.
#[test]
fn classifies_one() { assert_eq!(classifier::classify(1), "one"); }

/// Goal: classify a supported value.
/// Scope: level=unit; boundary=classifier::classify
/// Semantics: returns the expected class.
#[test]
fn classifies_two() { assert_eq!(classifier::classify(2), "two"); }
"#,
        );

        let candidate = inventory
            .candidate_groups
            .iter()
            .find(|candidate| candidate.code == "parameter-matrix-candidate")
            .expect("parameter matrix candidate");
        assert_eq!(candidate.confidence, "medium");
        assert_eq!(candidate.tests.len(), 2);
        assert!(
            candidate
                .tests
                .iter()
                .any(|test| test.ends_with("classifies_one"))
        );
        assert!(
            candidate
                .tests
                .iter()
                .any(|test| test.ends_with("classifies_two"))
        );
    }

    /// Goal: exclude ordinary conditional production attributes from the source test universe.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory::build_session
    /// Semantics: cfg_attr selecting inline creates no test entry or missing-GSS issue.
    #[test]
    fn inventory_ignores_non_test_cfg_attr() {
        let inventory = inventory_for(
            r#"
#[cfg_attr(feature = "fast", inline)]
fn production_function() {}
#[cfg_attr(test, inline)]
fn condition_named_test() {}
"#,
        );

        assert!(inventory.tests.is_empty());
        assert_eq!(inventory.summary.tests, 0);
    }

    /// Goal: keep the V1 inventory byte-stable when Cargo inputs are repeated or reordered.
    /// Scope: level=contract; boundary=test_analysis::TestContractInventory serialization
    /// Semantics: duplicate, forward, and reverse Cargo selectors serialize to identical reports for the same target set.
    #[test]
    fn inventory_identity_is_stable_across_duplicate_and_reordered_inputs() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-test-inventory-order-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("left/src")).expect("create left fixture");
        std::fs::create_dir_all(root.join("right/src")).expect("create right fixture");
        let source = r#"
/// Goal: preserve stable source identity.
/// Scope: level=contract; boundary=inventory::identity
/// Semantics: the source test remains uniquely addressable.
#[test]
fn stable_identity() { assert!(true); }
"#;
        let left = root.join("left/Cargo.toml");
        let right = root.join("right/Cargo.toml");
        write_manifest(&left, "left_fixture");
        write_manifest(&right, "right_fixture");
        std::fs::write(root.join("left/src/lib.rs"), source).expect("write left source");
        std::fs::write(
            root.join("right/src/lib.rs"),
            source.replace("stable_identity", "other_identity"),
        )
        .expect("write right source");

        let forward = serialized_inventory(&[left.clone(), right.clone()]);
        let reverse = serialized_inventory(&[right.clone(), left.clone()]);
        let duplicate = serialized_inventory(&[left.clone(), right.clone(), left]);
        std::fs::remove_dir_all(&root).expect("remove fixture");

        assert_eq!(reverse, forward);
        assert_eq!(duplicate, forward);
    }

    fn serialized_inventory(paths: &[PathBuf]) -> String {
        let mut session = AnalysisSession::build(paths).expect("analyze inventory fixture");
        let inventory =
            TestContractInventory::build_session(&mut session).expect("build inventory");
        serde_json::to_string(&inventory).expect("serialize inventory")
    }

    fn inventory_for(source: &str) -> TestContractInventory {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-test-inventory-{}-{}",
            std::process::id(),
            FIXTURE_ID.fetch_add(1, Ordering::Relaxed),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).expect("create inventory fixture");
        write_manifest(&root.join("Cargo.toml"), "inventory_fixture");
        std::fs::write(root.join("src/lib.rs"), source).expect("write inventory fixture");
        let mut session =
            AnalysisSession::build(&[root.join("Cargo.toml")]).expect("analyze fixture");
        let inventory =
            TestContractInventory::build_session(&mut session).expect("build inventory");
        std::fs::remove_dir_all(root).expect("remove inventory fixture");
        inventory
    }

    fn write_manifest(path: &Path, package: &str) {
        std::fs::write(
            path,
            format!("[package]\nname = \"{package}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"),
        )
        .expect("write inventory manifest");
    }
}
