pub(crate) mod callables;
pub(crate) mod cfg;
pub mod error;
pub(crate) mod guarded_uses;
pub(crate) mod module_graph;
pub(crate) mod projected_items;
pub(crate) mod source_repository;
pub(crate) mod subject;
pub(crate) mod type_facts;

use std::path::{Path, PathBuf};

use cfg::{CfgEnvironment, CfgExpr, CfgModel};
pub use error::FatalError;
use module_graph::{
    BodyLocator, InclusionKind, LogicalInclusionGraph, ModuleOccurrence, OccurrenceId, body_items,
};
use projected_items::{ProjectedItem, ProjectedItemIndex, ProjectedMember};
use source_repository::PhysicalSourceRepository;
use subject::{TargetKind, TargetSubject};

pub(crate) struct AnalysisSession {
    repository: PhysicalSourceRepository,
    graph: LogicalInclusionGraph,
    cfg: CfgModel,
    projected_items: ProjectedItemIndex,
    callables: callables::CallableIndex,
    type_facts: type_facts::TypeFactIndex,
}

pub(crate) struct ModuleView<'a> {
    occurrence: &'a ModuleOccurrence,
    repository: &'a PhysicalSourceRepository,
}

pub(crate) struct ProductionModuleView<'a> {
    module: ModuleView<'a>,
    projected: &'a projected_items::ProjectedModule,
}

pub(crate) struct ProductionItemView<'a> {
    item: &'a syn::Item,
    projected: &'a ProjectedItem,
}

pub(crate) struct ProjectedFunctionView<'a> {
    pub(crate) item_id: &'a projected_items::ItemId,
    pub(crate) occurrence: ModuleView<'a>,
    pub(crate) function: &'a syn::ItemFn,
    pub(crate) attributes: &'a cfg::AttributeProjection,
    pub(crate) effective_guard: &'a CfgExpr,
    pub(crate) test_possible: bool,
}

impl AnalysisSession {
    pub(crate) fn build(cargo_inputs: &[PathBuf]) -> Result<Self, FatalError> {
        let targets = subject::resolve_cargo_inputs(cargo_inputs)?;
        let environment = CfgEnvironment::discover()?;
        Self::build_with_environment(targets, environment)
    }

    fn build_with_environment(
        targets: Vec<TargetSubject>,
        environment: CfgEnvironment,
    ) -> Result<Self, FatalError> {
        let mut repository = PhysicalSourceRepository::default();
        let mut cfg = CfgModel::new(environment);
        let graph = LogicalInclusionGraph::build(&targets, &mut repository, &mut cfg)?;
        let projected_items = ProjectedItemIndex::build(&graph, &repository, &mut cfg)?;
        let guarded_uses =
            guarded_uses::GuardedUseIndex::build(&graph, &repository, &projected_items);
        let callables = callables::CallableIndex::build(
            &graph,
            &repository,
            &projected_items,
            &guarded_uses,
            &mut cfg,
        )?;
        let type_facts = type_facts::TypeFactIndex::build(
            &graph,
            &repository,
            &projected_items,
            &guarded_uses,
            &mut cfg,
        )?;
        Ok(Self {
            repository,
            graph,
            cfg,
            projected_items,
            callables,
            type_facts,
        })
    }

    pub(crate) fn cfg_digest(&self) -> &str {
        self.cfg.environment().digest()
    }

    pub(crate) fn cfg_budget(&self) -> cfg::CfgBudgetSnapshot {
        self.cfg.budget()
    }

    pub(crate) fn test_possible(&self, guard: &CfgExpr) -> Result<bool, FatalError> {
        self.cfg.possible(guard, cfg::Universe::Test)
    }

    pub(crate) fn modules(&self) -> impl Iterator<Item = ModuleView<'_>> {
        self.graph
            .occurrences()
            .iter()
            .map(|occurrence| ModuleView {
                occurrence,
                repository: &self.repository,
            })
    }

    pub(crate) fn production_file_modules(&mut self) -> Result<Vec<ModuleView<'_>>, FatalError> {
        Ok(self
            .production_modules()?
            .into_iter()
            .filter(|module| module.module().file().is_some())
            .map(|module| module.module)
            .collect())
    }

    pub(crate) fn production_modules(
        &mut self,
    ) -> Result<Vec<ProductionModuleView<'_>>, FatalError> {
        let mut indexes = Vec::new();
        for (index, occurrence) in self.graph.occurrences().iter().enumerate() {
            if !occurrence.target().target_kind.production_enabled() {
                continue;
            }
            if self
                .cfg
                .possible(occurrence.guard(), cfg::Universe::Production)?
            {
                indexes.push(index);
            }
        }
        Ok(indexes
            .into_iter()
            .map(|index| {
                let occurrence = &self.graph.occurrences()[index];
                ProductionModuleView {
                    module: ModuleView {
                        occurrence,
                        repository: &self.repository,
                    },
                    projected: self.projected_items.module(occurrence.id()),
                }
            })
            .collect())
    }

    pub(crate) fn function_projections(&self) -> Vec<ProjectedFunctionView<'_>> {
        let mut projections = Vec::new();
        for occurrence in self.graph.occurrences() {
            let items = body_items(&self.repository, occurrence.body());
            let projected = self.projected_items.module(occurrence.id());
            for projected_item in projected.items() {
                let item = &items[projected_item.ordinal()];
                let syn::Item::Fn(function) = item else {
                    continue;
                };
                projections.push(ProjectedFunctionView {
                    item_id: projected_item.id(),
                    occurrence: ModuleView {
                        occurrence,
                        repository: &self.repository,
                    },
                    function,
                    attributes: projected_item.attributes(),
                    effective_guard: projected_item.effective_guard(),
                    test_possible: projected_item.test_possible(),
                });
            }
        }
        projections
    }

    pub(crate) fn callables(&self) -> &callables::CallableIndex {
        &self.callables
    }

    pub(crate) fn body_facts(
        &self,
        item: &projected_items::ItemId,
    ) -> Option<&callables::BodyFacts> {
        self.callables.body_facts(item)
    }

    pub(crate) fn zero_field_types(
        &self,
    ) -> impl Iterator<Item = type_facts::ZeroFieldTypeView<'_>> {
        self.type_facts.zero_field_inherent_only()
    }

    pub(crate) fn type_association_warnings(
        &self,
    ) -> impl Iterator<Item = type_facts::TypeAssociationWarning> + '_ {
        self.type_facts.association_warnings()
    }
}

impl<'a> ModuleView<'a> {
    pub(crate) fn occurrence_id(&self) -> OccurrenceId {
        self.occurrence.id()
    }

    pub(crate) fn occurrence_wire_id(&self) -> &str {
        self.occurrence.wire_id()
    }

    pub(crate) fn parent_occurrence_id(&self) -> Option<OccurrenceId> {
        self.occurrence.parent()
    }

    pub(crate) fn target(&self) -> &TargetSubject {
        self.occurrence.target()
    }

    pub(crate) fn root_label(&self) -> String {
        self.target().label()
    }

    pub(crate) fn root_id(&self) -> &str {
        &self.target().root_id
    }

    pub(crate) fn root_locator(&self) -> &str {
        &self.target().root_locator
    }

    pub(crate) fn target_kind(&self) -> TargetKind {
        self.target().target_kind
    }

    pub(crate) fn target_name(&self) -> &str {
        &self.target().target_name
    }

    pub(crate) fn path(&self) -> &Path {
        self.repository.get(self.occurrence.source_id()).path()
    }

    pub(crate) fn items(&self) -> &'a [syn::Item] {
        body_items(self.repository, self.occurrence.body())
    }

    pub(crate) fn attrs(&self) -> &'a [syn::Attribute] {
        match self.occurrence.body() {
            BodyLocator::FullFile(source_id) => &self.repository.get(*source_id).file().attrs,
            BodyLocator::Inline {
                source_id,
                item_path,
            } => {
                let mut items = self.repository.get(*source_id).file().items.as_slice();
                for (depth, ordinal) in item_path.iter().enumerate() {
                    let syn::Item::Mod(module) = &items[*ordinal] else {
                        return &[];
                    };
                    if depth + 1 == item_path.len() {
                        return &module.attrs;
                    }
                    let Some((_, nested)) = &module.content else {
                        return &[];
                    };
                    items = nested;
                }
                &[]
            }
        }
    }

    pub(crate) fn file(&self) -> Option<&'a syn::File> {
        match self.occurrence.body() {
            BodyLocator::FullFile(source_id) => Some(self.repository.get(*source_id).file()),
            BodyLocator::Inline { .. } => None,
        }
    }

    pub(crate) fn module_path(&self) -> &[String] {
        self.occurrence.module_path()
    }

    pub(crate) fn inclusion(&self) -> &InclusionKind {
        self.occurrence.inclusion()
    }

    pub(crate) fn source_relative_path(&self) -> PathBuf {
        self.path()
            .strip_prefix(&self.target().root_path)
            .unwrap_or(self.path())
            .to_path_buf()
    }
}

impl<'a> ProductionModuleView<'a> {
    pub(crate) fn module(&self) -> &ModuleView<'a> {
        &self.module
    }

    pub(crate) fn occurrence_id(&self) -> OccurrenceId {
        self.module.occurrence_id()
    }

    pub(crate) fn parent_occurrence_id(&self) -> Option<OccurrenceId> {
        self.module.parent_occurrence_id()
    }

    pub(crate) fn path(&self) -> &Path {
        self.module.path()
    }

    pub(crate) fn items(&self) -> impl Iterator<Item = ProductionItemView<'_>> {
        self.projected
            .items()
            .iter()
            .filter(|item| item.production_possible())
            .map(|projected| ProductionItemView {
                item: &self.module.items()[projected.ordinal()],
                projected,
            })
    }
}

impl<'a> ProductionItemView<'a> {
    pub(crate) fn syntax(&self) -> &'a syn::Item {
        self.item
    }

    pub(crate) fn attributes(&self) -> &cfg::AttributeProjection {
        self.projected.attributes()
    }

    pub(crate) fn production_members(
        &self,
    ) -> impl Iterator<Item = (&'a syn::ImplItem, &ProjectedMember)> {
        let syn::Item::Impl(item) = self.item else {
            return Vec::new().into_iter();
        };
        self.projected
            .members()
            .iter()
            .filter(|member| member.production_possible())
            .map(|member| (&item.items[member.ordinal()], member))
            .collect::<Vec<_>>()
            .into_iter()
    }

    pub(crate) fn production_trait_members(&self) -> impl Iterator<Item = &'a syn::TraitItem> {
        let syn::Item::Trait(item) = self.item else {
            return Vec::new().into_iter();
        };
        self.projected
            .members()
            .iter()
            .filter(|member| member.production_possible())
            .map(|member| &item.items[member.ordinal()])
            .collect::<Vec<_>>()
            .into_iter()
    }

    pub(crate) fn production_foreign_members(&self) -> impl Iterator<Item = &'a syn::ForeignItem> {
        let syn::Item::ForeignMod(item) = self.item else {
            return Vec::new().into_iter();
        };
        self.projected
            .members()
            .iter()
            .filter(|member| member.production_possible())
            .map(|member| &item.items[member.ordinal()])
            .collect::<Vec<_>>()
            .into_iter()
    }
}
