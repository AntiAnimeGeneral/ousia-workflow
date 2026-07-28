use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use super::cfg::{AttributeProjection, CfgExpr, CfgModel, Universe};
use super::error::{FatalError, FatalPhase};
use super::source_repository::{PhysicalSourceRepository, SourceId};
use super::subject::{TargetSubject, wire_path};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct OccurrenceId(usize);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BodyLocator {
    FullFile(SourceId),
    Inline {
        source_id: SourceId,
        item_path: Vec<usize>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum InclusionKind {
    CrateRoot,
    Inline,
    DefaultFile,
    PathAttribute,
}

#[derive(Clone, Debug)]
pub(crate) struct ModuleOccurrence {
    id: OccurrenceId,
    wire_id: String,
    parent: Option<OccurrenceId>,
    target: TargetSubject,
    source_id: SourceId,
    body: BodyLocator,
    module_path: Vec<String>,
    guard: CfgExpr,
    inclusion: InclusionKind,
}

#[derive(Debug)]
pub(crate) struct LogicalInclusionGraph {
    occurrences: Vec<ModuleOccurrence>,
}

struct GraphBuilder<'a> {
    repository: &'a mut PhysicalSourceRepository,
    cfg: &'a mut CfgModel,
    occurrences: Vec<ModuleOccurrence>,
}

struct ModuleContext {
    parent: Option<OccurrenceId>,
    target: TargetSubject,
    source_id: SourceId,
    source_path: PathBuf,
    body: BodyLocator,
    module_path: Vec<String>,
    declaration_lineage: Vec<(String, usize)>,
    wire_id: String,
    guard: CfgExpr,
    inclusion: InclusionKind,
    item_path: Vec<usize>,
    resolution_dir: PathBuf,
}

impl LogicalInclusionGraph {
    pub(crate) fn build(
        targets: &[TargetSubject],
        repository: &mut PhysicalSourceRepository,
        cfg: &mut CfgModel,
    ) -> Result<Self, FatalError> {
        let mut builder = GraphBuilder {
            repository,
            cfg,
            occurrences: Vec::new(),
        };
        for target in targets {
            let source_id = builder.repository.load(&target.source_path)?;
            let target_identity = structural_target_identity(target);
            let wire_id = structural_occurrence_identity(
                &target_identity,
                &[],
                "crate-root",
                ".",
                &CfgExpr::True,
            );
            builder.visit(
                ModuleContext {
                    parent: None,
                    target: target.clone(),
                    source_id,
                    source_path: target.source_path.clone(),
                    body: BodyLocator::FullFile(source_id),
                    module_path: Vec::new(),
                    declaration_lineage: Vec::new(),
                    wire_id,
                    guard: CfgExpr::True,
                    inclusion: InclusionKind::CrateRoot,
                    item_path: Vec::new(),
                    resolution_dir: target
                        .source_path
                        .parent()
                        .unwrap_or_else(|| Path::new("."))
                        .to_path_buf(),
                },
                &mut Vec::new(),
            )?;
        }
        Ok(Self {
            occurrences: builder.occurrences,
        })
    }

    pub(crate) fn occurrences(&self) -> &[ModuleOccurrence] {
        &self.occurrences
    }
}

impl GraphBuilder<'_> {
    fn visit(
        &mut self,
        context: ModuleContext,
        ancestry: &mut Vec<(SourceId, CfgExpr)>,
    ) -> Result<(), FatalError> {
        if let BodyLocator::FullFile(source_id) = context.body {
            if let Some((_, ancestor_guard)) = ancestry.iter().find(|(id, _)| *id == source_id) {
                let cycle_guard = CfgExpr::all([ancestor_guard.clone(), context.guard.clone()]);
                if self.possible_for_target(&cycle_guard, &context.target)? {
                    return Err(FatalError::new(
                        FatalPhase::Graph,
                        "module-cycle",
                        "module inclusion cycle is reachable",
                    )
                    .at_path(&context.source_path));
                }
                return Ok(());
            }
            ancestry.push((source_id, context.guard.clone()));
        }

        let occurrence_id = OccurrenceId(self.occurrences.len());
        self.occurrences.push(ModuleOccurrence {
            id: occurrence_id,
            wire_id: context.wire_id.clone(),
            parent: context.parent,
            target: context.target.clone(),
            source_id: context.source_id,
            body: context.body.clone(),
            module_path: context.module_path.clone(),
            guard: context.guard.clone(),
            inclusion: context.inclusion,
        });

        let items = body_items(self.repository, &context.body).to_vec();
        let mut declaration_ordinals = BTreeMap::<String, usize>::new();
        for (ordinal, item) in items.iter().enumerate() {
            let syn::Item::Mod(module) = item else {
                continue;
            };
            let module_name = module.ident.to_string();
            let declaration_ordinal = declaration_ordinals.entry(module_name.clone()).or_default();
            let mut declaration_lineage = context.declaration_lineage.clone();
            declaration_lineage.push((module_name.clone(), *declaration_ordinal));
            *declaration_ordinal += 1;
            let projection = self.cfg.attributes(&module.attrs, &context.source_path)?;
            let guard = CfgExpr::all([context.guard.clone(), projection.item_guard.clone()]);
            if !self.possible_for_target(&guard, &context.target)? {
                continue;
            }
            let mut module_path = context.module_path.clone();
            module_path.push(module_name.clone());
            let mut item_path = context.item_path.clone();
            item_path.push(ordinal);
            if let Some((_, nested)) = &module.content {
                let wire_id = structural_occurrence_identity(
                    &structural_target_identity(&context.target),
                    &declaration_lineage,
                    "inline",
                    &module_name,
                    &guard,
                );
                self.visit(
                    ModuleContext {
                        parent: Some(occurrence_id),
                        target: context.target.clone(),
                        source_id: context.source_id,
                        source_path: context.source_path.clone(),
                        body: BodyLocator::Inline {
                            source_id: context.source_id,
                            item_path: item_path.clone(),
                        },
                        module_path,
                        declaration_lineage,
                        wire_id,
                        guard,
                        inclusion: InclusionKind::Inline,
                        item_path,
                        resolution_dir: context.resolution_dir.join(module.ident.to_string()),
                    },
                    ancestry,
                )?;
                let _ = nested;
                continue;
            }
            let alternatives = module_alternatives(
                &context.source_path,
                &context.resolution_dir,
                &module.ident.to_string(),
                &projection,
            );
            let mut resolved = Vec::new();
            let mut alternative_keys = BTreeSet::new();
            for alternative in alternatives {
                let effective_guard = CfgExpr::all([guard.clone(), alternative.guard.clone()]);
                if !self.possible_for_target(&effective_guard, &context.target)? {
                    continue;
                }
                let alternative_key = (
                    alternative.inclusion.identity_kind(),
                    alternative.identity_path.clone(),
                    effective_guard.canonical(),
                );
                if !alternative_keys.insert(alternative_key) {
                    return Err(FatalError::new(
                        FatalPhase::Graph,
                        "module-ambiguity",
                        format!(
                            "module `{}` declares the same guarded source alternative more than once",
                            module.ident
                        ),
                    )
                    .at_path(&context.source_path)
                    .at_location(module.ident.span().start()));
                }
                if alternative.path.is_file() {
                    resolved.push(ResolvedModule {
                        path: alternative.path,
                        guard: effective_guard,
                        inclusion: alternative.inclusion,
                        identity_path: alternative.identity_path,
                    });
                }
            }
            let existing_guard =
                CfgExpr::any(resolved.iter().map(|candidate| candidate.guard.clone()));
            let uncovered = CfgExpr::all([guard.clone(), CfgExpr::not(existing_guard)]);
            if self.possible_for_target(&uncovered, &context.target)? {
                return Err(FatalError::new(
                    FatalPhase::Graph,
                    "module-source-missing",
                    format!(
                        "module `{}` has a reachable configuration without a source file",
                        module.ident
                    ),
                )
                .at_path(&context.source_path)
                .at_location(module.ident.span().start()));
            }
            for left in 0..resolved.len() {
                for right in left + 1..resolved.len() {
                    let overlap =
                        CfgExpr::all([resolved[left].guard.clone(), resolved[right].guard.clone()]);
                    if self.possible_for_target(&overlap, &context.target)? {
                        return Err(FatalError::new(
                            FatalPhase::Graph,
                            "module-ambiguity",
                            format!(
                                "module `{}` resolves to both {} and {}",
                                module.ident,
                                resolved[left].path.display(),
                                resolved[right].path.display()
                            ),
                        )
                        .at_path(&context.source_path)
                        .at_location(module.ident.span().start()));
                    }
                }
            }
            for child in resolved {
                let source_id = self.repository.load(&child.path)?;
                let resolution_dir = child_resolution_dir(&child.path);
                let wire_id = structural_occurrence_identity(
                    &structural_target_identity(&context.target),
                    &declaration_lineage,
                    child.inclusion.identity_kind(),
                    &child.identity_path,
                    &child.guard,
                );
                self.visit(
                    ModuleContext {
                        parent: Some(occurrence_id),
                        target: context.target.clone(),
                        source_id,
                        source_path: child.path,
                        body: BodyLocator::FullFile(source_id),
                        module_path: module_path.clone(),
                        declaration_lineage: declaration_lineage.clone(),
                        wire_id,
                        guard: child.guard,
                        inclusion: child.inclusion,
                        item_path: Vec::new(),
                        resolution_dir,
                    },
                    ancestry,
                )?;
            }
        }
        if matches!(context.body, BodyLocator::FullFile(_)) {
            ancestry.pop();
        }
        Ok(())
    }

    fn possible_for_target(
        &mut self,
        expression: &CfgExpr,
        target: &TargetSubject,
    ) -> Result<bool, FatalError> {
        if target.target_kind.production_enabled()
            && self.cfg.possible(expression, Universe::Production)?
        {
            return Ok(true);
        }
        if target.test_enabled && self.cfg.possible(expression, Universe::Test)? {
            return Ok(true);
        }
        Ok(false)
    }
}

impl ModuleOccurrence {
    pub(crate) fn id(&self) -> OccurrenceId {
        self.id
    }

    pub(crate) fn wire_id(&self) -> &str {
        &self.wire_id
    }

    pub(crate) fn parent(&self) -> Option<OccurrenceId> {
        self.parent
    }

    pub(crate) fn target(&self) -> &TargetSubject {
        &self.target
    }

    pub(crate) fn source_id(&self) -> SourceId {
        self.source_id
    }

    pub(crate) fn body(&self) -> &BodyLocator {
        &self.body
    }

    pub(crate) fn module_path(&self) -> &[String] {
        &self.module_path
    }

    pub(crate) fn guard(&self) -> &CfgExpr {
        &self.guard
    }

    pub(crate) fn inclusion(&self) -> &InclusionKind {
        &self.inclusion
    }
}

#[doc = "ousia: ownerless-fn logical occurrence body projection"]
pub(crate) fn body_items<'a>(
    repository: &'a PhysicalSourceRepository,
    locator: &BodyLocator,
) -> &'a [syn::Item] {
    match locator {
        BodyLocator::FullFile(source_id) => &repository.get(*source_id).file().items,
        BodyLocator::Inline {
            source_id,
            item_path,
        } => {
            let mut items = repository.get(*source_id).file().items.as_slice();
            for ordinal in item_path {
                let syn::Item::Mod(module) = &items[*ordinal] else {
                    return &[];
                };
                let Some((_, nested)) = &module.content else {
                    return &[];
                };
                items = nested;
            }
            items
        }
    }
}

struct ModuleAlternative {
    path: PathBuf,
    guard: CfgExpr,
    inclusion: InclusionKind,
    identity_path: String,
}

struct ResolvedModule {
    path: PathBuf,
    guard: CfgExpr,
    inclusion: InclusionKind,
    identity_path: String,
}

#[doc = "ousia: ownerless-fn module source alternative resolution"]
fn module_alternatives(
    current_path: &Path,
    resolution_dir: &Path,
    module_name: &str,
    projection: &AttributeProjection,
) -> Vec<ModuleAlternative> {
    let parent = current_path.parent().unwrap_or_else(|| Path::new("."));
    let mut alternatives = projection
        .path_alternatives
        .iter()
        .map(|(guard, value)| ModuleAlternative {
            path: parent.join(value),
            guard: guard.clone(),
            inclusion: InclusionKind::PathAttribute,
            identity_path: wire_path(Path::new(value)),
        })
        .collect::<Vec<_>>();
    let default_guard = CfgExpr::not(CfgExpr::any(
        projection
            .path_alternatives
            .iter()
            .map(|(guard, _)| guard.clone()),
    ));
    alternatives.push(ModuleAlternative {
        path: resolution_dir.join(format!("{module_name}.rs")),
        guard: default_guard.clone(),
        inclusion: InclusionKind::DefaultFile,
        identity_path: format!("{module_name}.rs"),
    });
    alternatives.push(ModuleAlternative {
        path: resolution_dir.join(module_name).join("mod.rs"),
        guard: default_guard,
        inclusion: InclusionKind::DefaultFile,
        identity_path: format!("{module_name}/mod.rs"),
    });
    alternatives
}

#[doc = "ousia: ownerless-fn child module resolution directory"]
fn child_resolution_dir(path: &Path) -> PathBuf {
    if path.file_name().is_some_and(|name| name == "mod.rs") {
        path.parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    } else {
        path.with_extension("")
    }
}

impl InclusionKind {
    fn identity_kind(&self) -> &'static str {
        match self {
            Self::CrateRoot => "crate-root",
            Self::Inline => "inline",
            Self::DefaultFile => "default-file",
            Self::PathAttribute => "path-attribute",
        }
    }
}

#[doc = "ousia: ownerless-fn structural module occurrence identity"]
fn structural_occurrence_identity(
    target_identity: &str,
    lineage: &[(String, usize)],
    alternative_kind: &str,
    alternative_path: &str,
    guard: &CfgExpr,
) -> String {
    let lineage = lineage
        .iter()
        .map(|(name, ordinal)| format!("{}:{name}:{ordinal}", name.len()))
        .collect::<Vec<_>>()
        .join("/");
    let guard = guard.canonical();
    format!(
        "occ:{}:{target_identity}:{}:{lineage}:{}:{alternative_kind}:{}:{alternative_path}:{}:{guard}",
        target_identity.len(),
        lineage.len(),
        alternative_kind.len(),
        alternative_path.len(),
        guard.len(),
    )
}

#[doc = "ousia: ownerless-fn structural target identity projection"]
fn structural_target_identity(target: &TargetSubject) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}",
        target.root_id.len(),
        target.root_id,
        target.target_kind.as_str().len(),
        target.target_kind.as_str(),
        target.target_name.len(),
        target.target_name,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::cfg::CfgEnvironment;
    use crate::analysis::subject::TargetKind;
    use rstest::rstest;

    /// Goal: preserve two logical module occurrences that share one physical source.
    /// Scope: level=integration; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: both path declarations survive with distinct occurrence IDs while the repository parses shared.rs once.
    #[test]
    fn shared_path_source_keeps_distinct_occurrences() {
        let root = fixture_root("shared-occurrences");
        std::fs::write(
            root.join("lib.rs"),
            "#[path = \"shared.rs\"] mod first;\n#[path = \"shared.rs\"] mod second;\n",
        )
        .expect("write root fixture");
        std::fs::write(root.join("shared.rs"), "").expect("write shared fixture");
        let target = target(&root.join("lib.rs"));
        let mut repository = PhysicalSourceRepository::default();
        let mut cfg = CfgModel::new(CfgEnvironment::fixture(&[]));

        let graph = LogicalInclusionGraph::build(&[target], &mut repository, &mut cfg)
            .expect("build graph");

        assert_eq!(repository.len(), 2);
        assert_eq!(graph.occurrences().len(), 3);
        assert_ne!(graph.occurrences()[1].id(), graph.occurrences()[2].id());
        assert_ne!(
            graph.occurrences()[1].wire_id(),
            graph.occurrences()[2].wire_id()
        );
        assert!(graph.occurrences()[1].wire_id().contains("first"));
        assert!(graph.occurrences()[2].wire_id().contains("second"));
        assert!(
            graph
                .occurrences()
                .iter()
                .all(|occurrence| !occurrence.wire_id().contains("occurrence-"))
        );
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    /// Goal: discover out-of-line modules declared inside inline modules.
    /// Scope: level=integration; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: outer::child is represented as a full-file occurrence under the inline parent.
    #[test]
    fn inline_module_discovers_out_of_line_child() {
        let root = fixture_root("inline-child");
        std::fs::create_dir_all(root.join("outer")).expect("create child directory");
        std::fs::write(root.join("lib.rs"), "mod outer { mod child; }\n")
            .expect("write root fixture");
        std::fs::write(root.join("outer/child.rs"), "").expect("write child fixture");
        let target = target(&root.join("lib.rs"));
        let mut repository = PhysicalSourceRepository::default();
        let mut cfg = CfgModel::new(CfgEnvironment::fixture(&[]));

        let graph = LogicalInclusionGraph::build(&[target], &mut repository, &mut cfg)
            .expect("build graph");

        assert!(
            graph
                .occurrences()
                .iter()
                .any(|occurrence| occurrence.module_path() == ["outer", "child"])
        );
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    /// Goal: require conditional module paths to cover every reachable declaration configuration.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: whichever mutually exclusive source branch is absent, graph construction fails with module-source-missing and commits no occurrence graph.
    #[rstest]
    #[case::default_branch_missing("x.rs")]
    #[case::selected_branch_missing("child.rs")]
    fn conditional_path_requires_every_branch_source(#[case] existing_source: &str) {
        let root = fixture_root(existing_source.trim_end_matches(".rs"));
        std::fs::write(
            root.join("lib.rs"),
            "#[cfg_attr(feature = \"x\", path = \"x.rs\")] mod child;\n",
        )
        .expect("write root fixture");
        std::fs::write(root.join(existing_source), "").expect("write existing source");

        let error = build_graph(&root).expect_err("uncovered source branch must fail");
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(error.code(), "module-source-missing");
    }

    /// Goal: preserve cumulative physical AST location through nested inline modules.
    /// Scope: level=integration; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: outer::inner and its out-of-line child are each visited once at the correct body without recursion into a root item.
    #[test]
    fn nested_inline_modules_preserve_cumulative_body_locator() {
        let root = fixture_root("nested-inline-locator");
        std::fs::create_dir_all(root.join("outer/inner")).expect("create nested directory");
        std::fs::write(
            root.join("lib.rs"),
            "mod outer { mod inner { mod child; } }\n",
        )
        .expect("write root fixture");
        std::fs::write(root.join("outer/inner/child.rs"), "").expect("write nested child source");

        let graph = build_graph(&root).expect("build nested inline graph");
        let module_paths = graph
            .occurrences()
            .iter()
            .map(|occurrence| occurrence.module_path().join("::"))
            .collect::<Vec<_>>();
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(
            module_paths,
            ["", "outer", "outer::inner", "outer::inner::child"]
        );
    }

    /// Goal: preserve mutually exclusive guarded alternatives as distinct logical occurrences.
    /// Scope: level=integration; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: two guards selecting one physical source produce two structural IDs while shared.rs is parsed once.
    #[test]
    fn mutually_exclusive_same_path_alternatives_keep_distinct_identity() {
        let root = fixture_root("mutually-exclusive-shared-path");
        std::fs::write(
            root.join("lib.rs"),
            "#[cfg_attr(feature = \"x\", path = \"shared.rs\")]\n#[cfg_attr(not(feature = \"x\"), path = \"shared.rs\")]\nmod child;\n",
        )
        .expect("write root fixture");
        std::fs::write(root.join("shared.rs"), "").expect("write shared source");
        let target = target(&root.join("lib.rs"));
        let mut repository = PhysicalSourceRepository::default();
        let mut cfg = CfgModel::new(CfgEnvironment::fixture(&[]));

        let graph = LogicalInclusionGraph::build(&[target], &mut repository, &mut cfg)
            .expect("build graph");

        assert_eq!(repository.len(), 2);
        assert_eq!(graph.occurrences().len(), 3);
        assert_ne!(
            graph.occurrences()[1].wire_id(),
            graph.occurrences()[2].wire_id()
        );
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    /// Goal: accept conditional module alternatives only when their existing sources cover all reachable guards.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: the feature-selected and default files produce two mutually exclusive occurrences with no missing-source or ambiguity fatal.
    #[test]
    fn conditional_path_with_complete_source_coverage_builds_both_occurrences() {
        let root = fixture_root("conditional-complete");
        std::fs::write(
            root.join("lib.rs"),
            "#[cfg_attr(feature = \"x\", path = \"x.rs\")] mod child;\n",
        )
        .expect("write root fixture");
        std::fs::write(root.join("x.rs"), "").expect("write selected source");
        std::fs::write(root.join("child.rs"), "").expect("write default source");

        let graph = build_graph(&root).expect("build covered graph");
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(
            graph
                .occurrences()
                .iter()
                .filter(|occurrence| occurrence.module_path() == ["child"])
                .count(),
            2
        );
    }

    /// Goal: exclude the test universe from graph coverage when a Cargo target is not test-enabled.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: cfg(test) may reference an absent source for a test-disabled production target without creating an occurrence or fatal.
    #[test]
    fn test_disabled_target_does_not_require_cfg_test_source() {
        let root = fixture_root("test-disabled-universe");
        std::fs::write(root.join("lib.rs"), "#[cfg(test)] mod absent;\n")
            .expect("write root fixture");
        let mut target = target(&root.join("lib.rs"));
        target.test_enabled = false;
        let mut repository = PhysicalSourceRepository::default();
        let mut cfg = CfgModel::new(CfgEnvironment::fixture(&[]));

        let graph = LogicalInclusionGraph::build(&[target], &mut repository, &mut cfg)
            .expect("ignore disabled test universe");
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(graph.occurrences().len(), 1);
    }

    /// Goal: exclude the production universe from graph coverage for Cargo integration-test targets.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: cfg(not(test)) may reference an absent source for a test target without creating an occurrence or fatal.
    #[test]
    fn test_target_does_not_require_production_only_source() {
        let root = fixture_root("test-target-universe");
        std::fs::write(root.join("lib.rs"), "#[cfg(not(test))] mod absent;\n")
            .expect("write root fixture");
        let mut target = target(&root.join("lib.rs"));
        target.target_kind = TargetKind::Test;
        let mut repository = PhysicalSourceRepository::default();
        let mut cfg = CfgModel::new(CfgEnvironment::fixture(&[]));

        let graph = LogicalInclusionGraph::build(&[target], &mut repository, &mut cfg)
            .expect("ignore disabled production universe");
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(graph.occurrences().len(), 1);
    }

    /// Goal: reject two existing path alternatives whose guards can activate together.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: overlapping feature guards fail with module-ambiguity before either child occurrence is committed.
    #[test]
    fn overlapping_path_alternatives_are_ambiguity_fatal() {
        let root = fixture_root("overlapping-alternatives");
        std::fs::write(
            root.join("lib.rs"),
            "#[cfg_attr(feature = \"x\", path = \"first.rs\")]\n#[cfg_attr(feature = \"y\", path = \"second.rs\")]\nmod child;\n",
        )
        .expect("write root fixture");
        std::fs::write(root.join("first.rs"), "").expect("write first source");
        std::fs::write(root.join("second.rs"), "").expect("write second source");
        std::fs::write(root.join("child.rs"), "").expect("write default source");

        let error = build_graph(&root).expect_err("overlapping alternatives must fail");
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(error.code(), "module-ambiguity");
    }

    /// Goal: reject duplicate guarded alternatives before assigning occurrence identity.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: duplicate path attributes with the same effective guard fail with module-ambiguity instead of receiving ordinal identities.
    #[test]
    fn duplicate_guarded_alternative_is_ambiguity_fatal() {
        let root = fixture_root("duplicate-alternative");
        std::fs::write(
            root.join("lib.rs"),
            "#[path = \"shared.rs\"]\n#[path = \"shared.rs\"]\nmod child;\n",
        )
        .expect("write root fixture");
        std::fs::write(root.join("shared.rs"), "").expect("write shared source");

        let error = build_graph(&root).expect_err("duplicate alternative must fail");
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(error.code(), "module-ambiguity");
    }

    /// Goal: keep a module occurrence stable when a differently named sibling is inserted before it.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: child retains the same structural wire identity even though its DFS index changes.
    #[test]
    fn unrelated_sibling_insertion_does_not_change_wire_identity() {
        let root = fixture_root("sibling-stability");
        std::fs::write(root.join("child.rs"), "").expect("write child source");
        std::fs::write(root.join("lib.rs"), "mod child;\n").expect("write first root");
        let first = build_graph(&root).expect("build first graph");
        let child_before = occurrence_wire_id(&first, &["child"]);

        std::fs::write(root.join("added.rs"), "").expect("write added source");
        std::fs::write(root.join("lib.rs"), "mod added;\nmod child;\n").expect("write second root");
        let second = build_graph(&root).expect("build second graph");
        let child_after = occurrence_wire_id(&second, &["child"]);
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(child_after, child_before);
    }

    /// Goal: distinguish same-name declarations only by their same-parent semantic ordinal.
    /// Scope: level=contract; boundary=analysis::module_graph::LogicalInclusionGraph::build
    /// Semantics: two mutually exclusive child declarations receive distinct IDs while an unrelated declaration before them does not change either ID.
    #[test]
    fn same_name_declaration_ordinal_ignores_different_name_siblings() {
        let root = fixture_root("same-name-ordinal");
        std::fs::write(root.join("first.rs"), "").expect("write first source");
        std::fs::write(root.join("second.rs"), "").expect("write second source");
        let declarations = "#[cfg(feature = \"x\")] #[path = \"first.rs\"] mod child;\n#[cfg(not(feature = \"x\"))] #[path = \"second.rs\"] mod child;\n";
        std::fs::write(root.join("lib.rs"), declarations).expect("write first root");
        let first = build_graph(&root).expect("build first graph");
        let ids_before = occurrence_wire_ids(&first, &["child"]);

        std::fs::write(root.join("added.rs"), "").expect("write added source");
        std::fs::write(root.join("lib.rs"), format!("mod added;\n{declarations}"))
            .expect("write second root");
        let second = build_graph(&root).expect("build second graph");
        let ids_after = occurrence_wire_ids(&second, &["child"]);
        std::fs::remove_dir_all(root).expect("remove fixture");

        assert_eq!(ids_before.len(), 2);
        assert_ne!(ids_before[0], ids_before[1]);
        assert_eq!(ids_after, ids_before);
    }

    fn build_graph(root: &Path) -> Result<LogicalInclusionGraph, FatalError> {
        let target = target(&root.join("lib.rs"));
        let mut repository = PhysicalSourceRepository::default();
        let mut cfg = CfgModel::new(CfgEnvironment::fixture(&[]));
        LogicalInclusionGraph::build(&[target], &mut repository, &mut cfg)
    }

    fn occurrence_wire_id(graph: &LogicalInclusionGraph, module_path: &[&str]) -> String {
        graph
            .occurrences()
            .iter()
            .find(|occurrence| {
                occurrence
                    .module_path()
                    .iter()
                    .map(String::as_str)
                    .eq(module_path.iter().copied())
            })
            .expect("module occurrence")
            .wire_id()
            .to_owned()
    }

    fn occurrence_wire_ids(graph: &LogicalInclusionGraph, module_path: &[&str]) -> Vec<String> {
        graph
            .occurrences()
            .iter()
            .filter(|occurrence| {
                occurrence
                    .module_path()
                    .iter()
                    .map(String::as_str)
                    .eq(module_path.iter().copied())
            })
            .map(|occurrence| occurrence.wire_id().to_owned())
            .collect()
    }

    fn fixture_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "ousia-rust-checker-graph-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create graph fixture");
        root
    }

    fn target(path: &Path) -> TargetSubject {
        TargetSubject {
            root_id: "cargo:7:fixture:3:lib".to_owned(),
            root_locator: "Cargo.toml".to_owned(),
            root_path: path.parent().expect("fixture parent").to_path_buf(),
            source_path: path.to_path_buf(),
            target_kind: TargetKind::Lib,
            target_name: "fixture".to_owned(),
            test_enabled: true,
            package_name: "fixture".to_owned(),
            lib_crate_name: None,
        }
    }
}
