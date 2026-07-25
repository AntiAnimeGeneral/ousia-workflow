use std::path::{Path, PathBuf};

use proc_macro2::LineColumn;
use syn::LitStr;

use crate::diagnostic::Diagnostic;
use crate::source_files::SourceSet;

pub(crate) struct ParsedCrateSet {
    modules: Vec<ParsedModule>,
}

pub(crate) struct ParsedModule {
    root_label: String,
    package_name: Option<String>,
    lib_crate_name: Option<String>,
    path: PathBuf,
    module_path: Vec<String>,
    crate_root: bool,
    custom_path: bool,
    parsed: Result<syn::File, ParseFailure>,
}

struct ParseFailure {
    location: LineColumn,
    message: String,
}

impl ParsedCrateSet {
    pub(crate) fn parse(sources: &SourceSet) -> Result<Self, std::io::Error> {
        let mut modules = Vec::new();
        for root in sources.roots() {
            Self::parse_module_tree(
                root.label(),
                root.package_name(),
                root.lib_crate_name(),
                root.path(),
                Vec::new(),
                true,
                false,
                &mut modules,
            )?;
        }
        modules.sort_by(|left, right| {
            left.root_label
                .cmp(&right.root_label)
                .then_with(|| left.path.cmp(&right.path))
        });
        modules
            .dedup_by(|left, right| left.root_label == right.root_label && left.path == right.path);
        Ok(Self { modules })
    }

    pub(crate) fn modules(&self) -> &[ParsedModule] {
        &self.modules
    }

    #[doc = "ousia: ownerless-method module tree parsing is a static traversal helper"]
    fn parse_module_tree(
        root_label: &str,
        package_name: Option<&str>,
        lib_crate_name: Option<&str>,
        path: &Path,
        module_path: Vec<String>,
        crate_root: bool,
        custom_path: bool,
        modules: &mut Vec<ParsedModule>,
    ) -> Result<(), std::io::Error> {
        let source = std::fs::read_to_string(path)?;
        let parsed = match syn::parse_file(&source) {
            Ok(file) => Ok(file),
            Err(error) => Err(ParseFailure {
                location: error.span().start(),
                message: error.to_string(),
            }),
        };
        let Ok(file) = &parsed else {
            modules.push(ParsedModule {
                root_label: root_label.to_owned(),
                package_name: package_name.map(str::to_owned),
                lib_crate_name: lib_crate_name.map(str::to_owned),
                path: path.to_path_buf(),
                module_path,
                crate_root,
                custom_path,
                parsed,
            });
            return Ok(());
        };
        let children = Self::out_of_line_modules(path, crate_root, file);
        modules.push(ParsedModule {
            root_label: root_label.to_owned(),
            package_name: package_name.map(str::to_owned),
            lib_crate_name: lib_crate_name.map(str::to_owned),
            path: path.to_path_buf(),
            module_path: module_path.clone(),
            crate_root,
            custom_path,
            parsed,
        });
        for child in children {
            let mut child_module_path = module_path.clone();
            child_module_path.push(child.name);
            Self::parse_module_tree(
                root_label,
                package_name,
                lib_crate_name,
                &child.path,
                child_module_path,
                false,
                child.custom_path,
                modules,
            )?;
        }
        Ok(())
    }

    #[doc = "ousia: ownerless-method out-of-line module discovery is a static helper"]
    fn out_of_line_modules(path: &Path, crate_root: bool, file: &syn::File) -> Vec<ModuleChild> {
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let default_file_root = if crate_root || stem == "mod" {
            parent.to_path_buf()
        } else {
            parent.join(stem)
        };
        let mut children = Vec::new();
        for item in &file.items {
            let syn::Item::Mod(module) = item else {
                continue;
            };
            if module.content.is_some() || Self::is_test_module(&module.attrs) {
                continue;
            }
            let module_name = module.ident.to_string();
            for candidate in Self::module_candidates(
                parent,
                &default_file_root,
                &module_name,
                crate_root || stem == "mod",
                &module.attrs,
            ) {
                if candidate.path.is_file() {
                    children.push(ModuleChild {
                        name: module_name,
                        path: candidate.path,
                        custom_path: candidate.custom_path,
                    });
                    break;
                }
            }
        }
        children
    }

    #[doc = "ousia: ownerless-method module candidate selection is a static helper"]
    fn module_candidates(
        parent: &Path,
        default_file_root: &Path,
        module_name: &str,
        parent_uses_directory_modules: bool,
        attrs: &[syn::Attribute],
    ) -> Vec<ModuleCandidate> {
        if let Some(path) = Self::path_attr(attrs) {
            return vec![ModuleCandidate {
                path: parent.join(path.value()),
                custom_path: true,
            }];
        }
        if parent_uses_directory_modules {
            return vec![
                ModuleCandidate {
                    path: parent.join(format!("{module_name}.rs")),
                    custom_path: false,
                },
                ModuleCandidate {
                    path: parent.join(module_name).join("mod.rs"),
                    custom_path: false,
                },
            ];
        }
        vec![
            ModuleCandidate {
                path: default_file_root.join(format!("{module_name}.rs")),
                custom_path: false,
            },
            ModuleCandidate {
                path: default_file_root.join(module_name).join("mod.rs"),
                custom_path: false,
            },
        ]
    }

    #[doc = "ousia: ownerless-method path attribute decoding is a static helper"]
    fn path_attr(attrs: &[syn::Attribute]) -> Option<LitStr> {
        attrs.iter().find_map(|attr| {
            let syn::Meta::NameValue(meta) = &attr.meta else {
                return None;
            };
            if !meta.path.is_ident("path") {
                return None;
            }
            let syn::Expr::Lit(expr) = &meta.value else {
                return None;
            };
            let syn::Lit::Str(value) = &expr.lit else {
                return None;
            };
            Some(value.clone())
        })
    }

    #[doc = "ousia: ownerless-method test module detection is a static helper"]
    fn is_test_module(attrs: &[syn::Attribute]) -> bool {
        attrs.iter().any(|attr| {
            let syn::Meta::List(meta) = &attr.meta else {
                return false;
            };
            meta.path.is_ident("cfg") && meta.tokens.to_string() == "test"
        })
    }
}

impl ParsedModule {
    pub(crate) fn root_label(&self) -> &str {
        &self.root_label
    }

    pub(crate) fn package_name(&self) -> Option<&str> {
        self.package_name.as_deref()
    }

    pub(crate) fn lib_crate_name(&self) -> Option<&str> {
        self.lib_crate_name.as_deref()
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn module_path(&self) -> &[String] {
        &self.module_path
    }

    pub(crate) fn crate_root(&self) -> bool {
        self.crate_root
    }

    pub(crate) fn custom_path(&self) -> bool {
        self.custom_path
    }

    pub(crate) fn parsed_file(&self) -> Result<&syn::File, Diagnostic> {
        match &self.parsed {
            Ok(file) => Ok(file),
            Err(error) => Err(Diagnostic::new(
                "rust-parse-error",
                &self.path,
                error.location,
                error.message.clone(),
            )),
        }
    }
}

struct ModuleChild {
    name: String,
    path: PathBuf,
    custom_path: bool,
}

struct ModuleCandidate {
    path: PathBuf,
    custom_path: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsed_crate_set_preserves_module_paths() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-crate-ast-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/child")).expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(root.join("src/lib.rs"), "mod child;\n").expect("write lib source fixture");
        std::fs::write(root.join("src/child.rs"), "mod grandchild;\n")
            .expect("write child source fixture");
        std::fs::write(root.join("src/child/grandchild.rs"), "")
            .expect("write grandchild source fixture");

        let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
        let parsed = ParsedCrateSet::parse(&sources).expect("parse crate set");
        let module_paths: Vec<Vec<String>> = parsed
            .modules()
            .iter()
            .map(|module| module.module_path().to_vec())
            .collect();

        assert_eq!(
            module_paths,
            [
                vec!["child".to_string(), "grandchild".to_string()],
                vec!["child".to_string()],
                Vec::<String>::new(),
            ],
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn parsed_crate_set_follows_path_attribute_modules() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-path-attr-{}",
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
            "#[path = \"custom/actual.rs\"]\nmod aliased;\n",
        )
        .expect("write lib source fixture");
        std::fs::write(root.join("src/custom/actual.rs"), "")
            .expect("write aliased module fixture");

        let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
        let parsed = ParsedCrateSet::parse(&sources).expect("parse crate set");
        let paths: Vec<PathBuf> = parsed
            .modules()
            .iter()
            .map(|module| module.path().to_path_buf())
            .collect();

        assert_eq!(
            paths,
            [root.join("src/custom/actual.rs"), root.join("src/lib.rs")],
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn parsed_crate_set_resolves_nested_file_modules_before_siblings() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-nested-sibling-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/child")).expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(root.join("src/lib.rs"), "mod child;\n").expect("write lib source fixture");
        std::fs::write(root.join("src/child.rs"), "mod grandchild;\n")
            .expect("write child source fixture");
        std::fs::write(root.join("src/grandchild.rs"), "").expect("write sibling module fixture");
        std::fs::write(root.join("src/child/grandchild.rs"), "")
            .expect("write nested module fixture");

        let sources = SourceSet::discover(&[root.join("Cargo.toml")]).expect("discover sources");
        let parsed = ParsedCrateSet::parse(&sources).expect("parse crate set");
        let paths: Vec<PathBuf> = parsed
            .modules()
            .iter()
            .map(|module| module.path().to_path_buf())
            .collect();

        assert_eq!(
            paths,
            [
                root.join("src/child/grandchild.rs"),
                root.join("src/child.rs"),
                root.join("src/lib.rs"),
            ],
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }
}
