use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::visit::{self, Visit};
use syn::{Expr, Token};

use super::cfg::{CfgExpr, CfgModel, Universe};
use super::error::FatalError;
use super::guarded_uses::{GuardedUseIndex, resolve_local_path};
use super::module_graph::{LogicalInclusionGraph, OccurrenceId, body_items};
use super::projected_items::{ItemId, ProjectedItemIndex};
use super::source_repository::PhysicalSourceRepository;
use super::subject::{TargetKind, TargetSubject};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct CallableId(String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UsageKind {
    Call,
    ValueReference,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct FunctionKey {
    target: String,
    path: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct ModuleKey {
    target: String,
    path: Vec<String>,
}

struct CallableFact {
    id: CallableId,
    target: String,
    path: Vec<String>,
    module_path: Vec<String>,
    package_name: String,
    lib_crate_name: Option<String>,
    self_type: Option<Vec<String>>,
    guard: CfgExpr,
}

struct FunctionDefinition {
    callable: CallableId,
    location: String,
}

#[derive(Clone)]
enum ImportTarget {
    Function(FunctionKey),
    Module { target: String, path: Vec<String> },
}

struct ImportLeaf {
    target: ImportTarget,
    guard: CfgExpr,
}

struct UsageFact {
    caller: CallableId,
    kind: UsageKind,
    source_path: Vec<String>,
    guard: CfgExpr,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BlockerNamespace {
    BareValue,
    PathHead,
}

struct GuardedBlocker {
    name: String,
    namespace: BlockerNamespace,
    guard: CfgExpr,
}

struct LexicalScopes {
    regions: Vec<Vec<GuardedBlocker>>,
}

impl LexicalScopes {
    fn new() -> Self {
        Self {
            regions: vec![Vec::new()],
        }
    }

    fn enter(&mut self) {
        self.regions.push(Vec::new());
    }

    fn exit(&mut self) {
        self.regions.pop();
    }

    fn declare(&mut self, name: String, namespace: BlockerNamespace, guard: CfgExpr) {
        self.regions
            .last_mut()
            .expect("lexical region")
            .push(GuardedBlocker {
                name,
                namespace,
                guard,
            });
    }

    fn visible_blocker_guard(&self, name: &str, namespace: BlockerNamespace) -> CfgExpr {
        CfgExpr::any(self.regions.iter().rev().flat_map(|region| {
            region
                .iter()
                .filter(|blocker| blocker.name == name && blocker.namespace == namespace)
                .map(|blocker| blocker.guard.clone())
        }))
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct BodyFacts {
    pub(crate) direct_function_calls: BTreeSet<String>,
    pub(crate) receiver_methods: BTreeSet<String>,
}

pub(crate) struct FunctionDefinitionView<'a> {
    pub(crate) target: &'a str,
    pub(crate) path: &'a [String],
    pub(crate) location: &'a str,
}

pub(crate) struct ResolvedUsageView<'a> {
    pub(crate) callee_target: &'a str,
    pub(crate) callee_path: &'a [String],
    pub(crate) caller_target: &'a str,
    pub(crate) caller_path: &'a [String],
}

pub(crate) struct CallableIndex {
    callables: BTreeMap<CallableId, CallableFact>,
    functions: BTreeMap<FunctionKey, Vec<FunctionDefinition>>,
    imports: BTreeMap<ModuleKey, BTreeMap<String, Vec<ImportLeaf>>>,
    usages: Vec<UsageFact>,
    resolved: Vec<(FunctionKey, CallableId)>,
    body_facts: BTreeMap<ItemId, BodyFacts>,
}

impl CallableIndex {
    pub(crate) fn build(
        graph: &LogicalInclusionGraph,
        repository: &PhysicalSourceRepository,
        projected: &ProjectedItemIndex,
        guarded_uses: &GuardedUseIndex,
        cfg: &mut CfgModel,
    ) -> Result<Self, FatalError> {
        let lib_targets = graph
            .occurrences()
            .iter()
            .filter(|occurrence| occurrence.target().target_kind == TargetKind::Lib)
            .map(|occurrence| {
                (
                    (
                        occurrence.target().package_name.clone(),
                        occurrence.target().target_name.clone(),
                    ),
                    occurrence.target().label(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let mut index = Self {
            callables: BTreeMap::new(),
            functions: BTreeMap::new(),
            imports: BTreeMap::new(),
            usages: Vec::new(),
            resolved: Vec::new(),
            body_facts: BTreeMap::new(),
        };
        for occurrence in graph.occurrences() {
            let items = body_items(repository, occurrence.body());
            let projections = projected.module(occurrence.id());
            for projected_item in projections.items() {
                let item = &items[projected_item.ordinal()];
                index.project_item(
                    occurrence.id(),
                    occurrence.target(),
                    occurrence.module_path(),
                    repository.get(occurrence.source_id()).path(),
                    item,
                    projected_item,
                )?;
            }
        }
        index.project_imports(graph, guarded_uses, &lib_targets);
        index.project_test_bodies(graph, repository, projected, cfg)?;
        index.resolve_usages(cfg)?;
        Ok(index)
    }

    pub(crate) fn definitions(&self) -> impl Iterator<Item = FunctionDefinitionView<'_>> {
        self.functions.iter().flat_map(|(key, definitions)| {
            definitions.iter().map(|definition| FunctionDefinitionView {
                target: &key.target,
                path: &key.path,
                location: &definition.location,
            })
        })
    }

    pub(crate) fn resolved_usages(&self) -> impl Iterator<Item = ResolvedUsageView<'_>> {
        self.resolved.iter().map(|(callee, caller)| {
            let caller = self
                .callables
                .get(caller)
                .expect("resolved usage caller must exist");
            ResolvedUsageView {
                callee_target: &callee.target,
                callee_path: &callee.path,
                caller_target: &caller.target,
                caller_path: &caller.path,
            }
        })
    }

    pub(crate) fn body_facts(&self, item: &ItemId) -> Option<&BodyFacts> {
        self.body_facts.get(item)
    }

    fn project_test_bodies(
        &mut self,
        graph: &LogicalInclusionGraph,
        repository: &PhysicalSourceRepository,
        projected: &ProjectedItemIndex,
        cfg: &mut CfgModel,
    ) -> Result<(), FatalError> {
        for occurrence in graph.occurrences() {
            let items = body_items(repository, occurrence.body());
            let projections = projected.module(occurrence.id());
            let path = repository.get(occurrence.source_id()).path();
            for item in projections
                .items()
                .iter()
                .filter(|item| item.test_possible())
            {
                let syn::Item::Fn(function) = &items[item.ordinal()] else {
                    continue;
                };
                let carrier_activation = CfgExpr::any(
                    item.attributes()
                        .test_carriers()
                        .into_iter()
                        .map(|carrier| carrier.guard),
                );
                let facts = source_visible_body_facts(
                    &[&function.sig.generics],
                    &function.sig.inputs,
                    &function.block,
                    path,
                    CfgExpr::all([item.effective_guard().clone(), carrier_activation]),
                    Universe::Test,
                    cfg,
                )?;
                if self.body_facts.insert(item.id().clone(), facts).is_some() {
                    return Err(FatalError::new(
                        super::error::FatalPhase::Model,
                        "body-fact-identity-collision",
                        "projected test body fact identity is not unique",
                    ));
                }
            }
        }
        Ok(())
    }

    fn project_item(
        &mut self,
        occurrence: OccurrenceId,
        target: &TargetSubject,
        module_path: &[String],
        source_path: &Path,
        item: &syn::Item,
        projected: &super::projected_items::ProjectedItem,
    ) -> Result<(), FatalError> {
        if !target.target_kind.production_enabled() {
            return Ok(());
        }
        match item {
            syn::Item::Fn(function) if projected.production_possible() => {
                let mut path = module_path.to_vec();
                path.push(function.sig.ident.to_string());
                let callable = CallableFact::new(
                    occurrence,
                    projected.id(),
                    target,
                    module_path,
                    path.clone(),
                    None,
                    projected.production_guard().clone(),
                );
                let key = FunctionKey {
                    target: callable.target.clone(),
                    path,
                };
                self.functions
                    .entry(key)
                    .or_default()
                    .push(FunctionDefinition {
                        callable: callable.id.clone(),
                        location: format!(
                            "{}:{}:{}",
                            function.sig.ident,
                            function.sig.ident.span().start().line,
                            function.sig.ident.span().start().column + 1,
                        ),
                    });
                self.collect_body(
                    &callable,
                    &[&function.sig.generics],
                    &function.sig.inputs,
                    &function.block,
                    source_path,
                )?;
                self.insert_callable(callable)?;
            }
            syn::Item::Impl(item) if projected.production_possible() => {
                let Some(self_type) = type_path(&item.self_ty) else {
                    return Ok(());
                };
                for member in projected.members() {
                    if !member.production_possible() {
                        continue;
                    }
                    let syn::ImplItem::Fn(function) = &item.items[member.ordinal()] else {
                        continue;
                    };
                    let mut path = module_path.to_vec();
                    path.extend(self_type.iter().cloned());
                    path.push(function.sig.ident.to_string());
                    let callable = CallableFact::new(
                        occurrence,
                        member.id(),
                        target,
                        module_path,
                        path,
                        Some(self_type.clone()),
                        member.effective_guard().clone(),
                    );
                    self.collect_body(
                        &callable,
                        &[&item.generics, &function.sig.generics],
                        &function.sig.inputs,
                        &function.block,
                        source_path,
                    )?;
                    self.insert_callable(callable)?;
                }
            }
            syn::Item::Trait(item) if projected.production_possible() => {
                let mut self_type = module_path.to_vec();
                self_type.push(item.ident.to_string());
                for member in projected.members() {
                    if !member.production_possible() {
                        continue;
                    }
                    let syn::TraitItem::Fn(function) = &item.items[member.ordinal()] else {
                        continue;
                    };
                    let Some(block) = &function.default else {
                        continue;
                    };
                    let mut path = self_type.clone();
                    path.push(function.sig.ident.to_string());
                    let callable = CallableFact::new(
                        occurrence,
                        member.id(),
                        target,
                        module_path,
                        path,
                        Some(self_type.clone()),
                        member.effective_guard().clone(),
                    );
                    self.collect_body(
                        &callable,
                        &[&item.generics, &function.sig.generics],
                        &function.sig.inputs,
                        block,
                        source_path,
                    )?;
                    self.insert_callable(callable)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn insert_callable(&mut self, callable: CallableFact) -> Result<(), FatalError> {
        if self
            .callables
            .insert(callable.id.clone(), callable)
            .is_some()
        {
            return Err(FatalError::new(
                super::error::FatalPhase::Model,
                "callable-identity-collision",
                "projected callable identity is not unique",
            ));
        }
        Ok(())
    }

    fn collect_body(
        &mut self,
        callable: &CallableFact,
        generics: &[&syn::Generics],
        inputs: &Punctuated<syn::FnArg, Token![,]>,
        block: &syn::Block,
        path: &Path,
    ) -> Result<(), FatalError> {
        let mut visitor = UsageVisitor::new(callable.id.clone(), path);
        visitor.bind_generics(generics);
        visitor.bind_inputs(inputs);
        visitor.visit_block(block);
        self.usages
            .extend(visitor.usages.into_iter().map(|usage| UsageFact {
                caller: usage.caller,
                kind: usage.kind,
                source_path: usage.source_path,
                guard: CfgExpr::all([callable.guard.clone(), usage.guard]),
            }));
        visitor.error.map_or(Ok(()), Err)
    }

    fn project_imports(
        &mut self,
        graph: &LogicalInclusionGraph,
        guarded_uses: &GuardedUseIndex,
        lib_targets: &BTreeMap<(String, String), String>,
    ) {
        for occurrence in graph.occurrences() {
            if !occurrence.target().target_kind.production_enabled() {
                continue;
            }
            for leaf in guarded_uses.module(occurrence.id()) {
                let context = ImportContext {
                    target: occurrence.target(),
                    module_path: occurrence.module_path(),
                    lib_targets,
                };
                let Some((resolved_target, resolved_path)) = context.resolve(&leaf.source_path)
                else {
                    continue;
                };
                let key = FunctionKey {
                    target: resolved_target.clone(),
                    path: resolved_path.clone(),
                };
                let import_target = if self.functions.contains_key(&key) {
                    Some(ImportTarget::Function(key))
                } else if self.is_known_module(&resolved_target, &resolved_path) {
                    Some(ImportTarget::Module {
                        target: resolved_target,
                        path: resolved_path,
                    })
                } else {
                    None
                };
                if let Some(target) = import_target {
                    self.imports
                        .entry(ModuleKey {
                            target: occurrence.target().label(),
                            path: occurrence.module_path().to_vec(),
                        })
                        .or_default()
                        .entry(leaf.local_name.clone())
                        .or_default()
                        .push(ImportLeaf {
                            target,
                            guard: leaf.guard.clone(),
                        });
                }
            }
        }
    }

    fn resolve_usages(&mut self, cfg: &mut CfgModel) -> Result<(), FatalError> {
        let usages = std::mem::take(&mut self.usages);
        let mut resolved = BTreeSet::new();
        for usage in usages {
            match usage.kind {
                UsageKind::Call | UsageKind::ValueReference => {}
            }
            let caller = self
                .callables
                .get(&usage.caller)
                .expect("projected usage caller must exist");
            for (callee, import_guard) in self.resolve_path(caller, &usage.source_path) {
                let Some(definitions) = self.functions.get(&callee) else {
                    continue;
                };
                for definition in definitions {
                    let callee_guard = &self
                        .callables
                        .get(&definition.callable)
                        .expect("function definition callable must exist")
                        .guard;
                    let guard = CfgExpr::all([
                        usage.guard.clone(),
                        import_guard.clone(),
                        callee_guard.clone(),
                    ]);
                    if cfg.possible(&guard, Universe::Production)? {
                        resolved.insert((callee.clone(), usage.caller.clone()));
                    }
                }
            }
        }
        self.resolved = resolved.into_iter().collect();
        Ok(())
    }

    fn resolve_path(&self, caller: &CallableFact, path: &[String]) -> Vec<(FunctionKey, CfgExpr)> {
        if path.is_empty() {
            return Vec::new();
        }
        if path[0] == "Self" {
            let Some(self_type) = &caller.self_type else {
                return Vec::new();
            };
            let mut resolved = self_type.clone();
            resolved.extend(path[1..].iter().cloned());
            return vec![(
                FunctionKey {
                    target: caller.target.clone(),
                    path: resolved,
                },
                CfgExpr::True,
            )];
        }
        if let Some(lib_crate_name) = &caller.lib_crate_name
            && path.first() == Some(lib_crate_name)
        {
            let key = (caller.package_name.clone(), lib_crate_name.clone());
            if let Some(target) = self.lib_target(&key) {
                return vec![(
                    FunctionKey {
                        target,
                        path: path[1..].to_vec(),
                    },
                    CfgExpr::True,
                )];
            }
        }
        let module = ModuleKey {
            target: caller.target.clone(),
            path: caller.module_path.clone(),
        };
        if let Some(leaves) = self
            .imports
            .get(&module)
            .and_then(|imports| imports.get(&path[0]))
        {
            let imported = leaves
                .iter()
                .filter_map(|leaf| match &leaf.target {
                    ImportTarget::Function(function) if path.len() == 1 => {
                        Some((function.clone(), leaf.guard.clone()))
                    }
                    ImportTarget::Module {
                        target,
                        path: module,
                    } => {
                        let mut resolved = module.clone();
                        resolved.extend(path[1..].iter().cloned());
                        Some((
                            FunctionKey {
                                target: target.clone(),
                                path: resolved,
                            },
                            leaf.guard.clone(),
                        ))
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            if !imported.is_empty() {
                return imported;
            }
        }
        let Some(path) = resolve_local_path(&caller.module_path, path) else {
            return Vec::new();
        };
        vec![(
            FunctionKey {
                target: caller.target.clone(),
                path,
            },
            CfgExpr::True,
        )]
    }

    fn is_known_module(&self, target: &str, path: &[String]) -> bool {
        self.functions.keys().any(|function| {
            function.target == target
                && function.path.len() > path.len()
                && function.path.starts_with(path)
        })
    }

    fn lib_target(&self, key: &(String, String)) -> Option<String> {
        self.callables.values().find_map(|callable| {
            (callable.package_name == key.0
                && callable.lib_crate_name.as_ref() == Some(&key.1)
                && callable.target.contains(":lib:"))
            .then(|| callable.target.clone())
        })
    }
}

impl CallableFact {
    #[allow(clippy::too_many_arguments)]
    fn new(
        _occurrence: OccurrenceId,
        item: &ItemId,
        target: &TargetSubject,
        module_path: &[String],
        path: Vec<String>,
        self_type: Option<Vec<String>>,
        guard: CfgExpr,
    ) -> Self {
        Self {
            id: CallableId(format!("callable:{}", item.as_str())),
            target: target.label(),
            path,
            module_path: module_path.to_vec(),
            package_name: target.package_name.clone(),
            lib_crate_name: target.lib_crate_name.clone(),
            self_type,
            guard,
        }
    }
}

struct UsageVisitor {
    caller: CallableId,
    usages: Vec<UsageFact>,
    receiver_methods: Vec<(String, CfgExpr)>,
    guard: CfgExpr,
    path: std::path::PathBuf,
    cfg: CfgModel,
    scopes: LexicalScopes,
    error: Option<FatalError>,
}

impl UsageVisitor {
    fn new(caller: CallableId, path: &Path) -> Self {
        Self {
            caller,
            usages: Vec::new(),
            receiver_methods: Vec::new(),
            guard: CfgExpr::True,
            path: path.to_path_buf(),
            cfg: CfgModel::syntax_projector(),
            scopes: LexicalScopes::new(),
            error: None,
        }
    }

    fn bind_inputs(&mut self, inputs: &Punctuated<syn::FnArg, Token![,]>) {
        for input in inputs {
            match input {
                syn::FnArg::Receiver(_) => {
                    let attributes = match input {
                        syn::FnArg::Receiver(receiver) => receiver.attrs.as_slice(),
                        syn::FnArg::Typed(_) => unreachable!(),
                    };
                    self.visit_with_attributes(attributes, |visitor| {
                        visitor.scopes.declare(
                            "self".to_owned(),
                            BlockerNamespace::BareValue,
                            visitor.guard.clone(),
                        );
                    });
                }
                syn::FnArg::Typed(input) => {
                    self.visit_with_attributes(&input.attrs, |visitor| {
                        visitor.bind_pattern(&input.pat)
                    });
                }
            }
        }
    }

    fn bind_generics(&mut self, groups: &[&syn::Generics]) {
        for generics in groups {
            for parameter in &generics.params {
                match parameter {
                    syn::GenericParam::Type(parameter) => self.scopes.declare(
                        parameter.ident.to_string(),
                        BlockerNamespace::PathHead,
                        self.guard.clone(),
                    ),
                    syn::GenericParam::Const(parameter) => self.scopes.declare(
                        parameter.ident.to_string(),
                        BlockerNamespace::BareValue,
                        self.guard.clone(),
                    ),
                    syn::GenericParam::Lifetime(_) => {}
                }
            }
        }
    }

    fn bind_pattern(&mut self, pattern: &syn::Pat) {
        for (name, guard) in self.guarded_pattern_names(pattern) {
            self.scopes
                .declare(name, BlockerNamespace::BareValue, guard);
        }
    }

    fn guarded_pattern_names(&mut self, pattern: &syn::Pat) -> Vec<(String, CfgExpr)> {
        let mut collector =
            GuardedBindingCollector::new(&mut self.cfg, &self.path, self.guard.clone());
        collector.visit_pat(pattern);
        if let Some(error) = collector.error {
            self.error = Some(error);
            Vec::new()
        } else {
            collector.names
        }
    }

    fn emit(&mut self, kind: UsageKind, path: &syn::Path) {
        if path.leading_colon.is_some() || path.segments.is_empty() {
            return;
        }
        let namespace = if path.segments.len() == 1 {
            BlockerNamespace::BareValue
        } else {
            BlockerNamespace::PathHead
        };
        let blocker = self
            .scopes
            .visible_blocker_guard(&path.segments[0].ident.to_string(), namespace);
        self.usages.push(UsageFact {
            caller: self.caller.clone(),
            kind,
            source_path: path
                .segments
                .iter()
                .map(|segment| segment.ident.to_string())
                .collect(),
            guard: CfgExpr::all([self.guard.clone(), CfgExpr::not(blocker)]),
        });
    }

    fn visit_with_attributes(
        &mut self,
        attributes: &[syn::Attribute],
        visit: impl FnOnce(&mut Self),
    ) {
        if self.error.is_some() {
            return;
        }
        let projection = match self.cfg.attributes(attributes, &self.path) {
            Ok(projection) => projection,
            Err(error) => {
                self.error = Some(error);
                return;
            }
        };
        let combined = CfgExpr::all([self.guard.clone(), projection.item_guard]);
        let previous = std::mem::replace(&mut self.guard, combined);
        visit(self);
        self.guard = previous;
    }

    fn visit_condition(&mut self, expression: &syn::Expr) -> Vec<(String, CfgExpr)> {
        let mut bindings = Vec::new();
        self.visit_condition_part(expression, &mut bindings);
        bindings
    }

    fn visit_condition_part(
        &mut self,
        expression: &syn::Expr,
        bindings: &mut Vec<(String, CfgExpr)>,
    ) {
        if let syn::Expr::Binary(binary) = expression
            && matches!(binary.op, syn::BinOp::And(_))
        {
            self.visit_condition_part(&binary.left, bindings);
            self.scopes.enter();
            self.declare_guarded_names(bindings.clone());
            self.visit_condition_part(&binary.right, bindings);
            self.scopes.exit();
            return;
        }
        if let syn::Expr::Let(value) = expression {
            self.visit_with_attributes(&value.attrs, |visitor| {
                visitor.visit_expr(&value.expr);
                bindings.extend(visitor.guarded_pattern_names(&value.pat));
            });
        } else {
            self.visit_expr(expression);
        }
    }

    fn declare_guarded_names(&mut self, names: Vec<(String, CfgExpr)>) {
        for (name, guard) in names {
            self.scopes
                .declare(name, BlockerNamespace::BareValue, guard);
        }
    }

    fn predeclare_item(&mut self, item: &syn::Item) {
        let (name, bare_value, path_head, attributes) = match item {
            syn::Item::Fn(item) => (Some(item.sig.ident.to_string()), true, false, &item.attrs),
            syn::Item::Const(item) => (Some(item.ident.to_string()), true, false, &item.attrs),
            syn::Item::Static(item) => (Some(item.ident.to_string()), true, false, &item.attrs),
            syn::Item::Mod(item) => (Some(item.ident.to_string()), false, true, &item.attrs),
            syn::Item::Trait(item) => (Some(item.ident.to_string()), false, true, &item.attrs),
            syn::Item::Enum(item) => (Some(item.ident.to_string()), false, true, &item.attrs),
            syn::Item::Union(item) => (Some(item.ident.to_string()), false, true, &item.attrs),
            syn::Item::Type(item) => (Some(item.ident.to_string()), false, true, &item.attrs),
            syn::Item::Struct(item) => (
                Some(item.ident.to_string()),
                matches!(item.fields, syn::Fields::Unit | syn::Fields::Unnamed(_)),
                true,
                &item.attrs,
            ),
            syn::Item::Use(item) => {
                self.visit_with_attributes(&item.attrs, |visitor| {
                    let mut names = Vec::new();
                    flatten_local_use_names(Vec::new(), &item.tree, &mut names);
                    for name in names {
                        visitor.scopes.declare(
                            name.clone(),
                            BlockerNamespace::BareValue,
                            visitor.guard.clone(),
                        );
                        visitor.scopes.declare(
                            name,
                            BlockerNamespace::PathHead,
                            visitor.guard.clone(),
                        );
                    }
                });
                return;
            }
            _ => return,
        };
        self.visit_with_attributes(attributes, |visitor| {
            let name = name.expect("predeclared item name");
            if bare_value {
                visitor.scopes.declare(
                    name.clone(),
                    BlockerNamespace::BareValue,
                    visitor.guard.clone(),
                );
            }
            if path_head {
                visitor
                    .scopes
                    .declare(name, BlockerNamespace::PathHead, visitor.guard.clone());
            }
        });
    }
}

impl Visit<'_> for UsageVisitor {
    fn visit_block(&mut self, node: &syn::Block) {
        self.scopes.enter();
        for statement in &node.stmts {
            if let syn::Stmt::Item(item) = statement {
                self.predeclare_item(item);
            }
        }
        for statement in &node.stmts {
            self.visit_stmt(statement);
        }
        self.scopes.exit();
    }

    fn visit_expr(&mut self, node: &syn::Expr) {
        self.visit_with_attributes(expression_attrs(node), |visitor| {
            visit::visit_expr(visitor, node)
        });
    }

    fn visit_expr_call(&mut self, node: &syn::ExprCall) {
        if let syn::Expr::Path(path) = node.func.as_ref() {
            self.emit(UsageKind::Call, &path.path);
        } else {
            self.visit_expr(&node.func);
        }
        for argument in &node.args {
            self.visit_expr(argument);
        }
    }

    fn visit_expr_path(&mut self, node: &syn::ExprPath) {
        self.emit(UsageKind::ValueReference, &node.path);
        visit::visit_expr_path(self, node);
    }

    fn visit_expr_method_call(&mut self, node: &syn::ExprMethodCall) {
        self.receiver_methods
            .push((node.method.to_string(), self.guard.clone()));
        visit::visit_expr_method_call(self, node);
    }

    fn visit_expr_closure(&mut self, node: &syn::ExprClosure) {
        self.scopes.enter();
        for input in &node.inputs {
            self.bind_pattern(input);
        }
        self.visit_expr(&node.body);
        self.scopes.exit();
    }

    fn visit_expr_if(&mut self, node: &syn::ExprIf) {
        let bindings = self.visit_condition(&node.cond);
        self.scopes.enter();
        self.declare_guarded_names(bindings);
        self.visit_block(&node.then_branch);
        self.scopes.exit();
        if let Some((_, branch)) = &node.else_branch {
            self.visit_expr(branch);
        }
    }

    fn visit_expr_while(&mut self, node: &syn::ExprWhile) {
        let bindings = self.visit_condition(&node.cond);
        self.scopes.enter();
        self.declare_guarded_names(bindings);
        self.visit_block(&node.body);
        self.scopes.exit();
    }

    fn visit_expr_match(&mut self, node: &syn::ExprMatch) {
        self.visit_expr(&node.expr);
        for arm in &node.arms {
            self.visit_with_attributes(&arm.attrs, |visitor| {
                visitor.scopes.enter();
                let pattern = match &arm.pat {
                    syn::Pat::Guard(guarded) => guarded.pat.as_ref(),
                    pattern => pattern,
                };
                visitor.bind_pattern(pattern);
                if let syn::Pat::Guard(guarded) = &arm.pat {
                    let bindings = visitor.visit_condition(&guarded.guard);
                    visitor.declare_guarded_names(bindings);
                }
                visitor.visit_expr(&arm.body);
                visitor.scopes.exit();
            });
        }
    }

    fn visit_expr_for_loop(&mut self, node: &syn::ExprForLoop) {
        self.visit_expr(&node.expr);
        self.scopes.enter();
        self.bind_pattern(&node.pat);
        self.visit_block(&node.body);
        self.scopes.exit();
    }

    fn visit_macro(&mut self, node: &syn::Macro) {
        if !is_source_visible_oracle_macro(&node.path) {
            return;
        }
        let parser = Punctuated::<Expr, Token![,]>::parse_terminated;
        let Ok(arguments) = parser.parse2(node.tokens.clone()) else {
            return;
        };
        for argument in &arguments {
            self.visit_expr(argument);
        }
    }

    fn visit_stmt(&mut self, node: &syn::Stmt) {
        match node {
            syn::Stmt::Local(local) => self.visit_with_attributes(&local.attrs, |visitor| {
                if let Some(initializer) = &local.init {
                    visitor.visit_expr(&initializer.expr);
                    if let Some((_, diverge)) = &initializer.diverge {
                        visitor.visit_expr(diverge);
                    }
                }
                visitor.bind_pattern(&local.pat);
            }),
            syn::Stmt::Expr(expression, _) => self.visit_expr(expression),
            syn::Stmt::Item(_) => {}
            syn::Stmt::Macro(statement) => {
                self.visit_with_attributes(&statement.attrs, |visitor| {
                    visit::visit_stmt_macro(visitor, statement)
                });
            }
        }
    }

    fn visit_item_fn(&mut self, _node: &syn::ItemFn) {}
}

struct GuardedBindingCollector<'a> {
    cfg: &'a mut CfgModel,
    path: &'a Path,
    guard: CfgExpr,
    names: Vec<(String, CfgExpr)>,
    error: Option<FatalError>,
}

#[doc = "ousia: ownerless-fn block-local use blocker projection"]
fn flatten_local_use_names(prefix: Vec<String>, tree: &syn::UseTree, names: &mut Vec<String>) {
    match tree {
        syn::UseTree::Path(path) => {
            let mut prefix = prefix;
            prefix.push(path.ident.to_string());
            flatten_local_use_names(prefix, &path.tree, names);
        }
        syn::UseTree::Name(name) if name.ident == "self" => {
            if let Some(local) = prefix.last() {
                names.push(local.clone());
            }
        }
        syn::UseTree::Name(name) => names.push(name.ident.to_string()),
        syn::UseTree::Rename(rename) => names.push(rename.rename.to_string()),
        syn::UseTree::Group(group) => {
            for tree in &group.items {
                flatten_local_use_names(prefix.clone(), tree, names);
            }
        }
        syn::UseTree::Glob(_) => {}
    }
}

impl<'a> GuardedBindingCollector<'a> {
    fn new(cfg: &'a mut CfgModel, path: &'a Path, guard: CfgExpr) -> Self {
        Self {
            cfg,
            path,
            guard,
            names: Vec::new(),
            error: None,
        }
    }

    fn visit_guarded(&mut self, attributes: &[syn::Attribute], visit: impl FnOnce(&mut Self)) {
        if self.error.is_some() {
            return;
        }
        let projection = match self.cfg.attributes(attributes, self.path) {
            Ok(projection) => projection,
            Err(error) => {
                self.error = Some(error);
                return;
            }
        };
        let combined = CfgExpr::all([self.guard.clone(), projection.item_guard]);
        let previous = std::mem::replace(&mut self.guard, combined);
        visit(self);
        self.guard = previous;
    }
}

impl Visit<'_> for GuardedBindingCollector<'_> {
    fn visit_pat(&mut self, node: &syn::Pat) {
        self.visit_guarded(pattern_attrs(node), |collector| {
            visit::visit_pat(collector, node)
        });
    }

    fn visit_pat_ident(&mut self, node: &syn::PatIdent) {
        self.names
            .push((node.ident.to_string(), self.guard.clone()));
        visit::visit_pat_ident(self, node);
    }

    fn visit_field_pat(&mut self, node: &syn::FieldPat) {
        self.visit_guarded(&node.attrs, |collector| collector.visit_pat(&node.pat));
    }
}

#[doc = "ousia: ownerless-fn source-visible oracle macro classification"]
fn is_source_visible_oracle_macro(path: &syn::Path) -> bool {
    path.segments.last().is_some_and(|segment| {
        matches!(
            segment.ident.to_string().as_str(),
            "assert"
                | "assert_eq"
                | "assert_ne"
                | "debug_assert"
                | "debug_assert_eq"
                | "debug_assert_ne"
                | "matches"
                | "panic"
                | "todo"
                | "unimplemented"
                | "unreachable"
        )
    })
}

#[doc = "ousia: ownerless-fn shared source-visible callable body fact projection"]
pub(crate) fn source_visible_body_facts(
    generics: &[&syn::Generics],
    inputs: &Punctuated<syn::FnArg, Token![,]>,
    block: &syn::Block,
    path: &Path,
    seed: CfgExpr,
    universe: Universe,
    cfg: &mut CfgModel,
) -> Result<BodyFacts, FatalError> {
    let mut visitor = UsageVisitor::new(CallableId("source-visible".to_owned()), path);
    visitor.bind_generics(generics);
    visitor.bind_inputs(inputs);
    visitor.visit_block(block);
    if let Some(error) = visitor.error {
        return Err(error);
    }
    let mut direct_function_calls = BTreeSet::new();
    for usage in visitor.usages {
        if usage.kind == UsageKind::Call
            && cfg.possible(&CfgExpr::all([seed.clone(), usage.guard]), universe)?
        {
            direct_function_calls.insert(usage.source_path.join("::"));
        }
    }
    let mut receiver_methods = BTreeSet::new();
    for (method, guard) in visitor.receiver_methods {
        if cfg.possible(&CfgExpr::all([seed.clone(), guard]), universe)? {
            receiver_methods.insert(method);
        }
    }
    Ok(BodyFacts {
        direct_function_calls,
        receiver_methods,
    })
}

#[doc = "ousia: ownerless-fn expression attribute syntax adapter"]
fn expression_attrs(expression: &syn::Expr) -> &[syn::Attribute] {
    match expression {
        syn::Expr::Array(value) => &value.attrs,
        syn::Expr::Assign(value) => &value.attrs,
        syn::Expr::Async(value) => &value.attrs,
        syn::Expr::Await(value) => &value.attrs,
        syn::Expr::Binary(value) => &value.attrs,
        syn::Expr::Block(value) => &value.attrs,
        syn::Expr::Break(value) => &value.attrs,
        syn::Expr::Call(value) => &value.attrs,
        syn::Expr::Cast(value) => &value.attrs,
        syn::Expr::Closure(value) => &value.attrs,
        syn::Expr::Const(value) => &value.attrs,
        syn::Expr::Continue(value) => &value.attrs,
        syn::Expr::Field(value) => &value.attrs,
        syn::Expr::ForLoop(value) => &value.attrs,
        syn::Expr::Group(value) => &value.attrs,
        syn::Expr::If(value) => &value.attrs,
        syn::Expr::Index(value) => &value.attrs,
        syn::Expr::Infer(value) => &value.attrs,
        syn::Expr::Let(value) => &value.attrs,
        syn::Expr::Lit(value) => &value.attrs,
        syn::Expr::Loop(value) => &value.attrs,
        syn::Expr::Macro(value) => &value.attrs,
        syn::Expr::Match(value) => &value.attrs,
        syn::Expr::MethodCall(value) => &value.attrs,
        syn::Expr::Paren(value) => &value.attrs,
        syn::Expr::Path(value) => &value.attrs,
        syn::Expr::Range(value) => &value.attrs,
        syn::Expr::RawAddr(value) => &value.attrs,
        syn::Expr::Reference(value) => &value.attrs,
        syn::Expr::Repeat(value) => &value.attrs,
        syn::Expr::Return(value) => &value.attrs,
        syn::Expr::Struct(value) => &value.attrs,
        syn::Expr::Try(value) => &value.attrs,
        syn::Expr::TryBlock(value) => &value.attrs,
        syn::Expr::Tuple(value) => &value.attrs,
        syn::Expr::Unary(value) => &value.attrs,
        syn::Expr::Unsafe(value) => &value.attrs,
        syn::Expr::Verbatim(_) => &[],
        syn::Expr::While(value) => &value.attrs,
        syn::Expr::Yield(value) => &value.attrs,
        _ => &[],
    }
}

#[doc = "ousia: ownerless-fn pattern attribute syntax adapter"]
fn pattern_attrs(pattern: &syn::Pat) -> &[syn::Attribute] {
    match pattern {
        syn::Pat::Const(value) => &value.attrs,
        syn::Pat::Guard(value) => &value.attrs,
        syn::Pat::Ident(value) => &value.attrs,
        syn::Pat::Lit(value) => &value.attrs,
        syn::Pat::Macro(value) => &value.attrs,
        syn::Pat::Or(value) => &value.attrs,
        syn::Pat::Paren(value) => &value.attrs,
        syn::Pat::Path(value) => &value.attrs,
        syn::Pat::Range(value) => &value.attrs,
        syn::Pat::Reference(value) => &value.attrs,
        syn::Pat::Rest(value) => &value.attrs,
        syn::Pat::Slice(value) => &value.attrs,
        syn::Pat::Struct(value) => &value.attrs,
        syn::Pat::Tuple(value) => &value.attrs,
        syn::Pat::TupleStruct(value) => &value.attrs,
        syn::Pat::Type(value) => &value.attrs,
        syn::Pat::Wild(value) => &value.attrs,
        syn::Pat::Verbatim(_) => &[],
        _ => &[],
    }
}

struct ImportContext<'a> {
    target: &'a TargetSubject,
    module_path: &'a [String],
    lib_targets: &'a BTreeMap<(String, String), String>,
}

impl ImportContext<'_> {
    fn resolve(&self, path: &[String]) -> Option<(String, Vec<String>)> {
        if let Some(lib_crate_name) = &self.target.lib_crate_name
            && path.first() == Some(lib_crate_name)
        {
            let key = (self.target.package_name.clone(), lib_crate_name.clone());
            return self
                .lib_targets
                .get(&key)
                .cloned()
                .map(|target| (target, path[1..].to_vec()));
        }
        resolve_local_path(self.module_path, path).map(|path| (self.target.label(), path))
    }
}

#[doc = "ousia: ownerless-fn source-visible impl self type path projection"]
fn type_path(ty: &syn::Type) -> Option<Vec<String>> {
    let syn::Type::Path(path) = ty else {
        return None;
    };
    if path.qself.is_some() {
        return None;
    }
    Some(
        path.path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Goal: preserve source-visible calls nested in assertion macro arguments.
    /// Scope: level=unit; boundary=analysis::callables::source_visible_body_facts
    /// Semantics: assertion operands contribute direct calls while arbitrary macro tokens remain opaque.
    #[test]
    fn body_facts_collect_assertion_operand_calls_without_expanding_macros() {
        let block: syn::Block = syn::parse_quote!({
            assert_eq!(validator::validate(input), Err(expected));
            opaque!(hidden::call());
        });

        let mut cfg = CfgModel::new(super::super::cfg::CfgEnvironment::fixture(&[]));
        let facts = source_visible_body_facts(
            &[],
            &Punctuated::new(),
            &block,
            Path::new("src/lib.rs"),
            CfgExpr::True,
            Universe::Test,
            &mut cfg,
        )
        .expect("collect source-visible body facts");

        assert_eq!(
            facts.direct_function_calls,
            BTreeSet::from(["Err".to_owned(), "validator::validate".to_owned()])
        );
    }
}
