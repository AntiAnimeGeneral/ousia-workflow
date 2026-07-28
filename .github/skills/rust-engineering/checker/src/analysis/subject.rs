use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

use crate::analysis::error::{FatalError, FatalPhase};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum TargetKind {
    Lib,
    Bin,
    Test,
    Example,
    Bench,
    ProcMacro,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct TargetSubject {
    pub(crate) root_id: String,
    pub(crate) root_locator: String,
    pub(crate) root_path: PathBuf,
    pub(crate) source_path: PathBuf,
    pub(crate) target_kind: TargetKind,
    pub(crate) target_name: String,
    pub(crate) test_enabled: bool,
    pub(crate) package_name: String,
    pub(crate) lib_crate_name: Option<String>,
}

#[derive(Debug)]
pub(crate) enum ProjectSubject {
    Paths(Vec<PathBuf>),
    NotApplicable,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum SemanticInput {
    CargoManifest(PathBuf),
}

struct CollectedCargoTarget {
    subject: TargetSubject,
    manifest: PathBuf,
}

#[derive(Deserialize)]
struct ProjectFacts {
    project: ProjectConfiguration,
}

#[derive(Deserialize)]
struct ProjectConfiguration {
    #[serde(default)]
    rust: Option<RustConfiguration>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustConfiguration {
    #[serde(default)]
    source_paths: Vec<PathBuf>,
}

#[doc = "ousia: ownerless-fn Cargo input resolution"]
pub(crate) fn resolve_cargo_inputs(
    cargo_inputs: &[PathBuf],
) -> Result<Vec<TargetSubject>, FatalError> {
    let inputs = if cargo_inputs.is_empty() {
        vec![PathBuf::from(".")]
    } else {
        cargo_inputs.to_vec()
    };
    let mut semantic_inputs = BTreeSet::new();
    for path in &inputs {
        let metadata = std::fs::metadata(path).map_err(|error| {
            FatalError::new(
                FatalPhase::Subject,
                "subject-path-invalid",
                error.to_string(),
            )
            .at_path(path)
        })?;
        if metadata.is_file() && is_cargo_manifest(path) {
            semantic_inputs.insert(SemanticInput::CargoManifest(
                path.canonicalize().map_err(FatalError::subject)?,
            ));
        } else if metadata.is_dir() && path.join("Cargo.toml").is_file() {
            semantic_inputs.insert(SemanticInput::CargoManifest(
                path.join("Cargo.toml")
                    .canonicalize()
                    .map_err(FatalError::subject)?,
            ));
        } else {
            return Err(FatalError::new(
                FatalPhase::Subject,
                "subject-cargo-manifest-required",
                "checker input must be Cargo.toml or a directory directly containing Cargo.toml",
            )
            .at_path(path));
        }
    }

    let mut cargo_targets = Vec::new();
    for SemanticInput::CargoManifest(manifest) in &semantic_inputs {
        collect_cargo_manifest(manifest, &mut cargo_targets)?;
    }
    let mut targets = Vec::new();
    let mut cargo_identity_owners = BTreeMap::<String, PathBuf>::new();
    for collected in cargo_targets {
        if let Some(owner) = cargo_identity_owners.get(&collected.subject.root_id)
            && owner != &collected.manifest
        {
            return Err(FatalError::new(
                FatalPhase::Subject,
                "subject-root-ambiguous",
                format!(
                    "Cargo manifests {} and {} produce the same root identity `{}`",
                    owner.display(),
                    collected.manifest.display(),
                    collected.subject.root_id
                ),
            ));
        }
        cargo_identity_owners.insert(collected.subject.root_id.clone(), collected.manifest);
        targets.push(collected.subject);
    }
    targets.sort_by(|left: &TargetSubject, right| {
        left.root_id
            .cmp(&right.root_id)
            .then_with(|| left.source_path.cmp(&right.source_path))
    });
    targets.dedup();
    Ok(targets)
}

#[doc = "ousia: ownerless-fn project Cargo subject resolution"]
pub(crate) fn resolve_project(project_root: &Path) -> Result<ProjectSubject, FatalError> {
    let project_root = project_root.canonicalize().map_err(FatalError::subject)?;
    let manifest = project_root.join("Cargo.toml");
    if manifest.is_file() {
        return Ok(ProjectSubject::Paths(vec![manifest]));
    }
    let facts_path = project_root.join(".ousia/project.json");
    let bytes = std::fs::read(&facts_path).map_err(|error| {
        FatalError::new(
            FatalPhase::Subject,
            "project-facts-read-failed",
            error.to_string(),
        )
        .at_path(&facts_path)
    })?;
    let facts: ProjectFacts = serde_json::from_slice(&bytes).map_err(|error| {
        FatalError::new(
            FatalPhase::Subject,
            "project-facts-invalid",
            error.to_string(),
        )
        .at_path(&facts_path)
    })?;
    let Some(configuration) = facts.project.rust else {
        return Ok(ProjectSubject::NotApplicable);
    };
    let mut paths = Vec::new();
    for relative in configuration.source_paths {
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(FatalError::new(
                FatalPhase::Subject,
                "project-source-path-invalid",
                format!(
                    "Rust source path must remain project-relative: {}",
                    relative.display()
                ),
            ));
        }
        let path = project_root
            .join(&relative)
            .canonicalize()
            .map_err(|error| {
                FatalError::new(
                    FatalPhase::Subject,
                    "project-source-path-invalid",
                    error.to_string(),
                )
                .at_path(project_root.join(&relative))
            })?;
        if !path.starts_with(&project_root)
            || !(is_cargo_manifest(&path) || path.is_dir() && path.join("Cargo.toml").is_file())
        {
            return Err(FatalError::new(
                FatalPhase::Subject,
                "project-source-path-invalid",
                format!(
                    "project.rust.sourcePaths entry must name Cargo.toml or a project-relative directory directly containing Cargo.toml: {}",
                    relative.display()
                ),
            ));
        }
        paths.push(path);
    }
    paths.sort();
    paths.dedup();
    if paths.is_empty() {
        Ok(ProjectSubject::NotApplicable)
    } else {
        Ok(ProjectSubject::Paths(paths))
    }
}

impl TargetKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Lib => "lib",
            Self::Bin => "bin",
            Self::Test => "test",
            Self::Example => "example",
            Self::Bench => "bench",
            Self::ProcMacro => "proc-macro",
        }
    }

    pub(crate) fn production_enabled(self) -> bool {
        !matches!(self, Self::Test)
    }
}

impl TargetSubject {
    pub(crate) fn label(&self) -> String {
        format!(
            "{}:{}:{}",
            self.package_name,
            self.target_kind.as_str(),
            self.target_name
        )
    }
}

#[doc = "ousia: ownerless-fn Cargo target subject collection"]
fn collect_cargo_manifest(
    path: &Path,
    targets: &mut Vec<CollectedCargoTarget>,
) -> Result<(), FatalError> {
    let metadata = cargo_metadata::MetadataCommand::new()
        .manifest_path(path)
        .no_deps()
        .exec()
        .map_err(|error| {
            FatalError::new(
                FatalPhase::CargoMetadata,
                "cargo-metadata-failed",
                error.to_string(),
            )
            .at_path(path)
        })?;
    let workspace_root = metadata
        .workspace_root
        .as_std_path()
        .canonicalize()
        .map_err(FatalError::subject)?;
    for package in metadata.workspace_packages() {
        let package_manifest = package
            .manifest_path
            .as_std_path()
            .canonicalize()
            .map_err(FatalError::subject)?;
        let manifest_locator = package_manifest
            .strip_prefix(&workspace_root)
            .map(wire_path)
            .map_err(|_| {
                FatalError::new(
                    FatalPhase::Subject,
                    "subject-root-ambiguous",
                    format!(
                        "Cargo package manifest {} is outside workspace root {}",
                        package_manifest.display(),
                        workspace_root.display()
                    ),
                )
            })?;
        let package_root = package_manifest
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        let lib_crate_name = package
            .targets
            .iter()
            .find(|target| {
                target.kind.iter().any(|kind| {
                    matches!(
                        kind,
                        cargo_metadata::TargetKind::Lib
                            | cargo_metadata::TargetKind::RLib
                            | cargo_metadata::TargetKind::DyLib
                            | cargo_metadata::TargetKind::CDyLib
                            | cargo_metadata::TargetKind::StaticLib
                    )
                })
            })
            .map(|target| target.name.clone());
        let package_name = package.name.to_string();
        for target in &package.targets {
            let Some(target_kind) = normalize_target_kind(target)? else {
                continue;
            };
            let source_path = PathBuf::from(target.src_path.as_std_path());
            if source_path
                .extension()
                .is_none_or(|extension| extension != "rs")
            {
                continue;
            }
            let root_id = encoded_identity(
                "cargo",
                [
                    manifest_locator.as_str(),
                    package_name.as_str(),
                    target_kind.as_str(),
                    target.name.as_str(),
                ],
            );
            targets.push(CollectedCargoTarget {
                subject: TargetSubject {
                    root_id,
                    root_locator: manifest_locator.clone(),
                    root_path: package_root.clone(),
                    source_path,
                    target_kind,
                    target_name: target.name.clone(),
                    test_enabled: target.test,
                    package_name: package_name.clone(),
                    lib_crate_name: lib_crate_name.clone(),
                },
                manifest: package_manifest.clone(),
            });
        }
    }
    Ok(())
}

#[doc = "ousia: ownerless-fn Cargo target kind normalization"]
fn normalize_target_kind(
    target: &cargo_metadata::Target,
) -> Result<Option<TargetKind>, FatalError> {
    let mut normalized = None;
    for kind in &target.kind {
        let candidate = match kind {
            cargo_metadata::TargetKind::Lib
            | cargo_metadata::TargetKind::RLib
            | cargo_metadata::TargetKind::DyLib
            | cargo_metadata::TargetKind::CDyLib
            | cargo_metadata::TargetKind::StaticLib => TargetKind::Lib,
            cargo_metadata::TargetKind::Bin => TargetKind::Bin,
            cargo_metadata::TargetKind::Test => TargetKind::Test,
            cargo_metadata::TargetKind::Example => TargetKind::Example,
            cargo_metadata::TargetKind::Bench => TargetKind::Bench,
            cargo_metadata::TargetKind::ProcMacro => TargetKind::ProcMacro,
            cargo_metadata::TargetKind::CustomBuild => return Ok(None),
            cargo_metadata::TargetKind::Unknown(value) => {
                return Err(FatalError::new(
                    FatalPhase::CargoMetadata,
                    "cargo-target-kind-unknown",
                    format!("unknown Cargo target kind `{value}`"),
                ));
            }
            _ => {
                return Err(FatalError::new(
                    FatalPhase::CargoMetadata,
                    "cargo-target-kind-unsupported",
                    format!("unsupported Cargo target kind `{kind}`"),
                ));
            }
        };
        if normalized.is_some_and(|current| current != candidate) {
            return Err(FatalError::new(
                FatalPhase::CargoMetadata,
                "cargo-target-kind-incompatible",
                format!(
                    "Cargo target `{}` has incompatible target kinds",
                    target.name
                ),
            ));
        }
        normalized = Some(candidate);
    }
    normalized.map(Some).ok_or_else(|| {
        FatalError::new(
            FatalPhase::CargoMetadata,
            "cargo-target-kind-missing",
            format!("Cargo target `{}` has no target kind", target.name),
        )
    })
}

#[doc = "ousia: ownerless-fn Cargo manifest path classification"]
fn is_cargo_manifest(path: &Path) -> bool {
    path.file_name().is_some_and(|name| name == "Cargo.toml")
}

#[doc = "ousia: ownerless-fn stable wire path projection"]
pub(crate) fn wire_path(path: &Path) -> String {
    let projected = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            Component::CurDir => None,
            Component::ParentDir => Some("..".to_owned()),
            Component::RootDir => None,
            Component::Prefix(value) => Some(value.as_os_str().to_string_lossy().into_owned()),
        })
        .collect::<Vec<_>>()
        .join("/");
    if projected.is_empty() {
        ".".to_owned()
    } else {
        projected
    }
}

#[doc = "ousia: ownerless-fn unambiguous wire identity encoding"]
fn encoded_identity<'a>(kind: &str, parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut identity = kind.to_owned();
    for part in parts {
        identity.push(':');
        identity.push_str(&part.len().to_string());
        identity.push(':');
        identity.push_str(part);
    }
    identity
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    /// Goal: resolve a containing directory through its Cargo metadata target.
    /// Scope: level=contract; boundary=analysis::subject::resolve_cargo_inputs
    /// Semantics: a Cargo directory returns its declared lib target and package identity.
    #[test]
    fn cargo_directory_prefers_manifest_targets() {
        let root = fixture_root("manifest-priority");
        std::fs::create_dir_all(root.join("src")).expect("create fixture source directory");
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"subject-fixture\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
        )
        .expect("write manifest");
        std::fs::write(root.join("src/lib.rs"), "mod nested;\n").expect("write lib root");
        std::fs::write(root.join("src/nested.rs"), "pub fn value() {}\n")
            .expect("write nested module");

        let targets =
            resolve_cargo_inputs(std::slice::from_ref(&root)).expect("resolve Cargo subject");
        std::fs::remove_dir_all(&root).expect("remove fixture");

        assert_eq!(targets.len(), 1);
        let target = &targets[0];
        assert_eq!(target.target_kind, TargetKind::Lib);
        assert_eq!(target.target_name, "subject_fixture");
        assert!(target.source_path.ends_with("src/lib.rs"));
    }

    /// Goal: reject every existing input that is not a Cargo manifest selector.
    /// Scope: level=contract; boundary=analysis::subject::resolve_cargo_inputs
    /// Semantics: source files, ordinary files, and manifestless directories fail with subject-cargo-manifest-required.
    #[rstest::rstest]
    #[case::source_file("lib.rs", Some("fn value() {}\n"))]
    #[case::ordinary_file("notes.txt", Some("notes\n"))]
    #[case::manifestless_directory("sources", None)]
    fn non_cargo_inputs_are_fatal(#[case] name: &str, #[case] contents: Option<&str>) {
        let root = fixture_root("cargo-required");
        std::fs::create_dir_all(&root).expect("create fixture root");
        let input = root.join(name);
        if let Some(contents) = contents {
            std::fs::write(&input, contents).expect("write fixture input");
        } else {
            std::fs::create_dir_all(&input).expect("create fixture directory");
        }

        let error = resolve_cargo_inputs(&[input]).expect_err("non-Cargo input must fail");
        std::fs::remove_dir_all(&root).expect("remove fixture");
        assert_eq!(error.code(), "subject-cargo-manifest-required");
    }

    /// Goal: deduplicate a Cargo directory and its canonical manifest before target projection.
    /// Scope: level=contract; boundary=analysis::subject::resolve_cargo_inputs
    /// Semantics: passing both spellings yields the same single lib target as passing the directory alone.
    #[test]
    fn cargo_directory_and_manifest_share_one_semantic_input() {
        let root = fixture_root("cargo-dedup");
        write_cargo_fixture(&root, "cargo_dedup");

        let directory =
            resolve_cargo_inputs(std::slice::from_ref(&root)).expect("resolve Cargo directory");
        let duplicate = resolve_cargo_inputs(&[root.clone(), root.join("Cargo.toml")])
            .expect("resolve duplicate Cargo input");
        std::fs::remove_dir_all(&root).expect("remove fixture");

        assert_eq!(duplicate, directory);
        assert_eq!(duplicate.len(), 1);
    }

    /// Goal: reject distinct Cargo manifests whose stable target projections collide.
    /// Scope: level=contract; boundary=analysis::subject::resolve_cargo_inputs
    /// Semantics: two canonical crates with the same package and target identity fail before root allocation with subject-root-ambiguous.
    #[test]
    fn cargo_projection_collision_is_subject_fatal() {
        let root = fixture_root("cargo-collision");
        let left = root.join("left");
        let right = root.join("right");
        write_cargo_fixture(&left, "same_package");
        write_cargo_fixture(&right, "same_package");

        let error = resolve_cargo_inputs(&[left, right])
            .expect_err("colliding Cargo projections must fail");
        std::fs::remove_dir_all(&root).expect("remove fixture");

        assert_eq!(error.code(), "subject-root-ambiguous");
    }

    /// Goal: preserve root Cargo manifest priority over optional project source selectors.
    /// Scope: level=contract; boundary=analysis::subject::resolve_project
    /// Semantics: an existing root manifest is selected without reading an invalid project facts file.
    #[test]
    fn project_root_manifest_has_priority() {
        let root = fixture_root("project-manifest-priority");
        write_cargo_fixture(&root, "root_package");
        std::fs::create_dir_all(root.join(".ousia")).expect("create project facts directory");
        std::fs::write(root.join(".ousia/project.json"), "not json")
            .expect("write invalid project facts");

        let ProjectSubject::Paths(paths) = resolve_project(&root).expect("resolve project") else {
            panic!("root Cargo manifest must be applicable")
        };
        std::fs::remove_dir_all(&root).expect("remove fixture");
        assert_eq!(paths.len(), 1);
        assert!(paths[0].ends_with("Cargo.toml"));
    }

    /// Goal: keep projects without configured Cargo selectors not applicable.
    /// Scope: level=contract; boundary=analysis::subject::resolve_project
    /// Semantics: absent Rust configuration and an empty sourcePaths array both return NotApplicable.
    #[rstest::rstest]
    #[case::rust_configuration_absent(r#"{"project":{}}"#)]
    #[case::source_paths_empty(r#"{"project":{"rust":{"sourcePaths":[]}}}"#)]
    fn project_without_cargo_selectors_is_not_applicable(#[case] facts: &str) {
        let root = fixture_root("project-not-applicable");
        write_project_facts(&root, facts);

        let subject = resolve_project(&root).expect("resolve project");
        std::fs::remove_dir_all(&root).expect("remove fixture");
        assert!(matches!(subject, ProjectSubject::NotApplicable));
    }

    /// Goal: canonicalize distinct project-relative Cargo selector spellings.
    /// Scope: level=contract; boundary=analysis::subject::resolve_project
    /// Semantics: directory and manifest selectors become two canonical paths while semantic Cargo dedup remains owned by resolve_cargo_inputs.
    #[test]
    fn project_cargo_selectors_are_canonicalized_and_deduplicated() {
        let root = fixture_root("project-cargo-selectors");
        write_cargo_fixture(&root.join("nested"), "nested_package");
        write_project_facts(
            &root,
            r#"{"project":{"rust":{"sourcePaths":["nested","nested/Cargo.toml"]}}}"#,
        );

        let ProjectSubject::Paths(paths) = resolve_project(&root).expect("resolve project") else {
            panic!("configured Cargo selectors must be applicable")
        };
        std::fs::remove_dir_all(&root).expect("remove fixture");
        assert_eq!(paths.len(), 2);
        assert!(paths[0].ends_with("nested"));
        assert!(paths[1].ends_with("nested/Cargo.toml"));
    }

    /// Goal: reject project selectors that escape or bypass the Cargo input contract.
    /// Scope: level=contract; boundary=analysis::subject::resolve_project
    /// Semantics: raw files, manifestless directories, absolute paths, and parent traversal fail with project-source-path-invalid.
    #[rstest::rstest]
    #[case::source_file("src/lib.rs", true)]
    #[case::ordinary_file("notes.txt", true)]
    #[case::manifestless_directory("sources", false)]
    #[case::parent_traversal("../outside", false)]
    fn invalid_project_source_path_is_fatal(#[case] selector: &str, #[case] file: bool) {
        let root = fixture_root("project-invalid-selector");
        std::fs::create_dir_all(&root).expect("create fixture root");
        if !selector.starts_with("..") {
            let input = root.join(selector);
            if file {
                std::fs::create_dir_all(input.parent().expect("input parent"))
                    .expect("create input parent");
                std::fs::write(input, "fixture\n").expect("write fixture input");
            } else {
                std::fs::create_dir_all(input).expect("create fixture directory");
            }
        }
        write_project_facts(
            &root,
            &format!(r#"{{"project":{{"rust":{{"sourcePaths":["{selector}"]}}}}}}"#),
        );

        let error = resolve_project(&root).expect_err("invalid selector must fail");
        std::fs::remove_dir_all(&root).expect("remove fixture");
        assert_eq!(error.code(), "project-source-path-invalid");
    }

    /// Goal: reject absolute project selectors before filesystem resolution.
    /// Scope: level=contract; boundary=analysis::subject::resolve_project
    /// Semantics: an absolute sourcePaths entry fails with project-source-path-invalid.
    #[test]
    fn absolute_project_source_path_is_fatal() {
        let root = fixture_root("project-absolute-selector");
        let absolute = root.join("outside");
        write_project_facts(
            &root,
            &format!(
                r#"{{"project":{{"rust":{{"sourcePaths":[{}]}}}}}}"#,
                serde_json::to_string(&absolute).expect("serialize absolute path")
            ),
        );

        let error = resolve_project(&root).expect_err("absolute selector must fail");
        std::fs::remove_dir_all(&root).expect("remove fixture");
        assert_eq!(error.code(), "project-source-path-invalid");
    }

    fn write_cargo_fixture(root: &Path, package: &str) {
        std::fs::create_dir_all(root.join("src")).expect("create Cargo source directory");
        std::fs::write(
            root.join("Cargo.toml"),
            format!("[package]\nname = \"{package}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"),
        )
        .expect("write Cargo manifest");
        std::fs::write(root.join("src/lib.rs"), "fn value() {}\n").expect("write Cargo source");
    }

    fn write_project_facts(root: &Path, facts: &str) {
        std::fs::create_dir_all(root.join(".ousia")).expect("create project facts directory");
        std::fs::write(root.join(".ousia/project.json"), facts).expect("write project facts");
    }

    fn fixture_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ousia-subject-{label}-{nonce}"))
    }
}
