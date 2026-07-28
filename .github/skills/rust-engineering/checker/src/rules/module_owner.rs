use std::path::Path;

use syn::spanned::Spanned;
use syn::{Attribute, Item, ItemFn};

use crate::analysis::module_graph::OccurrenceId;
use crate::diagnostic::Diagnostic;
use crate::markers::{self, MarkerKind};
use crate::rules::context::RuleContext;

pub(crate) struct ModuleOwner {
    pub(crate) name: String,
    location: proc_macro2::LineColumn,
}

pub(crate) struct ModuleProjection {
    pub(crate) inherited_owner_used: bool,
    pub(crate) local_owner: Option<String>,
    pub(crate) pending_unused_owner: Option<Diagnostic>,
}

pub(crate) struct FunctionOwner<'a> {
    name: Option<&'a str>,
}

#[derive(Default)]
pub(crate) struct Lineage {
    owners: std::collections::BTreeMap<OccurrenceId, (OccurrenceId, String)>,
    used_owners: std::collections::BTreeSet<OccurrenceId>,
    pending_unused: std::collections::BTreeMap<OccurrenceId, Diagnostic>,
}

impl Lineage {
    pub(crate) fn inherited(&self, parent: Option<OccurrenceId>) -> Option<(OccurrenceId, String)> {
        parent.and_then(|parent| self.owners.get(&parent).cloned())
    }

    pub(crate) fn settle(
        &mut self,
        occurrence: OccurrenceId,
        inherited: Option<(OccurrenceId, String)>,
        projection: ModuleProjection,
    ) {
        if projection.inherited_owner_used
            && let Some((origin, _)) = &inherited
        {
            self.used_owners.insert(*origin);
        }
        if let Some(owner) = projection.local_owner {
            self.owners.insert(occurrence, (occurrence, owner));
            if let Some(diagnostic) = projection.pending_unused_owner {
                self.pending_unused.insert(occurrence, diagnostic);
            }
        } else if let Some(owner) = inherited {
            self.owners.insert(occurrence, owner);
        }
    }

    pub(crate) fn finish(self) -> impl Iterator<Item = Diagnostic> {
        self.pending_unused
            .into_iter()
            .filter_map(move |(owner, diagnostic)| {
                (!self.used_owners.contains(&owner)).then_some(diagnostic)
            })
    }
}

impl ModuleOwner {
    pub(crate) fn from_attributes(context: &mut RuleContext, attrs: &[Attribute]) -> Option<Self> {
        let mut owner = None;
        for marker in markers::DocMarker::parse_all(attrs) {
            if let MarkerKind::ModuleOwner(value) = marker.kind {
                if value.trim().is_empty() {
                    context.emit(
                        "rust-module-owner-invalid",
                        marker.location,
                        "module owner marker requires a non-empty owner",
                    );
                } else {
                    owner = Some(Self {
                        name: value,
                        location: marker.location,
                    });
                }
            }
        }
        owner
    }

    pub(crate) fn check_scope<'a>(
        &self,
        context: &mut RuleContext,
        items: impl IntoIterator<Item = &'a Item>,
    ) -> bool {
        let mut has_mixed_items = false;
        for item in items {
            if let Some(name) = mixed_item_name(item) {
                has_mixed_items = true;
                context.emit(
                    "rust-module-owner-mixed-items",
                    item.span().start(),
                    format!(
                        "module owner `{}` may not cover type definitions, trait definitions, impl blocks, or re-exports; found `{name}`",
                        self.name,
                    ),
                );
            }
        }
        has_mixed_items
    }

    pub(crate) fn unused_diagnostic(&self, path: &Path) -> Diagnostic {
        Diagnostic::new(
            "rust-module-owner-unused",
            path,
            self.location,
            format!(
                "module owner `{}` must cover at least one module-level function",
                self.name,
            ),
        )
    }
}

impl<'a> FunctionOwner<'a> {
    pub(crate) fn new(name: Option<&'a str>) -> Self {
        Self { name }
    }

    pub(crate) fn check(&self, context: &mut RuleContext, function: &ItemFn) -> bool {
        let ownerless_markers = markers::DocMarker::parse_all(&function.attrs)
            .into_iter()
            .filter(|marker| matches!(marker.kind, MarkerKind::OwnerlessFn(_)))
            .collect::<Vec<_>>();
        let mut valid_marker_location = None;
        for marker in &ownerless_markers {
            let MarkerKind::OwnerlessFn(reason) = &marker.kind else {
                unreachable!("ownerless marker collection is filtered by kind");
            };
            if reason.trim().is_empty() {
                context.emit(
                    "rust-ownerless-fn-reason",
                    marker.location,
                    "ownerless function marker requires a non-empty reason",
                );
                continue;
            }
            valid_marker_location.get_or_insert(marker.location);
        }
        if let Some(marker) = ownerless_markers.get(1) {
            context.emit(
                "rust-owner-marker-duplicate",
                marker.location,
                "ownerless function marker is declared more than once",
            );
        }
        if self.name.is_some()
            && let Some(location) = valid_marker_location
        {
            context.emit(
                "rust-ownerless-fn-conflict",
                location,
                "ownerless function marker conflicts with the enclosing module owner",
            );
        }

        if self.name.is_some() {
            return true;
        }
        if valid_marker_location.is_some() {
            return false;
        }
        context.emit(
            "rust-function-owner-missing",
            function.sig.fn_token.span.start(),
            format!(
                "module-level function `{}` needs a module owner or an ownerless function reason",
                function.sig.ident,
            ),
        );
        false
    }
}

#[doc = "ousia: ownerless-fn module-owner scope item classification"]
fn mixed_item_name(item: &Item) -> Option<&'static str> {
    match item {
        Item::Enum(_) => Some("enum"),
        Item::Impl(_) => Some("impl"),
        Item::Struct(_) => Some("struct"),
        Item::Trait(_) => Some("trait"),
        Item::TraitAlias(_) => Some("trait alias"),
        Item::Type(_) => Some("type alias"),
        Item::Union(_) => Some("union"),
        Item::Use(item) => (!matches!(item.vis, syn::Visibility::Inherited)).then_some("re-export"),
        _ => None,
    }
}
