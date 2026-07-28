use std::collections::BTreeMap;
use std::path::Path;

use quote::ToTokens;
use sha2::{Digest, Sha256};

use super::cfg::{AttributeProjection, CfgExpr, CfgModel, Universe};
use super::error::FatalError;
use super::module_graph::{LogicalInclusionGraph, OccurrenceId, body_items};
use super::source_repository::PhysicalSourceRepository;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct ItemId(String);

pub(crate) struct ProjectedItemIndex {
    modules: BTreeMap<OccurrenceId, ProjectedModule>,
}

pub(crate) struct ProjectedModule {
    items: Vec<ProjectedItem>,
}

pub(crate) struct ProjectedItem {
    id: ItemId,
    ordinal: usize,
    attributes: AttributeProjection,
    effective_guard: CfgExpr,
    production_guard: CfgExpr,
    production_possible: bool,
    test_possible: bool,
    members: Vec<ProjectedMember>,
}

pub(crate) struct ProjectedMember {
    id: ItemId,
    ordinal: usize,
    effective_guard: CfgExpr,
    production_possible: bool,
}

impl ItemId {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl ProjectedItemIndex {
    pub(crate) fn build(
        graph: &LogicalInclusionGraph,
        repository: &PhysicalSourceRepository,
        cfg: &mut CfgModel,
    ) -> Result<Self, FatalError> {
        let mut modules = BTreeMap::new();
        for occurrence in graph.occurrences() {
            let path = repository.get(occurrence.source_id()).path();
            let mut semantic_ordinals = BTreeMap::<(String, String), usize>::new();
            let mut projected = Vec::new();
            for (ordinal, item) in body_items(repository, occurrence.body()).iter().enumerate() {
                let attributes = cfg.attributes(item_attrs(item), path)?;
                let effective_guard =
                    CfgExpr::all([occurrence.guard().clone(), attributes.item_guard.clone()]);
                let (kind, key) = item_semantic_identity(item);
                let semantic_ordinal = semantic_ordinals
                    .entry((kind.to_owned(), key.clone()))
                    .or_default();
                let id = ItemId(structural_item_identity(
                    occurrence.wire_id(),
                    kind,
                    &key,
                    *semantic_ordinal,
                    &effective_guard,
                ));
                *semantic_ordinal += 1;
                let production_guard = regular_guard(item, &attributes, &effective_guard);
                let production_possible = occurrence.target().target_kind.production_enabled()
                    && cfg.possible(&production_guard, Universe::Production)?;
                let test_possible = occurrence.target().test_enabled
                    && cfg.possible(
                        &test_guard(item, &attributes, &effective_guard),
                        Universe::Test,
                    )?;
                let members = project_members(&id, item, &effective_guard, path, cfg)?;
                projected.push(ProjectedItem {
                    id,
                    ordinal,
                    attributes,
                    effective_guard,
                    production_guard,
                    production_possible,
                    test_possible,
                    members,
                });
            }
            modules.insert(occurrence.id(), ProjectedModule { items: projected });
        }
        Ok(Self { modules })
    }

    pub(crate) fn module(&self, occurrence: OccurrenceId) -> &ProjectedModule {
        self.modules
            .get(&occurrence)
            .expect("logical occurrence projection must exist")
    }
}

impl ProjectedModule {
    pub(crate) fn items(&self) -> &[ProjectedItem] {
        &self.items
    }
}

impl ProjectedItem {
    pub(crate) fn id(&self) -> &ItemId {
        &self.id
    }

    pub(crate) fn ordinal(&self) -> usize {
        self.ordinal
    }

    pub(crate) fn attributes(&self) -> &AttributeProjection {
        &self.attributes
    }

    pub(crate) fn effective_guard(&self) -> &CfgExpr {
        &self.effective_guard
    }

    pub(crate) fn production_guard(&self) -> &CfgExpr {
        &self.production_guard
    }

    pub(crate) fn production_possible(&self) -> bool {
        self.production_possible
    }

    pub(crate) fn test_possible(&self) -> bool {
        self.test_possible
    }

    pub(crate) fn members(&self) -> &[ProjectedMember] {
        &self.members
    }
}

impl ProjectedMember {
    pub(crate) fn id(&self) -> &ItemId {
        &self.id
    }

    pub(crate) fn ordinal(&self) -> usize {
        self.ordinal
    }

    pub(crate) fn effective_guard(&self) -> &CfgExpr {
        &self.effective_guard
    }

    pub(crate) fn production_possible(&self) -> bool {
        self.production_possible
    }
}

#[doc = "ousia: ownerless-fn production activation guard projection"]
fn regular_guard(
    item: &syn::Item,
    attributes: &AttributeProjection,
    effective_guard: &CfgExpr,
) -> CfgExpr {
    if !matches!(item, syn::Item::Fn(_)) {
        return effective_guard.clone();
    }
    let carriers = CfgExpr::any(
        attributes
            .test_carriers()
            .into_iter()
            .map(|carrier| carrier.guard.clone()),
    );
    CfgExpr::all([effective_guard.clone(), CfgExpr::not(carriers)])
}

#[doc = "ousia: ownerless-fn test activation guard projection"]
fn test_guard(
    item: &syn::Item,
    attributes: &AttributeProjection,
    effective_guard: &CfgExpr,
) -> CfgExpr {
    if !matches!(item, syn::Item::Fn(_)) {
        return effective_guard.clone();
    }
    let carriers = CfgExpr::any(
        attributes
            .test_carriers()
            .into_iter()
            .map(|carrier| carrier.guard.clone()),
    );
    CfgExpr::all([effective_guard.clone(), carriers])
}

#[doc = "ousia: ownerless-fn associated member activation projection"]
fn project_members(
    parent_id: &ItemId,
    item: &syn::Item,
    parent_guard: &CfgExpr,
    path: &Path,
    cfg: &mut CfgModel,
) -> Result<Vec<ProjectedMember>, FatalError> {
    let members = match item {
        syn::Item::Impl(item) => item
            .items
            .iter()
            .map(|item| (impl_item_attrs(item), impl_item_identity(item)))
            .collect::<Vec<_>>(),
        syn::Item::Trait(item) => item
            .items
            .iter()
            .map(|item| (trait_item_attrs(item), trait_item_identity(item)))
            .collect::<Vec<_>>(),
        syn::Item::ForeignMod(item) => item
            .items
            .iter()
            .map(|item| (foreign_item_attrs(item), foreign_item_identity(item)))
            .collect::<Vec<_>>(),
        _ => return Ok(Vec::new()),
    };
    let mut semantic_ordinals = BTreeMap::<(String, String), usize>::new();
    members
        .into_iter()
        .enumerate()
        .map(|(ordinal, (attrs, (kind, key)))| {
            let projection = cfg.attributes(attrs, path)?;
            let guard = CfgExpr::all([parent_guard.clone(), projection.item_guard.clone()]);
            let semantic_ordinal = semantic_ordinals
                .entry((kind.to_owned(), key.clone()))
                .or_default();
            let id = ItemId(structural_member_identity(
                parent_id.as_str(),
                kind,
                &key,
                *semantic_ordinal,
                &guard,
            ));
            *semantic_ordinal += 1;
            Ok(ProjectedMember {
                id,
                ordinal,
                effective_guard: guard.clone(),
                production_possible: cfg.possible(&guard, Universe::Production)?,
            })
        })
        .collect()
}

#[doc = "ousia: ownerless-fn impl member semantic identity projection"]
fn impl_item_identity(item: &syn::ImplItem) -> (&'static str, String) {
    match item {
        syn::ImplItem::Const(item) => ("const", item.ident.to_string()),
        syn::ImplItem::Fn(item) => ("function", item.sig.ident.to_string()),
        syn::ImplItem::Type(item) => ("type", item.ident.to_string()),
        syn::ImplItem::Macro(item) => ("macro", stable_tokens(&item.mac.to_token_stream())),
        syn::ImplItem::Verbatim(tokens) => ("verbatim", stable_tokens(tokens)),
        other => ("other", stable_tokens(&other.to_token_stream())),
    }
}

#[doc = "ousia: ownerless-fn trait member semantic identity projection"]
fn trait_item_identity(item: &syn::TraitItem) -> (&'static str, String) {
    match item {
        syn::TraitItem::Const(item) => ("const", item.ident.to_string()),
        syn::TraitItem::Fn(item) => ("function", item.sig.ident.to_string()),
        syn::TraitItem::Type(item) => ("type", item.ident.to_string()),
        syn::TraitItem::Macro(item) => ("macro", stable_tokens(&item.mac.to_token_stream())),
        syn::TraitItem::Verbatim(tokens) => ("verbatim", stable_tokens(tokens)),
        other => ("other", stable_tokens(&other.to_token_stream())),
    }
}

#[doc = "ousia: ownerless-fn foreign member semantic identity projection"]
fn foreign_item_identity(item: &syn::ForeignItem) -> (&'static str, String) {
    match item {
        syn::ForeignItem::Fn(item) => ("function", item.sig.ident.to_string()),
        syn::ForeignItem::Static(item) => ("static", item.ident.to_string()),
        syn::ForeignItem::Type(item) => ("type", item.ident.to_string()),
        syn::ForeignItem::Macro(item) => ("macro", stable_tokens(&item.mac.to_token_stream())),
        syn::ForeignItem::Verbatim(tokens) => ("verbatim", stable_tokens(tokens)),
        other => ("other", stable_tokens(&other.to_token_stream())),
    }
}

#[doc = "ousia: ownerless-fn module item attribute syntax adapter"]
pub(crate) fn item_attrs(item: &syn::Item) -> &[syn::Attribute] {
    match item {
        syn::Item::Const(item) => &item.attrs,
        syn::Item::Enum(item) => &item.attrs,
        syn::Item::ExternCrate(item) => &item.attrs,
        syn::Item::Fn(item) => &item.attrs,
        syn::Item::ForeignMod(item) => &item.attrs,
        syn::Item::Impl(item) => &item.attrs,
        syn::Item::Macro(item) => &item.attrs,
        syn::Item::Mod(item) => &item.attrs,
        syn::Item::Static(item) => &item.attrs,
        syn::Item::Struct(item) => &item.attrs,
        syn::Item::Trait(item) => &item.attrs,
        syn::Item::TraitAlias(item) => &item.attrs,
        syn::Item::Type(item) => &item.attrs,
        syn::Item::Union(item) => &item.attrs,
        syn::Item::Use(item) => &item.attrs,
        syn::Item::Verbatim(_) => &[],
        _ => &[],
    }
}

#[doc = "ousia: ownerless-fn impl member attribute syntax adapter"]
pub(crate) fn impl_item_attrs(item: &syn::ImplItem) -> &[syn::Attribute] {
    match item {
        syn::ImplItem::Const(item) => &item.attrs,
        syn::ImplItem::Fn(item) => &item.attrs,
        syn::ImplItem::Type(item) => &item.attrs,
        syn::ImplItem::Macro(item) => &item.attrs,
        syn::ImplItem::Verbatim(_) => &[],
        _ => &[],
    }
}

#[doc = "ousia: ownerless-fn trait member attribute syntax adapter"]
pub(crate) fn trait_item_attrs(item: &syn::TraitItem) -> &[syn::Attribute] {
    match item {
        syn::TraitItem::Const(item) => &item.attrs,
        syn::TraitItem::Fn(item) => &item.attrs,
        syn::TraitItem::Type(item) => &item.attrs,
        syn::TraitItem::Macro(item) => &item.attrs,
        syn::TraitItem::Verbatim(_) => &[],
        _ => &[],
    }
}

#[doc = "ousia: ownerless-fn foreign member attribute syntax adapter"]
pub(crate) fn foreign_item_attrs(item: &syn::ForeignItem) -> &[syn::Attribute] {
    match item {
        syn::ForeignItem::Fn(item) => &item.attrs,
        syn::ForeignItem::Static(item) => &item.attrs,
        syn::ForeignItem::Type(item) => &item.attrs,
        syn::ForeignItem::Macro(item) => &item.attrs,
        syn::ForeignItem::Verbatim(_) => &[],
        _ => &[],
    }
}

#[doc = "ousia: ownerless-fn semantic identity projection for module items"]
fn item_semantic_identity(item: &syn::Item) -> (&'static str, String) {
    match item {
        syn::Item::Const(item) => ("const", item.ident.to_string()),
        syn::Item::Enum(item) => ("enum", item.ident.to_string()),
        syn::Item::ExternCrate(item) => ("extern-crate", item.ident.to_string()),
        syn::Item::Fn(item) => ("function", item.sig.ident.to_string()),
        syn::Item::ForeignMod(item) => ("foreign", item.abi.to_token_stream().to_string()),
        syn::Item::Impl(item) => ("impl", impl_key(item)),
        syn::Item::Macro(item) => (
            "macro",
            item.ident
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| item.mac.path.to_token_stream().to_string()),
        ),
        syn::Item::Mod(item) => ("module", item.ident.to_string()),
        syn::Item::Static(item) => ("static", item.ident.to_string()),
        syn::Item::Struct(item) => ("struct", item.ident.to_string()),
        syn::Item::Trait(item) => ("trait", item.ident.to_string()),
        syn::Item::TraitAlias(item) => ("trait-alias", item.ident.to_string()),
        syn::Item::Type(item) => ("type", item.ident.to_string()),
        syn::Item::Union(item) => ("union", item.ident.to_string()),
        syn::Item::Use(item) => ("use", item.tree.to_token_stream().to_string()),
        syn::Item::Verbatim(tokens) => ("verbatim", stable_tokens(tokens)),
        other => ("other", stable_tokens(&other.to_token_stream())),
    }
}

#[doc = "ousia: ownerless-fn canonical impl semantic key projection"]
fn impl_key(item: &syn::ItemImpl) -> String {
    let trait_key = item
        .trait_
        .as_ref()
        .map(|(path, _)| {
            format!(
                "{}:{}",
                if item.modifiers.polarity.is_some() {
                    "negative"
                } else {
                    "trait"
                },
                path.to_token_stream()
            )
        })
        .unwrap_or_else(|| "inherent".to_owned());
    format!("{trait_key}:{}", item.self_ty.to_token_stream())
}

#[doc = "ousia: ownerless-fn stable syntax fingerprint for structural identities"]
fn stable_tokens(tokens: &proc_macro2::TokenStream) -> String {
    let digest = Sha256::digest(tokens.to_string().as_bytes());
    format!("{digest:x}")
}

#[doc = "ousia: ownerless-fn canonical projected item identity encoding"]
fn structural_item_identity(
    occurrence: &str,
    kind: &str,
    key: &str,
    ordinal: usize,
    guard: &CfgExpr,
) -> String {
    let guard = guard.canonical();
    [
        ("occurrence", occurrence),
        ("kind", kind),
        ("key", key),
        ("guard", guard.as_str()),
    ]
    .into_iter()
    .fold(format!("item:{ordinal}"), |mut id, (label, value)| {
        id.push(':');
        id.push_str(label);
        id.push(':');
        id.push_str(&value.len().to_string());
        id.push(':');
        id.push_str(value);
        id
    })
}

#[doc = "ousia: ownerless-fn canonical projected member identity encoding"]
fn structural_member_identity(
    parent: &str,
    kind: &str,
    key: &str,
    ordinal: usize,
    guard: &CfgExpr,
) -> String {
    let guard = guard.canonical();
    [
        ("parent", parent),
        ("kind", kind),
        ("key", key),
        ("guard", &guard),
    ]
    .into_iter()
    .fold(format!("member:{ordinal}"), |mut id, (label, value)| {
        id.push(':');
        id.push_str(label);
        id.push(':');
        id.push_str(&value.len().to_string());
        id.push(':');
        id.push_str(value);
        id
    })
}
