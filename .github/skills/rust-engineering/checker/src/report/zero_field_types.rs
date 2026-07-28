use serde::Serialize;

use crate::analysis::type_facts::TypeAssociationWarning;
use crate::analysis::{AnalysisSession, FatalError};

#[derive(Serialize)]
struct ZeroFieldTypeReport {
    schema_version: &'static str,
    report_kind: &'static str,
    candidates: Vec<ZeroFieldCandidate>,
    warnings: Vec<ReportWarning>,
}

#[derive(Serialize)]
struct ZeroFieldCandidate {
    code: &'static str,
    type_id: String,
    target: String,
    module: String,
    source: SourceLocation,
    name: String,
    shape: &'static str,
    visibility: String,
    inherent_impls: Vec<InherentImplEvidence>,
}

#[derive(Serialize)]
struct SourceLocation {
    path: String,
    line: usize,
    column: usize,
}

#[derive(Serialize)]
struct InherentImplEvidence {
    impl_id: String,
    source: SourceLocation,
    member_count: usize,
}

#[derive(Serialize)]
struct ReportWarning {
    code: &'static str,
    message: &'static str,
}

#[doc = "ousia: ownerless-fn zero-field type report application"]
pub(crate) fn build_session(session: &AnalysisSession) -> Result<String, FatalError> {
    let mut candidates = session
        .zero_field_types()
        .map(|fact| ZeroFieldCandidate {
            code: "zero-field-inherent-only-candidate",
            type_id: fact.id.to_owned(),
            target: fact.target.to_owned(),
            module: fact.module.to_owned(),
            source: SourceLocation {
                path: fact.source.to_owned(),
                line: fact.location.line,
                column: fact.location.column + 1,
            },
            name: fact.name.to_owned(),
            shape: fact.shape,
            visibility: fact.visibility.to_owned(),
            inherent_impls: fact
                .inherent_impls
                .into_iter()
                .map(|implementation| InherentImplEvidence {
                    impl_id: implementation.id.to_owned(),
                    source: SourceLocation {
                        path: implementation.source.to_owned(),
                        line: implementation.location.line,
                        column: implementation.location.column + 1,
                    },
                    member_count: implementation.member_count,
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.type_id.cmp(&right.type_id));
    let mut warnings = vec![
        ReportWarning {
            code: "value-usage-not-analyzed",
            message: "construction, storage, passing, and borrowing usage is not analyzed",
        },
        ReportWarning {
            code: "macro-generated-impl-not-collected",
            message: "macro-generated impls are not collected from source AST",
        },
        ReportWarning {
            code: "external-trait-semantics-not-evaluated",
            message: "external trait semantics are not evaluated",
        },
    ];
    warnings.extend(
        session
            .type_association_warnings()
            .map(|warning| match warning {
                TypeAssociationWarning::Ambiguous => ReportWarning {
                    code: "type-association-ambiguous",
                    message: "multiple guarded nominal targets can overlap for an impl target",
                },
                TypeAssociationWarning::Unresolved => ReportWarning {
                    code: "type-association-unresolved",
                    message: "a guarded alias or import frontier has no proven nominal terminal",
                },
                TypeAssociationWarning::ExternalGlob => ReportWarning {
                    code: "external-glob-not-resolved",
                    message: "a glob import can expose a structurally related nominal target",
                },
            }),
    );
    warnings.sort_by_key(|warning| warning.code);
    serde_json::to_string_pretty(&ZeroFieldTypeReport {
        schema_version: "ousia.rust-zero-field-types.v1",
        report_kind: "rust-zero-field-types",
        candidates,
        warnings,
    })
    .map(|mut output| {
        output.push('\n');
        output
    })
    .map_err(FatalError::render)
}

#[cfg(test)]
mod tests {
    use crate::report_zero_field_types;
    use rstest::rstest;

    /// Goal: report only zero-field structs supported by inherent impl evidence.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: all three zero-field shapes are candidates, empty inherent impls count, and derive or trait evidence suppresses candidates.
    #[test]
    fn zero_field_report_selects_inherent_only_candidates() {
        let root =
            std::env::temp_dir().join(format!("ousia-zero-field-report-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).expect("create fixture source");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write manifest");
        std::fs::write(
            root.join("src/lib.rs"),
            r#"struct Unit;
impl Unit {}
struct Tuple();
impl Tuple { fn value() {} }
struct Named {}
impl Named {}
#[derive(Clone)]
struct Derived;
impl Derived {}
struct TraitBacked;
trait Marker {}
impl TraitBacked {}
impl Marker for TraitBacked {}
struct Fields { value: usize }
impl Fields {}
"#,
        )
        .expect("write source");

        let report = report_zero_field_types(&[root.join("Cargo.toml")]).expect("build report");
        let value: serde_json::Value = serde_json::from_str(&report).expect("parse report");
        let names = value["candidates"]
            .as_array()
            .expect("candidate array")
            .iter()
            .map(|candidate| candidate["name"].as_str().expect("candidate name"))
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            names,
            std::collections::BTreeSet::from(["Named", "Tuple", "Unit"])
        );
        let unit = value["candidates"]
            .as_array()
            .expect("candidate array")
            .iter()
            .find(|candidate| candidate["name"] == "Unit")
            .expect("unit candidate");
        assert_eq!(unit["inherent_impls"][0]["member_count"], 0);
        assert_eq!(value["warnings"].as_array().expect("warnings").len(), 3);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    /// Goal: associate trait evidence through supported local import and alias edges.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: each named association edge delivers trait evidence to its local nominal target and emits no inherent-only candidate.
    #[rstest]
    #[case::named_import(
        "imported-trait",
        r#"mod model {
    pub struct Marker;
    impl Marker {}
}

use model::Marker;
trait LocalTrait {}
impl LocalTrait for Marker {}
"#
    )]
    #[case::guarded_imports(
        "conditional-imports",
        r#"mod left { pub struct Marker; impl Marker {} }
mod right { pub struct Marker; impl Marker {} }

#[cfg(feature = "x")]
use left::Marker;
#[cfg(not(feature = "x"))]
use right::Marker;

trait LocalTrait {}
impl LocalTrait for Marker {}
"#
    )]
    #[case::local_alias(
        "alias-trait",
        r#"struct Marker;
impl Marker {}
type Alias = Marker;
trait Evidence {}
impl Evidence for Alias {}
"#
    )]
    fn zero_field_report_associates_trait_evidence(
        #[case] fixture_name: &str,
        #[case] source: &str,
    ) {
        let report = fixture_report(fixture_name, source);
        assert_eq!(report["candidates"], serde_json::json!([]));
    }

    /// Goal: preserve guarded impl evidence for mutually exclusive same-named zero-field definitions.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: each cfg branch associates with its own Namespace definition instead of becoming ambiguous, yielding two guarded candidates.
    #[test]
    fn zero_field_report_associates_mutually_exclusive_definitions() {
        let root = std::env::temp_dir().join(format!(
            "ousia-zero-field-guard-report-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).expect("create fixture source");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write manifest");
        std::fs::write(
            root.join("src/lib.rs"),
            r#"#[cfg(feature = "x")]
struct Namespace;
#[cfg(not(feature = "x"))]
struct Namespace;
impl Namespace {}
"#,
        )
        .expect("write source");

        let report = report_zero_field_types(&[root.join("Cargo.toml")]).expect("build report");
        let value: serde_json::Value = serde_json::from_str(&report).expect("parse report");
        assert_eq!(value["candidates"].as_array().expect("candidates").len(), 2);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    /// Goal: preserve cfg guards while associating a local alias with its zero-field target.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: guarded alias trait evidence suppresses only its satisfiable Marker branch, leaving the opposite branch as one candidate.
    #[test]
    fn zero_field_report_preserves_alias_guards() {
        let root = std::env::temp_dir().join(format!(
            "ousia-zero-field-alias-guards-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).expect("create fixture source");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write manifest");
        std::fs::write(
            root.join("src/lib.rs"),
            r#"#[cfg(feature = "x")]
struct Marker;
#[cfg(not(feature = "x"))]
struct Marker;
impl Marker {}
#[cfg(feature = "x")]
type Alias = Marker;
trait Evidence {}
impl Evidence for Alias {}
"#,
        )
        .expect("write source");

        let report = report_zero_field_types(&[root.join("Cargo.toml")]).expect("build report");
        let value: serde_json::Value = serde_json::from_str(&report).expect("parse report");
        assert_eq!(value["candidates"].as_array().expect("candidates").len(), 1);
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    /// Goal: close local alias and import worklists independent of declaration shape.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: each named edge graph reaches Marker and suppresses its inherent-only candidate.
    #[rstest]
    #[case::inverse_alias_order(
        "alias-chain",
        r#"type AliasTwo = AliasOne;
type AliasOne = Marker;
struct Marker;
impl Marker {}
trait Evidence {}
impl Evidence for AliasTwo {}
"#
    )]
    #[case::alias_to_import(
        "alias-import",
        r#"mod model { pub struct Marker; impl Marker {} }
use model::Marker;
type Alias = Marker;
trait Evidence {}
impl Evidence for Alias {}
"#
    )]
    #[case::imported_alias_definition(
        "imported-alias",
        r#"struct Marker;
impl Marker {}
mod model { pub type Alias = super::Marker; }
use model::Alias;
trait Evidence {}
impl Evidence for Alias {}
"#
    )]
    fn zero_field_report_closes_alias_import_worklists(
        #[case] fixture_name: &str,
        #[case] source: &str,
    ) {
        let report = fixture_report(fixture_name, source);
        assert_eq!(report["candidates"], serde_json::json!([]));
    }

    /// Goal: preserve exact association for mutually exclusive guarded alias targets.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: each Alias branch receives its own inherent evidence and no ambiguity warning is emitted.
    #[test]
    fn zero_field_report_associates_mutually_exclusive_alias_targets() {
        let report = fixture_report(
            "exclusive-aliases",
            r#"mod left { pub struct Marker; }
mod right { pub struct Marker; }
#[cfg(feature = "x")]
type Alias = left::Marker;
#[cfg(not(feature = "x"))]
type Alias = right::Marker;
impl Alias {}
"#,
        );
        assert_eq!(
            report["candidates"].as_array().expect("candidates").len(),
            2
        );
        assert!(!warning_codes(&report).contains("type-association-ambiguous"));
    }

    /// Goal: report overlapping guarded aliases without assigning impl evidence arbitrarily.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: two simultaneously satisfiable Alias targets suppress both related candidates and emit the stable ambiguity warning.
    #[test]
    fn zero_field_report_warns_for_overlapping_alias_targets() {
        let report = fixture_report(
            "alias-ambiguity",
            r#"mod left { pub struct Marker; impl Marker {} }
mod right { pub struct Marker; impl Marker {} }
#[cfg(feature = "x")]
type Alias = left::Marker;
#[cfg(feature = "y")]
type Alias = right::Marker;
impl Alias {}
"#,
        );
        assert_eq!(report["candidates"], serde_json::json!([]));
        assert!(warning_codes(&report).contains("type-association-ambiguous"));
    }

    /// Goal: report an uncovered alias guard without suppressing an unrelated cfg branch.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: Alias is unresolved outside feature x, while the mutually exclusive Marker fact remains reviewable.
    #[test]
    fn zero_field_report_localizes_uncovered_alias_guards() {
        let report = fixture_report(
            "alias-uncovered-guard",
            r#"#[cfg(feature = "x")]
struct Marker;
#[cfg(not(feature = "x"))]
struct Marker;
impl Marker {}
#[cfg(feature = "x")]
type Alias = Marker;
trait Evidence {}
impl Evidence for Alias {}
"#,
        );
        assert_eq!(
            report["candidates"].as_array().expect("candidates").len(),
            1
        );
        assert!(warning_codes(&report).contains("type-association-unresolved"));
    }

    /// Goal: resolve known local glob frontiers through supported export shapes.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: each named local frontier reaches Marker exactly, applies its actual inherent or trait evidence, and emits no external-glob warning.
    #[rstest]
    #[case::direct_type(
        "glob-frontier",
        r#"mod model { pub struct Marker; impl Marker {} }
use model::*;
impl Marker {}
"#,
        1
    )]
    #[case::exported_alias(
        "glob-alias",
        "struct Marker;\nimpl Marker {}\nmod model { pub type Alias = super::Marker; }\nuse model::*;\ntrait Evidence {}\nimpl Evidence for Alias {}\n",
        0
    )]
    #[case::named_reexport(
        "glob-reexport",
        "mod model { pub struct Marker; impl Marker {} }\nmod facade { pub use crate::model::Marker; }\nuse facade::*;\ntrait Evidence {}\nimpl Evidence for Marker {}\n",
        0
    )]
    fn zero_field_report_preserves_local_glob_frontiers(
        #[case] fixture_name: &str,
        #[case] source: &str,
        #[case] expected_candidates: usize,
    ) {
        let report = fixture_report(fixture_name, source);
        assert_eq!(
            report["candidates"].as_array().expect("candidates").len(),
            expected_candidates
        );
        assert!(!warning_codes(&report).contains("external-glob-not-resolved"));
    }

    /// Goal: preserve explicit local name precedence over a same-named glob export.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: the root Marker impl remains exact and the lower-priority glob does not suppress either local candidate.
    #[test]
    fn zero_field_report_prefers_explicit_local_types_over_globs() {
        let report = fixture_report(
            "glob-precedence",
            "mod model { pub struct Marker; impl Marker {} }\nuse model::*;\nstruct Marker;\nimpl Marker {}\n",
        );
        assert_eq!(
            report["candidates"].as_array().expect("candidates").len(),
            2
        );
        assert!(!warning_codes(&report).contains("external-glob-not-resolved"));
    }

    /// Goal: preserve extern-absolute roots across import and type syntax.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: each named absolute syntax remains external, leaving the same-named local Marker candidate and unresolved warning.
    #[rstest]
    #[case::import(
        "absolute-import",
        "mod dep { pub struct Marker; impl Marker {} }\nuse ::dep::Marker;\ntrait Evidence {}\nimpl Evidence for Marker {}\n"
    )]
    #[case::alias_and_direct_type(
        "absolute-types",
        "mod dep { pub struct Marker; impl Marker {} }\ntype Alias = ::dep::Marker;\ntrait Evidence {}\nimpl Evidence for Alias {}\nimpl Evidence for ::dep::Marker {}\n"
    )]
    fn zero_field_report_does_not_localize_absolute_roots(
        #[case] fixture_name: &str,
        #[case] source: &str,
    ) {
        let report = fixture_report(fixture_name, source);
        assert_eq!(report["candidates"][0]["name"], "Marker");
        assert!(warning_codes(&report).contains("type-association-unresolved"));
    }

    /// Goal: terminate cyclic association worklists with localized uncertainty.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: each named cycle reaches a fixed point, emits unresolved evidence, and leaves Unrelated reviewable.
    #[rstest]
    #[case::alias(
        "alias-cycle",
        "struct Unrelated;\nimpl Unrelated {}\ntype AliasOne = AliasTwo;\ntype AliasTwo = AliasOne;\nimpl AliasOne {}\n"
    )]
    #[case::named_reexport(
        "reexport-cycle",
        "struct Unrelated;\nimpl Unrelated {}\nmod a { pub use crate::b::Marker; }\nmod b { pub use crate::a::Marker; }\nuse a::*;\nimpl Marker {}\n"
    )]
    fn zero_field_report_terminates_association_cycles(
        #[case] fixture_name: &str,
        #[case] source: &str,
    ) {
        let report = fixture_report(fixture_name, source);
        assert_eq!(report["candidates"][0]["name"], "Unrelated");
        assert!(warning_codes(&report).contains("type-association-unresolved"));
    }

    /// Goal: omit glob warnings whose guards cannot overlap the impl activation.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: an explicitly covered local Marker keeps exact evidence and the mutually exclusive unknown glob emits no warning.
    #[test]
    fn zero_field_report_omits_unreachable_glob_warnings() {
        let report = fixture_report(
            "unreachable-glob",
            "struct Marker;\nimpl Marker {}\n#[cfg(feature = \"x\")]\nuse ::external::*;\n#[cfg(not(feature = \"x\"))]\nimpl Marker {}\n",
        );
        assert!(!warning_codes(&report).contains("external-glob-not-resolved"));
    }

    /// Goal: expose an unknown glob frontier without suppressing unrelated candidates.
    /// Scope: level=contract; boundary=report_zero_field_types
    /// Semantics: the external glob warning is present and Unrelated remains reviewable.
    #[test]
    fn zero_field_report_warns_for_unknown_globs_without_global_suppression() {
        let report = fixture_report(
            "unknown-glob",
            "struct Unrelated;\nimpl Unrelated {}\nuse ::external::*;\nimpl Missing {}\n",
        );
        assert_eq!(report["candidates"][0]["name"], "Unrelated");
        assert!(warning_codes(&report).contains("external-glob-not-resolved"));
    }

    fn fixture_report(name: &str, source: &str) -> serde_json::Value {
        let root = fixture_root(name, source);
        let report = report_zero_field_types(&[root.join("Cargo.toml")]).expect("build report");
        let value = serde_json::from_str(&report).expect("parse report");
        std::fs::remove_dir_all(root).expect("remove fixture");
        value
    }

    fn fixture_root(name: &str, source: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("ousia-zero-field-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).expect("create fixture source");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write manifest");
        std::fs::write(root.join("src/lib.rs"), source).expect("write source");
        root
    }

    fn warning_codes(report: &serde_json::Value) -> std::collections::BTreeSet<&str> {
        report["warnings"]
            .as_array()
            .expect("warnings")
            .iter()
            .map(|warning| warning["code"].as_str().expect("warning code"))
            .collect()
    }
}
