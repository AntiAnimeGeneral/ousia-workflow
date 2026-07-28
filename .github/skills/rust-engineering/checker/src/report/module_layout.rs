use std::path::{Component, Path, PathBuf};

use crate::analysis::module_graph::InclusionKind;
use crate::analysis::{AnalysisSession, FatalError, ModuleView};

struct ModuleLayoutRow {
    target: String,
    module: String,
    current_path: String,
    recommended_path: String,
    kind: &'static str,
    reason: &'static str,
}

#[doc = "ousia: ownerless-fn module layout report application"]
pub(crate) fn build_session(session: &mut AnalysisSession) -> Result<String, FatalError> {
    let mut rows = session
        .production_file_modules()?
        .iter()
        .filter_map(module_layout_view_row)
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        left.target
            .cmp(&right.target)
            .then_with(|| left.module.cmp(&right.module))
            .then_with(|| left.current_path.cmp(&right.current_path))
    });
    Ok(render_rows(rows))
}

#[doc = "ousia: ownerless-fn module layout row projection"]
fn module_layout_view_row(module: &ModuleView<'_>) -> Option<ModuleLayoutRow> {
    let current_path = module.path();
    if matches!(
        module.inclusion(),
        InclusionKind::CrateRoot | InclusionKind::Inline
    ) || !current_path
        .file_name()
        .is_some_and(|name| name == "mod.rs")
    {
        return None;
    }
    let custom_path = matches!(module.inclusion(), InclusionKind::PathAttribute);
    Some(ModuleLayoutRow {
        target: module.root_label(),
        module: format_module_path(module.module_path()),
        current_path: current_path.display().to_string(),
        recommended_path: if custom_path {
            String::new()
        } else {
            recommended_mod_path(current_path)
                .map(|path| path.display().to_string())
                .unwrap_or_default()
        },
        kind: if custom_path {
            "custom_path_mod_rs"
        } else {
            "mod_rs"
        },
        reason: if custom_path {
            "custom path points to mod.rs; review manually"
        } else {
            "Rust 2018 layout can use module.rs with nested module directory"
        },
    })
}

#[doc = "ousia: ownerless-fn local helper for module layout path recommendation"]
fn recommended_mod_path(path: &Path) -> Option<PathBuf> {
    let mut components = path.components().collect::<Vec<_>>();
    let [
        ..,
        Component::Normal(module_name),
        Component::Normal(file_name),
    ] = components.as_slice()
    else {
        return None;
    };
    if *file_name != "mod.rs" {
        return None;
    }
    let module_file = format!("{}.rs", module_name.to_string_lossy());
    components.pop();
    components.pop();
    let mut recommended = PathBuf::new();
    for component in components {
        recommended.push(component.as_os_str());
    }
    recommended.push(module_file);
    Some(recommended)
}

#[doc = "ousia: ownerless-fn local helper for module path display in module layout report"]
fn format_module_path(module_path: &[String]) -> String {
    if module_path.is_empty() {
        return "crate".to_owned();
    }
    module_path.join("::")
}

#[doc = "ousia: ownerless-fn local helper for module layout TSV rendering"]
fn render_rows(rows: Vec<ModuleLayoutRow>) -> String {
    let mut output = String::from("target\tmodule\tcurrent_path\trecommended_path\tkind\treason\n");
    for row in rows {
        output.push_str(&format!(
            "{}\t{}\t{}\t{}\t{}\t{}\n",
            row.target, row.module, row.current_path, row.recommended_path, row.kind, row.reason,
        ));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Goal: render ordinary mod.rs modules as ordered Rust 2018 layout candidates.
    /// Scope: level=contract; boundary=report_module_layout
    /// Semantics: both nested modules retain exact current/recommended paths, kind, reason, target, and stable TSV order.
    #[test]
    fn module_layout_report_lists_mod_rs_modules() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-module-layout-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/report/function_usage"))
            .expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(root.join("src/lib.rs"), "mod report;\n").expect("write lib fixture");
        std::fs::write(root.join("src/report/mod.rs"), "mod function_usage;\n")
            .expect("write report fixture");
        std::fs::write(root.join("src/report/function_usage/mod.rs"), "")
            .expect("write nested report fixture");

        let report = module_layout_report(&root);
        let canonical_root = root.canonicalize().expect("canonical fixture root");

        assert_eq!(
            report,
            format!(
                "target\tmodule\tcurrent_path\trecommended_path\tkind\treason\n\
fixture:lib:fixture\treport\t{report_mod}\t{report_rs}\tmod_rs\tRust 2018 layout can use module.rs with nested module directory\n\
fixture:lib:fixture\treport::function_usage\t{function_usage_mod}\t{function_usage_rs}\tmod_rs\tRust 2018 layout can use module.rs with nested module directory\n",
                report_mod = canonical_root.join("src/report/mod.rs").display(),
                report_rs = canonical_root.join("src/report.rs").display(),
                function_usage_mod = canonical_root
                    .join("src/report/function_usage/mod.rs")
                    .display(),
                function_usage_rs = canonical_root
                    .join("src/report/function_usage.rs")
                    .display(),
            ),
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    /// Goal: preserve manual review semantics for path-selected mod.rs modules.
    /// Scope: level=contract; boundary=report_module_layout
    /// Semantics: a custom path row has no automatic recommendation and carries the custom/manual kind and reason.
    #[test]
    fn module_layout_report_marks_custom_path_mod_rs_manual() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-module-layout-path-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/custom")).expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(
            root.join("src/lib.rs"),
            "#[path = \"custom/mod.rs\"]\nmod custom;\n",
        )
        .expect("write lib fixture");
        std::fs::write(root.join("src/custom/mod.rs"), "").expect("write custom fixture");

        let report = module_layout_report(&root);
        let canonical_root = root.canonicalize().expect("canonical fixture root");

        assert_eq!(
            report,
            format!(
                "target\tmodule\tcurrent_path\trecommended_path\tkind\treason\n\
fixture:lib:fixture\tcustom\t{custom_mod}\t\tcustom_path_mod_rs\tcustom path points to mod.rs; review manually\n",
                custom_mod = canonical_root.join("src/custom/mod.rs").display(),
            ),
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    fn module_layout_report(root: &Path) -> String {
        crate::report_module_layout(&[root.join("Cargo.toml")]).expect("build module layout report")
    }
}
