use std::path::{Path, PathBuf};

pub struct SourceSet {
    roots: Vec<SourceRoot>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceRoot {
    label: String,
    package_name: Option<String>,
    lib_crate_name: Option<String>,
    path: PathBuf,
}

impl SourceSet {
    pub fn discover(paths: &[PathBuf]) -> Result<Self, std::io::Error> {
        let input_roots = if paths.is_empty() {
            vec![PathBuf::from(".")]
        } else {
            paths.to_vec()
        };
        let mut target_roots = Vec::new();
        for path in input_roots {
            Self::collect_input_path(&path, &mut target_roots)?;
        }
        target_roots.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| left.label.cmp(&right.label))
        });
        target_roots.dedup_by(|left, right| left.path == right.path && left.label == right.label);
        Ok(Self {
            roots: target_roots,
        })
    }

    pub fn roots(&self) -> &[SourceRoot] {
        &self.roots
    }

    #[doc = "ousia: ownerless-method input path routing is a static path helper"]
    fn collect_input_path(path: &Path, roots: &mut Vec<SourceRoot>) -> Result<(), std::io::Error> {
        let metadata = std::fs::metadata(path)?;
        if metadata.is_file() && Self::is_cargo_manifest(path) {
            Self::collect_cargo_manifest(path, roots)?;
            return Ok(());
        }
        if metadata.is_dir() {
            let manifest = path.join("Cargo.toml");
            if manifest.is_file() {
                Self::collect_cargo_manifest(&manifest, roots)?;
                return Ok(());
            }
        }
        Self::collect_path(path, roots)
    }

    #[doc = "ousia: ownerless-method Cargo manifest expansion is a static helper"]
    fn collect_cargo_manifest(
        path: &Path,
        roots: &mut Vec<SourceRoot>,
    ) -> Result<(), std::io::Error> {
        let metadata = cargo_metadata::MetadataCommand::new()
            .manifest_path(path)
            .no_deps()
            .exec()
            .map_err(std::io::Error::other)?;
        for package in metadata.workspace_packages() {
            let lib_crate_name = package
                .targets
                .iter()
                .find(|target| target.kind.iter().any(|kind| kind.to_string() == "lib"))
                .map(|target| target.name.clone());
            let package_name = package.name.to_string();
            for target in &package.targets {
                let source_path = PathBuf::from(target.src_path.as_std_path());
                if source_path
                    .extension()
                    .is_some_and(|extension| extension == "rs")
                {
                    roots.push(SourceRoot::cargo_target(
                        source_path.clone(),
                        package_name.clone(),
                        lib_crate_name.clone().map(|name| name.to_string()),
                        format!(
                            "{}:{}:{}",
                            package_name,
                            target
                                .kind
                                .iter()
                                .map(ToString::to_string)
                                .collect::<Vec<_>>()
                                .join("+"),
                            target.name,
                        ),
                    ));
                }
            }
        }
        Ok(())
    }

    #[doc = "ousia: ownerless-method recursive path collection is a static helper"]
    fn collect_path(path: &Path, files: &mut Vec<SourceRoot>) -> Result<(), std::io::Error> {
        let metadata = std::fs::metadata(path)?;
        if metadata.is_file() {
            if path.extension().is_some_and(|extension| extension == "rs") {
                files.push(SourceRoot::from_path(path));
            }
            return Ok(());
        }
        if !metadata.is_dir() {
            return Ok(());
        }
        for entry in std::fs::read_dir(path)? {
            let child = entry?.path();
            if Self::skip_path(&child) {
                continue;
            }
            Self::collect_path(&child, files)?;
        }
        Ok(())
    }

    #[doc = "ousia: ownerless-method skip path filtering is a static helper"]
    fn skip_path(path: &Path) -> bool {
        path.file_name().is_some_and(|name| {
            matches!(
                name.to_string_lossy().as_ref(),
                ".git" | "target" | "node_modules" | ".vscode"
            )
        })
    }

    #[doc = "ousia: ownerless-method manifest detection is a static helper"]
    fn is_cargo_manifest(path: &Path) -> bool {
        path.file_name().is_some_and(|name| name == "Cargo.toml")
    }
}

impl SourceRoot {
    fn new(
        path: PathBuf,
        label: String,
        package_name: Option<String>,
        lib_crate_name: Option<String>,
    ) -> Self {
        Self {
            label,
            package_name,
            lib_crate_name,
            path,
        }
    }

    fn cargo_target(
        path: PathBuf,
        package_name: String,
        lib_crate_name: Option<String>,
        label: String,
    ) -> Self {
        Self::new(path, label, Some(package_name), lib_crate_name)
    }

    fn from_path(path: &Path) -> Self {
        let label = format!("source:{}", path.display());
        Self::new(path.to_path_buf(), label, None, None)
    }

    pub(crate) fn label(&self) -> &str {
        &self.label
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_paths_default_to_current_directory() {
        let sources = SourceSet::discover(&[]).expect("collect current directory files");

        assert!(
            sources
                .roots()
                .iter()
                .any(|root| root.path().ends_with("src/lib.rs"))
        );
    }

    #[test]
    fn non_cargo_inputs_collect_rust_file_roots() {
        let root =
            std::env::temp_dir().join(format!("ousia-rust-checker-files-{}", std::process::id(),));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("nested")).expect("create fixture directories");
        std::fs::write(root.join("b.rs"), "").expect("write b fixture");
        std::fs::write(root.join("nested/a.rs"), "").expect("write a fixture");
        std::fs::write(root.join("ignored.txt"), "").expect("write ignored fixture");

        let sources =
            SourceSet::discover(&[root.clone(), root.join("b.rs")]).expect("collect fixture files");

        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::path)
                .collect::<Vec<_>>(),
            [
                root.join("b.rs").as_path(),
                root.join("nested/a.rs").as_path()
            ]
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn collect_rust_files_skips_tooling_directories() {
        let root =
            std::env::temp_dir().join(format!("ousia-rust-checker-skip-{}", std::process::id(),));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("target")).expect("create target fixture");
        std::fs::create_dir_all(root.join("src")).expect("create src fixture");
        std::fs::write(root.join("target/generated.rs"), "").expect("write skipped fixture");
        std::fs::write(root.join("src/lib.rs"), "").expect("write src fixture");

        let sources = SourceSet::discover(&[root.clone()]).expect("collect fixture files");

        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::path)
                .collect::<Vec<_>>(),
            [root.join("src/lib.rs").as_path()]
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn cargo_manifest_input_collects_package_targets() {
        let root =
            std::env::temp_dir().join(format!("ousia-rust-checker-cargo-{}", std::process::id(),));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/bin")).expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(root.join("src/lib.rs"), "").expect("write lib source fixture");
        std::fs::write(root.join("src/main.rs"), "").expect("write main source fixture");
        std::fs::write(root.join("src/bin/tool.rs"), "").expect("write bin source fixture");

        let sources =
            SourceSet::discover(&[root.join("Cargo.toml")]).expect("collect fixture files");

        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::path)
                .collect::<Vec<_>>(),
            [
                root.join("src/bin/tool.rs").as_path(),
                root.join("src/lib.rs").as_path(),
                root.join("src/main.rs").as_path(),
            ],
        );
        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::label)
                .collect::<Vec<_>>(),
            [
                "fixture:bin:tool",
                "fixture:lib:fixture",
                "fixture:bin:fixture"
            ],
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn cargo_directory_input_prefers_manifest_over_raw_files() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-cargo-dir-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/nested")).expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(root.join("src/lib.rs"), "").expect("write lib source fixture");
        std::fs::write(root.join("src/main.rs"), "").expect("write main source fixture");
        std::fs::write(root.join("src/nested/extra.rs"), "").expect("write extra fixture");

        let sources = SourceSet::discover(std::slice::from_ref(&root)).expect("discover sources");

        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::label)
                .collect::<Vec<_>>(),
            ["fixture:lib:fixture", "fixture:bin:fixture"],
        );
        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::path)
                .collect::<Vec<_>>(),
            [
                root.join("src/lib.rs").as_path(),
                root.join("src/main.rs").as_path()
            ],
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn cargo_manifest_input_uses_targets_not_module_files_as_roots() {
        let root = std::env::temp_dir()
            .join(format!("ousia-rust-checker-modules-{}", std::process::id(),));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/nested")).expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(root.join("src/lib.rs"), "mod child;\nmod nested;\n")
            .expect("write lib source fixture");
        std::fs::write(root.join("src/child.rs"), "").expect("write child module fixture");
        std::fs::write(root.join("src/nested/mod.rs"), "").expect("write nested module fixture");

        let sources =
            SourceSet::discover(&[root.join("Cargo.toml")]).expect("collect fixture files");

        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::path)
                .collect::<Vec<_>>(),
            [root.join("src/lib.rs").as_path()],
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn cargo_manifest_input_follows_nested_file_modules() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-nested-file-{}",
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

        let sources =
            SourceSet::discover(&[root.join("Cargo.toml")]).expect("collect fixture files");

        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::path)
                .collect::<Vec<_>>(),
            [root.join("src/lib.rs").as_path()],
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn cargo_manifest_input_skips_out_of_line_test_modules() {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-test-module-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).expect("create source fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write cargo fixture");
        std::fs::write(root.join("src/lib.rs"), "#[cfg(test)]\nmod tests;\n")
            .expect("write lib source fixture");
        std::fs::write(root.join("src/tests.rs"), "fn helper() {}\n")
            .expect("write tests source fixture");

        let sources =
            SourceSet::discover(&[root.join("Cargo.toml")]).expect("collect fixture files");

        assert_eq!(
            sources
                .roots()
                .iter()
                .map(SourceRoot::path)
                .collect::<Vec<_>>(),
            [root.join("src/lib.rs").as_path()]
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }
}
