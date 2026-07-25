use std::path::{Component, Path, PathBuf};

use crate::crate_ast::{ParsedCrateSet, ParsedModule};

pub(crate) struct ModuleLayoutReport;

struct ModuleLayoutRow {
    target: String,
    module: String,
    current_path: String,
    recommended_path: String,
    kind: &'static str,
    reason: &'static str,
}

impl ModuleLayoutReport {
    #[doc = "ousia: ownerless-method module layout report construction is a static helper"]
    pub(crate) fn build(parsed: &ParsedCrateSet) -> Result<String, std::io::Error> {
        let mut rows = parsed
            .modules()
            .iter()
            .filter_map(module_layout_row)
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            left.target
                .cmp(&right.target)
                .then_with(|| left.module.cmp(&right.module))
                .then_with(|| left.current_path.cmp(&right.current_path))
        });
        Ok(render_rows(rows))
    }
}

#[doc = "ousia: ownerless-fn local helper for module layout report row construction"]
fn module_layout_row(module: &ParsedModule) -> Option<ModuleLayoutRow> {
    let current_path = module.path();
    if module.crate_root() {
        return None;
    }
    if !current_path
        .file_name()
        .is_some_and(|name| name == "mod.rs")
    {
        return None;
    }
    let recommended_path = if module.custom_path() {
        String::new()
    } else {
        recommended_mod_path(current_path)
            .map(|path| path.display().to_string())
            .unwrap_or_default()
    };
    Some(ModuleLayoutRow {
        target: module.root_label().to_owned(),
        module: format_module_path(module.module_path()),
        current_path: current_path.display().to_string(),
        recommended_path,
        kind: if module.custom_path() {
            "custom_path_mod_rs"
        } else {
            "mod_rs"
        },
        reason: if module.custom_path() {
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
    use crate::crate_ast::ParsedCrateSet;
    use crate::source_files::SourceSet;

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

        assert_eq!(
            report,
            format!(
                "target\tmodule\tcurrent_path\trecommended_path\tkind\treason\n\
fixture:lib:fixture\treport\t{report_mod}\t{report_rs}\tmod_rs\tRust 2018 layout can use module.rs with nested module directory\n\
fixture:lib:fixture\treport::function_usage\t{function_usage_mod}\t{function_usage_rs}\tmod_rs\tRust 2018 layout can use module.rs with nested module directory\n",
                report_mod = root.join("src/report/mod.rs").display(),
                report_rs = root.join("src/report.rs").display(),
                function_usage_mod = root.join("src/report/function_usage/mod.rs").display(),
                function_usage_rs = root.join("src/report/function_usage.rs").display(),
            ),
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

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

        assert_eq!(
            report,
            format!(
                "target\tmodule\tcurrent_path\trecommended_path\tkind\treason\n\
fixture:lib:fixture\tcustom\t{custom_mod}\t\tcustom_path_mod_rs\tcustom path points to mod.rs; review manually\n",
                custom_mod = root.join("src/custom/mod.rs").display(),
            ),
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn module_layout_report_skips_raw_mod_rs_roots() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-module-layout-raw-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/report")).expect("create source fixture");
        std::fs::write(root.join("src/lib.rs"), "mod report;\n").expect("write lib fixture");
        std::fs::write(root.join("src/report/mod.rs"), "").expect("write report fixture");

        let sources = SourceSet::discover(&[root.join("src")]).expect("discover sources");
        let parsed = ParsedCrateSet::parse(&sources).expect("parse crate set");
        let report = ModuleLayoutReport::build(&parsed).expect("build module layout report");

        assert_eq!(
            report,
            format!(
                "target\tmodule\tcurrent_path\trecommended_path\tkind\treason\n\
source:{lib_rs}\treport\t{report_mod}\t{report_rs}\tmod_rs\tRust 2018 layout can use module.rs with nested module directory\n",
                lib_rs = root.join("src/lib.rs").display(),
                report_mod = root.join("src/report/mod.rs").display(),
                report_rs = root.join("src/report.rs").display(),
            ),
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    fn module_layout_report(root: &Path) -> String {
        let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
        let parsed = ParsedCrateSet::parse(&sources).expect("parse crate set");
        ModuleLayoutReport::build(&parsed).expect("build module layout report")
    }
}
