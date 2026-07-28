use crate::report_function_usage;
use rstest::rstest;

/// Goal: preserve the TSV contract and module-level caller resolution across local and imported calls.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: the report emits its stable header and exact zero/one/two-caller rows.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

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
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: keep same-named functions isolated by Cargo target identity.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: lib, default-bin, and named-bin functions produce separate rows and do not inherit each other's callers.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::shared\tfixture::entry"));
    assert!(report.contains("1\tfixture:bin:fixture\tfixture::shared\tfixture::main"));
    assert!(report.contains("1\tfixture:bin:tool\tfixture::shared\tfixture::main"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: resolve a package crate-name path from a binary target to the package library.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: direct and nested library calls are attributed to the lib target with the binary main function as caller.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::check_paths\tfixture::main"));
    assert!(
        report.contains("1\tfixture:lib:fixture\tfixture::report_function_usage\tfixture::main")
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: resolve historical module rename imports for usage analysis.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: a call through the renamed module is attributed to the original module function and root caller.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::child::leaf\tfixture::root"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: count impl methods and trait default methods as callers without exposing them as report targets.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: both callable kinds contribute caller identities while their own method names do not become target rows.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

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

/// Goal: count a module function referenced as a function item.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: the iterator callback path is attributed to markers::parse with root as its caller.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::markers::parse\tfixture::root"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: require one production assignment to activate caller and callee together.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: mutually exclusive cfg guards keep the callee row at zero callers.
#[test]
fn function_usage_report_correlates_caller_and_callee_guards() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-guard-correlation-{}",
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
        r#"#[cfg(feature = "selected")]
fn caller() { callee(); }

    #[cfg(not(feature = "selected"))]
fn callee() {}
"#,
    )
    .expect("write lib source fixture");

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("0\tfixture:lib:fixture\tfixture::callee\t"));
    assert!(!report.contains("fixture::callee\tfixture::caller"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: require a source callsite and callee to share one production cfg assignment.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: an expression-level call under the callee's inverse guard does not count as usage, while an overlapping call does.
#[test]
fn function_usage_report_correlates_callsite_guards() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-callsite-guards-{}",
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
        r#"#[cfg(feature = "selected")]
fn excluded() {}

#[cfg(feature = "selected")]
fn included() {}

fn caller() {
    #[cfg(not(feature = "selected"))]
    excluded();
    #[cfg(feature = "selected")]
    included();
}
"#,
    )
    .expect("write lib source fixture");

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("0\tfixture:lib:fixture\tfixture::excluded\t"));
    assert!(report.contains("1\tfixture:lib:fixture\tfixture::included\tfixture::caller"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: correlate guarded import alternatives with caller and callee activation.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: only the import whose guard overlaps its callee contributes the shared caller.
#[test]
fn function_usage_report_correlates_guarded_imports() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-import-guards-{}",
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
        r#"mod left { #[cfg(feature = "selected")] pub fn run() {} }
    mod right { #[cfg(not(feature = "selected"))] pub fn run() {} }

    #[cfg(feature = "selected")]
use crate::left::run as selected;
    #[cfg(not(feature = "selected"))]
use crate::right::run as selected;

fn caller() { selected(); }
"#,
    )
    .expect("write lib source fixture");

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("fixture::left::run\tfixture::caller"));
    assert!(report.contains("fixture::right::run\tfixture::caller"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: unite direct calls and source-visible function value references as one usage relation.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: one caller using both forms contributes exactly one caller to the callee row.
#[test]
fn function_usage_report_unites_call_and_value_reference_usage() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-usage-union-{}",
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
        "fn callee() {}\nfn caller() { callee(); let _value = callee; }\n",
    )
    .expect("write lib source fixture");

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("1\tfixture:lib:fixture\tfixture::callee\tfixture::caller"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: exclude lexical bindings that shadow a module function name.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: parameter, let, and closure bindings named callee add no function-item usage relation.
#[test]
fn function_usage_report_excludes_shadowed_value_paths() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-shadowed-values-{}",
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
        r#"fn callee() {}
fn parameter(callee: usize) { let _ = callee; }
fn local() { let callee = 1; let _ = callee; }
fn closure() { let _ = |callee: usize| callee; }
"#,
    )
    .expect("write lib source fixture");

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("0\tfixture:lib:fixture\tfixture::callee\t"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: preserve exact caller projection across source-visible lexical blocker regions.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: each named lexical scenario blocks paths only in its valid region and activation, producing the declared exact caller row.
#[rstest]
#[case::control_flow_patterns(
    "control-flow",
    r#"fn callee() {}
fn outside() { callee(); }
fn if_let(value: Option<fn()>) { if let Some(callee) = value && { callee(); true } { callee(); } }
fn while_let(mut value: Option<fn()>) { while let Some(callee) = value.take() && { callee(); false } { callee(); } }
fn matched(value: Option<fn()>) { match value { Some(callee) if { callee(); true } => callee(), _ => {} } }
fn looped(values: Vec<fn()>) { for callee in values { callee(); } }
"#,
    "1\tfixture:lib:fixture\tfixture::callee\tfixture::outside"
)]
#[case::guarded_local_item(
    "guarded-blocker",
    r#"fn callee() {}
fn caller() {
    #[cfg(feature = "x")]
    fn callee() {}
    #[cfg(not(feature = "x"))]
    callee();
}
"#,
    "1\tfixture:lib:fixture\tfixture::callee\tfixture::caller"
)]
#[case::guarded_function_input(
    "guarded-input",
    r#"fn callee() {}
fn caller(#[cfg(feature = "x")] callee: fn()) { callee(); }
"#,
    "1\tfixture:lib:fixture\tfixture::callee\tfixture::caller"
)]
#[case::let_initializer_order(
    "let-order",
    r#"fn callee() -> Option<fn()> { None }
fn plain() { let callee = callee(); let _ = callee; }
fn diverging() { let Some(callee) = callee() else { return; }; let _ = callee; }
"#,
    "2\tfixture:lib:fixture\tfixture::callee\tfixture::diverging,fixture::plain"
)]
#[case::guarded_closure_and_condition(
    "guarded-patterns",
    r#"fn callee() {}
fn closure() { let _ = |#[cfg(feature = "x")] callee: fn()| callee(); }
fn condition(value: Option<fn()>) {
    if #[cfg(feature = "x")] let Some(callee) = value { callee(); }
    #[cfg(not(feature = "x"))]
    callee();
}
"#,
    "2\tfixture:lib:fixture\tfixture::callee\tfixture::closure,fixture::condition"
)]
#[case::nested_pattern_field(
    "nested-pattern-field",
    r#"struct Value { callee: fn() }
fn callee() {}
fn caller() {
    let _ = |Value { #[cfg(feature = "x")] callee }| callee();
}
"#,
    "1\tfixture:lib:fixture\tfixture::callee\tfixture::caller"
)]
#[case::grouped_self_import(
    "local-use-self",
    r#"mod path_head { pub fn callee() {} }
fn caller() {
    use crate::path_head::{self};
    path_head::callee();
}
"#,
    "0\tfixture:lib:fixture\tfixture::path_head::callee\t"
)]
fn function_usage_report_applies_lexical_blocker_regions(
    #[case] fixture_name: &str,
    #[case] source: &str,
    #[case] expected_row: &str,
) {
    let root = lexical_fixture(fixture_name, source);
    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");
    assert!(report.contains(expected_row));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: predeclare block-local item names in their Rust namespaces without traversing item bodies.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: local fn/const/static/tuple-struct block bare values, modules and named structs block path heads, and no local item body becomes an outer caller.
#[test]
fn function_usage_report_applies_block_item_predeclarations() {
    let root = lexical_fixture(
        "block-items",
        r#"fn callee() {}
mod path_head { pub fn callee() {} }
fn outside() { callee(); path_head::callee(); }
fn local_items() {
    callee();
    path_head::callee();
    fn callee() { crate::callee(); }
    mod path_head { pub fn callee() { crate::callee(); } }
}
fn local_values() {
    const callee: fn() = || {};
    callee();
    struct Tuple();
    let _ = Tuple;
}
"#,
    );
    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");
    assert!(report.contains("1\tfixture:lib:fixture\tfixture::callee\tfixture::outside"));
    assert!(
        report.contains("1\tfixture:lib:fixture\tfixture::path_head::callee\tfixture::outside")
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: use the complete regular production activation for conditional test carriers.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: caller exists only outside feature x while callee exists only inside x, so no caller edge is reported.
#[test]
fn function_usage_report_excludes_conditional_test_occurrences_from_production() {
    let root = lexical_fixture(
        "conditional-carrier",
        r#"#[cfg_attr(feature = "x", test)]
fn caller() { callee(); }
#[cfg(feature = "x")]
fn callee() {}
"#,
    );
    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");
    assert!(report.contains("0\tfixture:lib:fixture\tfixture::callee\t"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: seed lexical namespaces from callable generic parameters.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: const generic callee blocks bare value usage and type generic module blocks path-head usage, so neither outer function gains caller.
#[test]
fn function_usage_report_blocks_generic_parameter_namespaces() {
    let root = lexical_fixture(
        "generics",
        r#"fn callee() {}
mod Module { pub fn run() {} }
fn caller<const callee: usize, Module>() { let _ = callee; Module::run(); }
"#,
    );
    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");
    assert!(report.contains("0\tfixture:lib:fixture\tfixture::callee\t"));
    assert!(report.contains("0\tfixture:lib:fixture\tfixture::Module::run\t"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

fn lexical_fixture(name: &str, source: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-lexical-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("create source fixture");
    std::fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .expect("write cargo fixture");
    std::fs::write(root.join("src/lib.rs"), source).expect("write source fixture");
    root
}

/// Goal: keep block-local callable bodies outside the enclosing function usage scope.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: local impl and trait default bodies do not attribute their calls to outer.
#[test]
fn function_usage_report_excludes_block_local_callable_bodies() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-local-callables-{}",
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
        r#"fn callee() {}
fn outer() {
    struct Local;
    impl Local { fn nested() { callee(); } }
    trait Workflow { fn nested() { callee(); } }
}
"#,
    )
    .expect("write lib source fixture");

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("0\tfixture:lib:fixture\tfixture::callee\t"));
    assert!(!report.contains("fixture::callee\tfixture::outer"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: exclude test-only callable bodies from production function usage.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: cfg(test) module functions, impl methods, and trait defaults add no production callers.
#[test]
fn function_usage_report_excludes_test_only_callables() {
    let root = std::env::temp_dir().join(format!(
        "ousia-rust-checker-report-test-callables-{}",
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

#[cfg(test)]
fn test_caller() { shared(); }

struct Service;
#[cfg(test)]
impl Service { fn run() { shared(); } }

#[cfg(test)]
trait Workflow { fn run() { shared(); } }
"#,
    )
    .expect("write lib source fixture");

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("0\tfixture:lib:fixture\tfixture::shared\t"));
    assert!(!report.contains("fixture::Service::run"));
    assert!(!report.contains("fixture::Workflow::run"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: resolve a module-qualified call made inside an impl method.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: markers::parse is reported with Checker::run as the exact caller identity.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(
        report.contains("1\tfixture:lib:fixture\tfixture::markers::parse\tfixture::Checker::run")
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: resolve grouped self imports and renamed function imports.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: both import forms resolve to markers::parse and preserve root as the unique caller.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(
        report.contains(
            "1\tfixture:lib:fixture\tfixture::markers::parse\tfixture::rule::Checker::run"
        )
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: sort function usage rows by global unique-caller count.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: hot precedes warm by three callers versus one, while the zero-caller cold function remains present.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");
    let rows = report.lines().skip(1).collect::<Vec<_>>();

    assert!(rows[0].starts_with("3\tfixture:lib:fixture\tfixture::hot\t"));
    assert!(rows[1].starts_with("1\tfixture:lib:fixture\tfixture::warm\t"));
    assert!(
        rows.iter()
            .any(|row| row.starts_with("0\tfixture:lib:fixture\tfixture::cold\t"))
    );
    std::fs::remove_dir_all(root).expect("remove fixture root");
}

/// Goal: keep same-named Cargo targets isolated across workspace packages.
/// Scope: level=contract; boundary=report_function_usage
/// Semantics: first and second package functions retain separate target rows and caller sets.
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

    let report = report_function_usage(&[root.join("Cargo.toml")]).expect("build report");

    assert!(report.contains("1\tfirst:bin:tool\tfirst::shared\tfirst::main"));
    assert!(report.contains("1\tsecond:bin:tool\tsecond::shared\tsecond::main"));
    std::fs::remove_dir_all(root).expect("remove fixture root");
}
