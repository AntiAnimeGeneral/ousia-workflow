#![doc = "ousia: module-owner rust-checker-module-owner-scope-rule"]

use syn::Item;
use syn::spanned::Spanned;

use crate::engine::context::{ModuleOwner, RuleContext};

pub(crate) fn check_usage(
    context: &mut RuleContext,
    owner: &ModuleOwner,
    owner_used: bool,
    owner_has_mixed_items: bool,
) {
    if !owner_used && !owner_has_mixed_items {
        context.emit(
            "rust-module-owner-unused",
            owner.location,
            format!(
                "module owner `{}` must cover at least one module-level function",
                owner.name,
            ),
        );
    }
}

pub(crate) fn check_scope(context: &mut RuleContext, owner: &ModuleOwner, items: &[Item]) -> bool {
    let mut has_mixed_items = false;
    for item in items {
        if let Some(name) = mixed_item_name(item) {
            has_mixed_items = true;
            context.emit(
                "rust-module-owner-mixed-items",
                item.span().start(),
                format!(
                    "module owner `{}` may not cover type definitions, trait definitions, impl blocks, or re-exports; found `{name}`",
                    owner.name,
                ),
            );
        }
    }
    has_mixed_items
}

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
