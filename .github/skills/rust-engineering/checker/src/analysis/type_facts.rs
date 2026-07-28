use std::collections::{BTreeMap, BTreeSet};

use proc_macro2::LineColumn;
use quote::ToTokens;

use super::cfg::{AttributeClass, CfgExpr, CfgModel, Universe};
use super::error::{FatalError, FatalPhase};
use super::guarded_uses::{GuardedUseGlob, GuardedUseIndex, GuardedUseLeaf, resolve_local_path};
use super::module_graph::{LogicalInclusionGraph, body_items};
use super::projected_items::ProjectedItemIndex;
use super::source_repository::PhysicalSourceRepository;
use super::subject::wire_path;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct ModuleKey {
    target: String,
    path: Vec<String>,
}

#[derive(Default)]
struct ModuleTypeContext {
    imports: BTreeMap<String, Vec<GuardedImport>>,
    globs: Vec<GuardedImport>,
    external_imports: BTreeMap<String, Vec<CfgExpr>>,
    external_globs: Vec<CfgExpr>,
}

#[derive(Clone)]
struct GuardedImport {
    path: Vec<String>,
    guard: CfgExpr,
}

struct AliasEdge {
    id: String,
    module: ModuleKey,
    target: SimpleTypePath,
    guard: CfgExpr,
}

struct SimpleTypePath {
    segments: Vec<String>,
    external_absolute: bool,
}

struct NominalDefinition {
    guard: CfgExpr,
    zero_field_index: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct TypeKey {
    target: String,
    path: Vec<String>,
}

struct ZeroFieldTypeFact {
    id: String,
    target: String,
    module: String,
    source: String,
    location: LineColumn,
    name: String,
    shape: &'static str,
    visibility: String,
    guard: CfgExpr,
    has_derive: bool,
    inherent_impls: Vec<InherentImplFact>,
    has_trait_impl: bool,
    association_uncertainties: BTreeSet<TypeAssociationWarning>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum TypeAssociationWarning {
    Ambiguous,
    Unresolved,
    ExternalGlob,
}

struct ResolutionState {
    module: ModuleKey,
    segments: Vec<String>,
    guard: CfgExpr,
    alias_stack: BTreeSet<String>,
    traversed_edge: bool,
}

struct ResolvedNominal {
    key: TypeKey,
    zero_field_index: Option<usize>,
    guard: CfgExpr,
}

struct AssociationUncertainty {
    reason: TypeAssociationWarning,
    guard: CfgExpr,
    related: BTreeSet<TypeKey>,
}

#[derive(Default)]
struct TypeResolution {
    terminals: Vec<ResolvedNominal>,
    uncertainties: Vec<AssociationUncertainty>,
}

struct InherentImplFact {
    id: String,
    source: String,
    location: LineColumn,
    member_count: usize,
}

pub(crate) struct ZeroFieldTypeView<'a> {
    pub(crate) id: &'a str,
    pub(crate) target: &'a str,
    pub(crate) module: &'a str,
    pub(crate) source: &'a str,
    pub(crate) location: LineColumn,
    pub(crate) name: &'a str,
    pub(crate) shape: &'static str,
    pub(crate) visibility: &'a str,
    pub(crate) inherent_impls: Vec<InherentImplView<'a>>,
}

pub(crate) struct InherentImplView<'a> {
    pub(crate) id: &'a str,
    pub(crate) source: &'a str,
    pub(crate) location: LineColumn,
    pub(crate) member_count: usize,
}

pub(crate) struct TypeFactIndex {
    types: Vec<ZeroFieldTypeFact>,
    warnings: BTreeSet<TypeAssociationWarning>,
}

impl TypeFactIndex {
    pub(crate) fn build(
        graph: &LogicalInclusionGraph,
        repository: &PhysicalSourceRepository,
        projected: &ProjectedItemIndex,
        guarded_uses: &GuardedUseIndex,
        cfg: &mut CfgModel,
    ) -> Result<Self, FatalError> {
        let mut types = Vec::new();
        let mut by_key = BTreeMap::<TypeKey, Vec<usize>>::new();
        let mut definitions = BTreeMap::<TypeKey, Vec<NominalDefinition>>::new();
        let mut aliases = BTreeMap::<TypeKey, Vec<AliasEdge>>::new();
        let mut contexts = BTreeMap::<ModuleKey, ModuleTypeContext>::new();
        for occurrence in graph.occurrences() {
            if !occurrence.target().target_kind.production_enabled() {
                continue;
            }
            let items = body_items(repository, occurrence.body());
            let projected_module = projected.module(occurrence.id());
            let target = occurrence.target().root_id.clone();
            let module = ModuleKey {
                target: target.clone(),
                path: occurrence.module_path().to_vec(),
            };
            contexts.insert(
                module.clone(),
                ModuleTypeContext::from_uses(
                    occurrence.module_path(),
                    guarded_uses.module(occurrence.id()),
                    guarded_uses.globs(occurrence.id()),
                ),
            );
            for item in projected_module.items() {
                if !item.production_possible() {
                    continue;
                }
                let syntax = &items[item.ordinal()];
                if let syn::Item::Type(alias) = syntax
                    && let Some(target_path) = simple_type_path(alias.ty.as_ref())
                {
                    let mut path = occurrence.module_path().to_vec();
                    path.push(alias.ident.to_string());
                    aliases
                        .entry(TypeKey {
                            target: target.clone(),
                            path,
                        })
                        .or_default()
                        .push(AliasEdge {
                            id: item.id().as_str().to_owned(),
                            module: module.clone(),
                            target: target_path,
                            guard: item.effective_guard().clone(),
                        });
                    continue;
                }
                let Some((name, zero_field)) = nominal_type(syntax) else {
                    continue;
                };
                let mut path = occurrence.module_path().to_vec();
                path.push(name.clone());
                let key = TypeKey {
                    target: target.clone(),
                    path,
                };
                let zero_field_index = if let Some((structure, shape)) = zero_field {
                    let source = repository.get(occurrence.source_id()).path();
                    let relative = source
                        .strip_prefix(&occurrence.target().root_path)
                        .unwrap_or(source);
                    let has_derive = item
                        .attributes()
                        .ordered_attributes()
                        .filter(|fact| fact.class == AttributeClass::Derive)
                        .map(|fact| {
                            CfgExpr::all([item.effective_guard().clone(), fact.guard.clone()])
                        })
                        .try_fold(false, |found, guard| {
                            cfg.possible(&guard, Universe::Production)
                                .map(|possible| found || possible)
                        })?;
                    let index = types.len();
                    by_key.entry(key.clone()).or_default().push(index);
                    types.push(ZeroFieldTypeFact {
                        id: item.id().as_str().to_owned(),
                        target: occurrence.target().label(),
                        module: if occurrence.module_path().is_empty() {
                            "crate".to_owned()
                        } else {
                            occurrence.module_path().join("::")
                        },
                        source: wire_path(relative),
                        location: structure.ident.span().start(),
                        name,
                        shape,
                        visibility: structure.vis.to_token_stream().to_string(),
                        guard: item.effective_guard().clone(),
                        has_derive,
                        inherent_impls: Vec::new(),
                        has_trait_impl: false,
                        association_uncertainties: BTreeSet::new(),
                    });
                    Some(index)
                } else {
                    None
                };
                definitions.entry(key).or_default().push(NominalDefinition {
                    guard: item.effective_guard().clone(),
                    zero_field_index,
                });
            }
        }

        let mut warnings = BTreeSet::new();
        for occurrence in graph.occurrences() {
            if !occurrence.target().target_kind.production_enabled() {
                continue;
            }
            let items = body_items(repository, occurrence.body());
            let projected_module = projected.module(occurrence.id());
            let module = ModuleKey {
                target: occurrence.target().root_id.clone(),
                path: occurrence.module_path().to_vec(),
            };
            for item in projected_module.items() {
                if !item.production_possible() {
                    continue;
                }
                let syn::Item::Impl(implementation) = &items[item.ordinal()] else {
                    continue;
                };
                let Some(target_path) = simple_type_path(&implementation.self_ty) else {
                    continue;
                };
                if target_path.external_absolute {
                    warnings.insert(TypeAssociationWarning::Unresolved);
                    continue;
                }
                let TypeResolution {
                    mut terminals,
                    mut uncertainties,
                } = resolve_type(
                    module.clone(),
                    target_path.segments,
                    item.effective_guard().clone(),
                    &contexts,
                    &aliases,
                    &definitions,
                    cfg,
                )?;
                terminals.sort_by(|left, right| {
                    left.key
                        .cmp(&right.key)
                        .then_with(|| left.zero_field_index.cmp(&right.zero_field_index))
                        .then_with(|| left.guard.cmp(&right.guard))
                });
                terminals.dedup_by(|left, right| {
                    left.key == right.key
                        && left.zero_field_index == right.zero_field_index
                        && left.guard == right.guard
                });
                let mut ambiguous = BTreeSet::new();
                for (position, left) in terminals.iter().enumerate() {
                    for right in &terminals[position + 1..] {
                        if left.key != right.key
                            && cfg.possible(
                                &CfgExpr::all([left.guard.clone(), right.guard.clone()]),
                                Universe::Production,
                            )?
                        {
                            let mut related = BTreeSet::new();
                            related.insert(left.key.clone());
                            related.insert(right.key.clone());
                            uncertainties.push(AssociationUncertainty {
                                reason: TypeAssociationWarning::Ambiguous,
                                guard: CfgExpr::all([left.guard.clone(), right.guard.clone()]),
                                related,
                            });
                            if let Some(index) = left.zero_field_index {
                                ambiguous.insert(index);
                            }
                            if let Some(index) = right.zero_field_index {
                                ambiguous.insert(index);
                            }
                        }
                    }
                }
                if !ambiguous.is_empty() {
                    warnings.insert(TypeAssociationWarning::Ambiguous);
                    for index in ambiguous {
                        types[index]
                            .association_uncertainties
                            .insert(TypeAssociationWarning::Ambiguous);
                    }
                }
                for terminal in &terminals {
                    let Some(index) = terminal.zero_field_index else {
                        continue;
                    };
                    for uncertainty in &uncertainties {
                        if uncertainty.related.contains(&terminal.key)
                            && cfg.possible(
                                &CfgExpr::all([terminal.guard.clone(), uncertainty.guard.clone()]),
                                Universe::Production,
                            )?
                        {
                            types[index]
                                .association_uncertainties
                                .insert(uncertainty.reason);
                        }
                    }
                    if types[index].association_uncertainties.is_empty() {
                        associate_impl(
                            &mut types[index],
                            implementation,
                            item,
                            occurrence,
                            repository,
                        );
                    }
                }
                for uncertainty in &uncertainties {
                    warnings.insert(uncertainty.reason);
                    for key in &uncertainty.related {
                        if let Some(indexes) = by_key.get(key) {
                            for index in indexes {
                                if cfg.possible(
                                    &CfgExpr::all([
                                        types[*index].guard.clone(),
                                        uncertainty.guard.clone(),
                                    ]),
                                    Universe::Production,
                                )? {
                                    types[*index]
                                        .association_uncertainties
                                        .insert(uncertainty.reason);
                                }
                            }
                        }
                    }
                }
            }
        }
        let mut ids = BTreeSet::new();
        if types.iter().any(|fact| !ids.insert(fact.id.clone())) {
            return Err(FatalError::new(
                FatalPhase::Model,
                "type-fact-identity-collision",
                "projected zero-field type identity is not unique",
            ));
        }
        Ok(Self { types, warnings })
    }

    pub(crate) fn zero_field_inherent_only(&self) -> impl Iterator<Item = ZeroFieldTypeView<'_>> {
        self.types
            .iter()
            .filter(|fact| {
                !fact.has_derive
                    && !fact.has_trait_impl
                    && fact.association_uncertainties.is_empty()
                    && !fact.inherent_impls.is_empty()
            })
            .map(|fact| ZeroFieldTypeView {
                id: &fact.id,
                target: &fact.target,
                module: &fact.module,
                source: &fact.source,
                location: fact.location,
                name: &fact.name,
                shape: fact.shape,
                visibility: &fact.visibility,
                inherent_impls: fact
                    .inherent_impls
                    .iter()
                    .map(|implementation| InherentImplView {
                        id: &implementation.id,
                        source: &implementation.source,
                        location: implementation.location,
                        member_count: implementation.member_count,
                    })
                    .collect(),
            })
    }

    pub(crate) fn association_warnings(&self) -> impl Iterator<Item = TypeAssociationWarning> + '_ {
        self.warnings.iter().copied()
    }
}

impl ModuleTypeContext {
    fn from_uses(
        module: &[String],
        use_leaves: &[GuardedUseLeaf],
        use_globs: &[GuardedUseGlob],
    ) -> Self {
        let mut imports = BTreeMap::<String, Vec<GuardedImport>>::new();
        let mut external_imports = BTreeMap::<String, Vec<CfgExpr>>::new();
        for leaf in use_leaves {
            if leaf.external_absolute {
                external_imports
                    .entry(leaf.local_name.clone())
                    .or_default()
                    .push(leaf.guard.clone());
                continue;
            }
            if let Some(path) = resolve_local_path(module, &leaf.source_path) {
                imports
                    .entry(leaf.local_name.clone())
                    .or_default()
                    .push(GuardedImport {
                        path,
                        guard: leaf.guard.clone(),
                    });
            }
        }
        let globs = use_globs
            .iter()
            .filter(|glob| !glob.external_absolute)
            .filter_map(|glob| {
                resolve_local_path(module, &glob.source_path).map(|path| GuardedImport {
                    path,
                    guard: glob.guard.clone(),
                })
            })
            .collect();
        let external_globs = use_globs
            .iter()
            .filter(|glob| glob.external_absolute)
            .map(|glob| glob.guard.clone())
            .collect();
        Self {
            imports,
            globs,
            external_imports,
            external_globs,
        }
    }
}

#[doc = "ousia: ownerless-fn nominal type fact projection"]
fn nominal_type(item: &syn::Item) -> Option<(String, Option<(&syn::ItemStruct, &'static str)>)> {
    match item {
        syn::Item::Struct(structure) => Some((
            structure.ident.to_string(),
            zero_field_shape(&structure.fields).map(|shape| (structure, shape)),
        )),
        syn::Item::Enum(item) => Some((item.ident.to_string(), None)),
        syn::Item::Union(item) => Some((item.ident.to_string(), None)),
        _ => None,
    }
}

#[doc = "ousia: ownerless-fn simple type path syntax projection"]
fn simple_type_path(ty: &syn::Type) -> Option<SimpleTypePath> {
    let syn::Type::Path(path) = ty else {
        return None;
    };
    if path.qself.is_some()
        || path
            .path
            .segments
            .iter()
            .any(|segment| !segment.arguments.is_empty())
    {
        return None;
    }
    Some(SimpleTypePath {
        segments: path
            .path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect(),
        external_absolute: path.path.leading_colon.is_some(),
    })
}

#[doc = "ousia: ownerless-fn guarded type association closure"]
fn resolve_type(
    module: ModuleKey,
    segments: Vec<String>,
    guard: CfgExpr,
    contexts: &BTreeMap<ModuleKey, ModuleTypeContext>,
    aliases: &BTreeMap<TypeKey, Vec<AliasEdge>>,
    definitions: &BTreeMap<TypeKey, Vec<NominalDefinition>>,
    cfg: &mut CfgModel,
) -> Result<TypeResolution, FatalError> {
    let mut resolution = TypeResolution::default();
    let mut visited = BTreeSet::new();
    let mut worklist = vec![ResolutionState {
        module,
        segments,
        guard,
        alias_stack: BTreeSet::new(),
        traversed_edge: false,
    }];
    while let Some(state) = worklist.pop() {
        if !cfg.possible(&state.guard, Universe::Production)? {
            continue;
        }
        let state_key = (
            state.module.clone(),
            state.segments.clone(),
            state.guard.clone(),
        );
        if !visited.insert(state_key) {
            let mut path = state.module.path.clone();
            path.extend(state.segments.iter().cloned());
            resolution.uncertainties.push(AssociationUncertainty {
                reason: TypeAssociationWarning::Unresolved,
                guard: state.guard,
                related: BTreeSet::from([TypeKey {
                    target: state.module.target,
                    path,
                }]),
            });
            continue;
        }
        let Some(head) = state.segments.first() else {
            continue;
        };
        let context = contexts.get(&state.module);
        let imports = context
            .and_then(|context| context.imports.get(head))
            .cloned()
            .unwrap_or_default();
        let external_import_guards = context
            .and_then(|context| context.external_imports.get(head))
            .cloned()
            .unwrap_or_default();
        let mut expanded = false;
        let mut coverage = Vec::new();
        for import in imports {
            coverage.push(import.guard.clone());
            let mut path = import.path;
            path.extend(state.segments[1..].iter().cloned());
            let module_path = path[..path.len().saturating_sub(1)].to_vec();
            let local_name = path.last().cloned().into_iter().collect();
            worklist.push(ResolutionState {
                module: ModuleKey {
                    target: state.module.target.clone(),
                    path: module_path,
                },
                segments: local_name,
                guard: CfgExpr::all([state.guard.clone(), import.guard]),
                alias_stack: state.alias_stack.clone(),
                traversed_edge: true,
            });
            expanded = true;
        }
        for external_guard in external_import_guards {
            coverage.push(external_guard.clone());
            resolution.uncertainties.push(AssociationUncertainty {
                reason: TypeAssociationWarning::Unresolved,
                guard: CfgExpr::all([state.guard.clone(), external_guard]),
                related: BTreeSet::new(),
            });
            expanded = true;
        }

        let local_path = resolve_local_path(&state.module.path, &state.segments)
            .expect("module-local path projection is total");
        let key = TypeKey {
            target: state.module.target.clone(),
            path: local_path,
        };
        if let Some(edges) = aliases.get(&key) {
            for edge in edges {
                coverage.push(edge.guard.clone());
                let edge_guard = CfgExpr::all([state.guard.clone(), edge.guard.clone()]);
                if !cfg.possible(&edge_guard, Universe::Production)? {
                    continue;
                }
                if state.alias_stack.contains(&edge.id) {
                    let mut related = BTreeSet::new();
                    related.insert(key.clone());
                    resolution.uncertainties.push(AssociationUncertainty {
                        reason: TypeAssociationWarning::Unresolved,
                        guard: edge_guard,
                        related,
                    });
                    continue;
                }
                let mut alias_stack = state.alias_stack.clone();
                alias_stack.insert(edge.id.clone());
                if edge.target.external_absolute {
                    let mut related = BTreeSet::new();
                    related.insert(key.clone());
                    resolution.uncertainties.push(AssociationUncertainty {
                        reason: TypeAssociationWarning::Unresolved,
                        guard: edge_guard,
                        related,
                    });
                    continue;
                }
                let mut target = edge.target.segments.clone();
                target.extend(state.segments[1..].iter().cloned());
                worklist.push(ResolutionState {
                    module: edge.module.clone(),
                    segments: target,
                    guard: edge_guard,
                    alias_stack,
                    traversed_edge: true,
                });
                expanded = true;
            }
        }
        if let Some(candidates) = definitions.get(&key) {
            for candidate in candidates {
                coverage.push(candidate.guard.clone());
                let candidate_guard = CfgExpr::all([state.guard.clone(), candidate.guard.clone()]);
                if cfg.possible(&candidate_guard, Universe::Production)? {
                    resolution.terminals.push(ResolvedNominal {
                        key: key.clone(),
                        zero_field_index: candidate.zero_field_index,
                        guard: candidate_guard,
                    });
                }
            }
        }
        if !expanded && state.traversed_edge && !definitions.contains_key(&key) {
            let mut related = BTreeSet::new();
            related.insert(key.clone());
            resolution.uncertainties.push(AssociationUncertainty {
                reason: TypeAssociationWarning::Unresolved,
                guard: state.guard.clone(),
                related,
            });
        }
        let explicit_coverage = CfgExpr::any(coverage.clone());
        if let Some(context) = context {
            for glob in &context.globs {
                let mut path = glob.path.clone();
                path.extend(state.segments.iter().cloned());
                let glob_key = TypeKey {
                    target: state.module.target.clone(),
                    path,
                };
                let glob_module = ModuleKey {
                    target: state.module.target.clone(),
                    path: glob.path.clone(),
                };
                let known = definitions.contains_key(&glob_key)
                    || aliases.contains_key(&glob_key)
                    || contexts
                        .get(&glob_module)
                        .is_some_and(|context| context.imports.contains_key(head));
                if known {
                    let glob_guard =
                        CfgExpr::all([glob.guard.clone(), CfgExpr::not(explicit_coverage.clone())]);
                    coverage.push(glob_guard.clone());
                    if cfg.possible(
                        &CfgExpr::all([state.guard.clone(), glob_guard.clone()]),
                        Universe::Production,
                    )? {
                        worklist.push(ResolutionState {
                            module: glob_module,
                            segments: state.segments.clone(),
                            guard: CfgExpr::all([state.guard.clone(), glob_guard.clone()]),
                            alias_stack: state.alias_stack.clone(),
                            traversed_edge: true,
                        });
                        expanded = true;
                    }
                } else {
                    resolution.uncertainties.push(AssociationUncertainty {
                        reason: TypeAssociationWarning::ExternalGlob,
                        guard: CfgExpr::all([
                            state.guard.clone(),
                            glob.guard.clone(),
                            CfgExpr::not(explicit_coverage.clone()),
                        ]),
                        related: BTreeSet::new(),
                    });
                }
            }
            for glob_guard in &context.external_globs {
                resolution.uncertainties.push(AssociationUncertainty {
                    reason: TypeAssociationWarning::ExternalGlob,
                    guard: CfgExpr::all([
                        state.guard.clone(),
                        glob_guard.clone(),
                        CfgExpr::not(explicit_coverage.clone()),
                    ]),
                    related: BTreeSet::new(),
                });
            }
        }
        if (state.traversed_edge || expanded)
            && cfg.possible(
                &CfgExpr::all([
                    state.guard.clone(),
                    CfgExpr::not(CfgExpr::any(coverage.clone())),
                ]),
                Universe::Production,
            )?
        {
            let mut related = BTreeSet::new();
            related.insert(key);
            resolution.uncertainties.push(AssociationUncertainty {
                reason: TypeAssociationWarning::Unresolved,
                guard: CfgExpr::all([state.guard, CfgExpr::not(CfgExpr::any(coverage))]),
                related,
            });
        }
    }
    for uncertainty in &mut resolution.uncertainties {
        for terminal in &resolution.terminals {
            if cfg.possible(
                &CfgExpr::all([uncertainty.guard.clone(), terminal.guard.clone()]),
                Universe::Production,
            )? {
                uncertainty.related.insert(terminal.key.clone());
            }
        }
    }
    let mut reachable = Vec::new();
    for uncertainty in resolution.uncertainties {
        if cfg.possible(&uncertainty.guard, Universe::Production)? {
            reachable.push(uncertainty);
        }
    }
    resolution.uncertainties = reachable;
    Ok(resolution)
}

#[doc = "ousia: ownerless-fn zero-field impl fact association"]
fn associate_impl(
    fact: &mut ZeroFieldTypeFact,
    implementation: &syn::ItemImpl,
    item: &super::projected_items::ProjectedItem,
    occurrence: &super::module_graph::ModuleOccurrence,
    repository: &PhysicalSourceRepository,
) {
    if implementation.trait_.is_some() {
        fact.has_trait_impl = true;
    } else {
        let source = repository.get(occurrence.source_id()).path();
        let relative = source
            .strip_prefix(&occurrence.target().root_path)
            .unwrap_or(source);
        fact.inherent_impls.push(InherentImplFact {
            id: item.id().as_str().to_owned(),
            source: wire_path(relative),
            location: implementation.impl_token.span.start(),
            member_count: implementation.items.len(),
        });
    }
}

#[doc = "ousia: ownerless-fn zero-field struct shape projection"]
fn zero_field_shape(fields: &syn::Fields) -> Option<&'static str> {
    match fields {
        syn::Fields::Unit => Some("unit"),
        syn::Fields::Unnamed(fields) if fields.unnamed.is_empty() => Some("tuple"),
        syn::Fields::Named(fields) if fields.named.is_empty() => Some("named"),
        syn::Fields::Named(_) | syn::Fields::Unnamed(_) => None,
    }
}
