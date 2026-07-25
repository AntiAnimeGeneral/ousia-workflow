use std::path::Path;

use syn::{Attribute, Item};

pub(crate) mod context;

use crate::diagnostic::Diagnostic;
use crate::engine::context::RuleContext;
use crate::markers::MarkerTarget;
use crate::rules;
use crate::signature_analysis;

pub(crate) struct RuleEngine {
    context: RuleContext,
}

struct TestModule<'a> {
    attrs: &'a [Attribute],
}

struct ItemAttrs<'a> {
    item: &'a Item,
}

struct ImplItemAttrs<'a> {
    item: &'a syn::ImplItem,
}

struct TraitItemAttrs<'a> {
    item: &'a syn::TraitItem,
}

struct ForeignItemAttrs<'a> {
    item: &'a syn::ForeignItem,
}

impl RuleEngine {
    pub(crate) fn new(path: impl AsRef<Path>) -> Self {
        Self {
            context: RuleContext::new(path),
        }
    }

    pub(crate) fn check_file(mut self, file: &syn::File) -> Vec<Diagnostic> {
        self.check_parsed_file(file);
        self.context.into_diagnostics()
    }

    fn check_parsed_file(&mut self, file: &syn::File) {
        let owner = rules::module_function_owner::module_owner(&mut self.context, &file.attrs);
        rules::marker_placement::check_attrs(&mut self.context, &file.attrs, MarkerTarget::Module);
        let owner_has_mixed_items = if let Some(owner) = &owner {
            rules::module_owner_scope::check_scope(&mut self.context, owner, &file.items)
        } else {
            false
        };
        let owner_used =
            self.check_items(&file.items, owner.as_ref().map(|owner| owner.name.as_str()));
        if let Some(owner) = owner {
            rules::module_owner_scope::check_usage(
                &mut self.context,
                &owner,
                owner_used,
                owner_has_mixed_items,
            );
        }
    }

    fn check_items(&mut self, items: &[Item], inherited_owner: Option<&str>) -> bool {
        let mut inherited_owner_used = false;
        for item in items {
            match item {
                Item::Fn(function) => {
                    rules::marker_placement::check_attrs(
                        &mut self.context,
                        &function.attrs,
                        MarkerTarget::Function,
                    );
                    if rules::module_function_owner::check_function(
                        &mut self.context,
                        function,
                        inherited_owner,
                    ) {
                        inherited_owner_used = true;
                    }
                }
                Item::Mod(module) => {
                    rules::marker_placement::check_attrs(
                        &mut self.context,
                        &module.attrs,
                        MarkerTarget::Module,
                    );
                    if (TestModule {
                        attrs: &module.attrs,
                    })
                    .is_test_module()
                    {
                        continue;
                    }
                    let local_owner = rules::module_function_owner::module_owner(
                        &mut self.context,
                        &module.attrs,
                    );
                    if let Some((_, nested)) = &module.content {
                        let nested_owner_used = self.check_items(
                            nested,
                            local_owner
                                .as_ref()
                                .map(|owner| owner.name.as_str())
                                .or(inherited_owner),
                        );
                        if let Some(owner) = local_owner {
                            let owner_has_mixed_items = rules::module_owner_scope::check_scope(
                                &mut self.context,
                                &owner,
                                nested,
                            );
                            rules::module_owner_scope::check_usage(
                                &mut self.context,
                                &owner,
                                nested_owner_used,
                                owner_has_mixed_items,
                            );
                        } else if nested_owner_used {
                            inherited_owner_used = true;
                        }
                    } else if let Some(owner) = local_owner {
                        rules::module_owner_scope::check_usage(
                            &mut self.context,
                            &owner,
                            false,
                            false,
                        );
                    }
                }
                Item::Impl(item) => self.check_impl(item),
                Item::Trait(item) => self.check_trait(item),
                Item::ForeignMod(item) => self.check_foreign_mod(item),
                Item::Use(item) => {
                    rules::marker_placement::check_attrs(
                        &mut self.context,
                        &item.attrs,
                        MarkerTarget::Other,
                    );
                    rules::use_alias::check_tree(&mut self.context, &item.tree);
                }
                _ => rules::marker_placement::check_attrs(
                    &mut self.context,
                    ItemAttrs { item }.attrs(),
                    MarkerTarget::Other,
                ),
            }
        }
        inherited_owner_used
    }

    fn check_impl(&mut self, item: &syn::ItemImpl) {
        rules::marker_placement::check_attrs(&mut self.context, &item.attrs, MarkerTarget::Other);
        let self_type = signature_analysis::impl_self_type_name(item.self_ty.as_ref());
        for inner in &item.items {
            match inner {
                syn::ImplItem::Fn(function) => {
                    rules::marker_placement::check_attrs(
                        &mut self.context,
                        &function.attrs,
                        MarkerTarget::ImplMethod,
                    );
                    if let Some(self_type) = self_type.as_deref() {
                        rules::impl_method_owner::check(&mut self.context, function, self_type);
                    }
                }
                _ => rules::marker_placement::check_attrs(
                    &mut self.context,
                    ImplItemAttrs { item: inner }.attrs(),
                    MarkerTarget::Other,
                ),
            }
        }
    }

    fn check_trait(&mut self, item: &syn::ItemTrait) {
        rules::marker_placement::check_attrs(&mut self.context, &item.attrs, MarkerTarget::Other);
        for inner in &item.items {
            rules::marker_placement::check_attrs(
                &mut self.context,
                TraitItemAttrs { item: inner }.attrs(),
                MarkerTarget::Other,
            );
        }
    }

    fn check_foreign_mod(&mut self, item: &syn::ItemForeignMod) {
        rules::marker_placement::check_attrs(&mut self.context, &item.attrs, MarkerTarget::Other);
        for inner in &item.items {
            rules::marker_placement::check_attrs(
                &mut self.context,
                ForeignItemAttrs { item: inner }.attrs(),
                MarkerTarget::Other,
            );
        }
    }
}

impl TestModule<'_> {
    fn is_test_module(&self) -> bool {
        self.attrs.iter().any(|attr| {
            let syn::Meta::List(meta) = &attr.meta else {
                return false;
            };
            meta.path.is_ident("cfg") && meta.tokens.to_string() == "test"
        })
    }
}

impl<'a> ItemAttrs<'a> {
    fn attrs(&self) -> &'a [Attribute] {
        match self.item {
            Item::Const(item) => &item.attrs,
            Item::Enum(item) => &item.attrs,
            Item::ExternCrate(item) => &item.attrs,
            Item::ForeignMod(item) => &item.attrs,
            Item::Impl(item) => &item.attrs,
            Item::Macro(item) => &item.attrs,
            Item::Static(item) => &item.attrs,
            Item::Struct(item) => &item.attrs,
            Item::Trait(item) => &item.attrs,
            Item::TraitAlias(item) => &item.attrs,
            Item::Type(item) => &item.attrs,
            Item::Union(item) => &item.attrs,
            Item::Use(item) => &item.attrs,
            Item::Verbatim(_) => &[],
            _ => &[],
        }
    }
}

impl<'a> ImplItemAttrs<'a> {
    fn attrs(&self) -> &'a [Attribute] {
        match self.item {
            syn::ImplItem::Const(item) => &item.attrs,
            syn::ImplItem::Fn(item) => &item.attrs,
            syn::ImplItem::Type(item) => &item.attrs,
            syn::ImplItem::Macro(item) => &item.attrs,
            syn::ImplItem::Verbatim(_) => &[],
            _ => &[],
        }
    }
}

impl<'a> TraitItemAttrs<'a> {
    fn attrs(&self) -> &'a [Attribute] {
        match self.item {
            syn::TraitItem::Const(item) => &item.attrs,
            syn::TraitItem::Fn(item) => &item.attrs,
            syn::TraitItem::Type(item) => &item.attrs,
            syn::TraitItem::Macro(item) => &item.attrs,
            syn::TraitItem::Verbatim(_) => &[],
            _ => &[],
        }
    }
}

impl<'a> ForeignItemAttrs<'a> {
    fn attrs(&self) -> &'a [Attribute] {
        match self.item {
            syn::ForeignItem::Fn(item) => &item.attrs,
            syn::ForeignItem::Static(item) => &item.attrs,
            syn::ForeignItem::Type(item) => &item.attrs,
            syn::ForeignItem::Macro(item) => &item.attrs,
            syn::ForeignItem::Verbatim(_) => &[],
            _ => &[],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(source: &str) -> Vec<&'static str> {
        let file = syn::parse_file(source).expect("fixture source should parse");
        RuleEngine::new("fixture.rs")
            .check_file(&file)
            .into_iter()
            .map(|diagnostic| diagnostic.code)
            .collect()
    }

    #[test]
    fn module_owner_allows_module_functions() {
        let diagnostics = codes(
            r#"#![doc = "ousia: module-owner routing"]

pub fn resolve() {}
fn helper() {}
"#,
        );
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }

    #[test]
    fn missing_owner_rejects_module_function() {
        assert_eq!(
            codes("pub fn resolve() {}"),
            ["rust-function-owner-missing"]
        );
    }

    #[test]
    fn ownerless_function_requires_reason() {
        assert_eq!(
            codes(
                r#"#[doc = "ousia: ownerless-fn"]
fn helper() {}
"#
            ),
            ["rust-ownerless-fn-reason", "rust-function-owner-missing",],
        );
        assert!(
            codes(
                r#"#[doc = "ousia: ownerless-fn local helper"]
fn helper() {}
"#
            )
            .is_empty()
        );
    }

    #[test]
    fn inline_modules_inherit_owner() {
        assert!(
            codes(
                r#"#![doc = "ousia: module-owner routing"]
mod nested {
    pub fn child() {}
}
"#
            )
            .is_empty()
        );
    }

    #[test]
    fn inline_modules_can_declare_owner() {
        assert!(
            codes(
                r#"#[doc = "ousia: module-owner nested"]
mod nested {
    pub fn child() {}
}
"#
            )
            .is_empty()
        );
    }

    #[test]
    fn module_owner_requires_a_covered_function() {
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner model"]
struct Diagnostic;
impl Diagnostic {
    fn new() -> Self {
        Self
    }
}
"#,
            ),
            [
                "rust-module-owner-mixed-items",
                "rust-module-owner-mixed-items",
            ],
        );
        assert_eq!(
            codes(
                r#"#[doc = "ousia: module-owner empty"]
mod empty {}
"#,
            ),
            ["rust-module-owner-unused"],
        );
    }

    #[test]
    fn module_owner_rejects_non_function_items() {
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner cli"]
struct Cli;
impl Cli {
    fn paths(self) {}
}
fn main() {}
"#,
            ),
            [
                "rust-module-owner-mixed-items",
                "rust-module-owner-mixed-items",
            ],
        );
    }

    #[test]
    fn module_owner_allows_support_items() {
        assert!(
            codes(
                r#"#![doc = "ousia: module-owner paths"]
use std::path::Path;
const DEFAULT_PATH: &str = ".";
static SKIP_NAMES: &[&str] = &["target"];

macro_rules! local_macro {
    () => {};
}

extern "C" {
    fn foreign();
}

fn collect(path: &Path) {}
"#,
            )
            .is_empty()
        );
    }

    #[test]
    fn module_owner_rejects_re_exports() {
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner api"]
pub use crate::diagnostic::Diagnostic;

fn run() {}
"#,
            ),
            ["rust-module-owner-mixed-items"],
        );
    }

    #[test]
    fn use_aliases_are_rejected() {
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner paths"]
use crate::markers::DocMarker as Marker;

fn parse() {}
"#,
            ),
            ["rust-use-alias-forbidden"],
        );
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner paths"]
use crate::markers::{self as marker_mod, DocMarker};

fn parse() {}
"#,
            ),
            ["rust-use-alias-forbidden"],
        );
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner paths"]
use crate::markers::DocMarker as _;

fn parse() {}
"#,
            ),
            ["rust-use-alias-forbidden"],
        );
    }

    #[test]
    fn use_aliases_are_rejected_in_nested_modules() {
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner paths"]
mod nested {
    use crate::markers::DocMarker as Marker;

    fn parse() {}
}
"#,
            ),
            ["rust-use-alias-forbidden"],
        );
    }

    #[test]
    fn inherited_module_owner_counts_nested_functions() {
        assert!(
            codes(
                r#"#![doc = "ousia: module-owner routing"]
mod nested {
    pub fn child() {}
}
"#,
            )
            .is_empty()
        );
    }

    #[test]
    fn impl_methods_with_self_type_in_signature_are_allowed() {
        assert!(
            codes(
                r#"struct Service;
impl Service {
    pub fn call(&self) {}
    pub fn new() -> Self { Self }
    pub fn fallible() -> Result<Self, std::io::Error> { todo!() }
    pub fn optional(value: Option<Service>) {}
    pub fn slice(value: &[Service]) {}
    pub fn tuple(value: (Service, String)) {}
}
"#
            )
            .is_empty()
        );
    }

    #[test]
    fn impl_methods_without_self_type_require_ownerless_method_reason() {
        assert_eq!(
            codes(
                r#"struct Service;
impl Service {
    pub fn helper(path: &str) {}
    #[doc = "ousia: ownerless-method static helper belongs to Service namespace"]
    pub fn marked(path: &str) {}
}
"#
            ),
            ["rust-impl-method-owner-missing"],
        );
        assert_eq!(
            codes(
                r#"struct Service;
impl Service {
    #[doc = "ousia: ownerless-method"]
    pub fn helper(path: &str) {}
}
"#
            ),
            [
                "rust-ownerless-method-reason",
                "rust-impl-method-owner-missing",
            ],
        );
    }

    #[test]
    fn trait_and_extern_items_are_ignored() {
        assert!(
            codes(
                r#"trait Api {
    fn call(&self) {}
}
trait Api {
    fn call(&self) {}
}
extern "C" {
    fn foreign();
}
"#
            )
            .is_empty()
        );
    }

    #[test]
    fn nested_non_module_markers_are_rejected() {
        assert_eq!(
            codes(
                r#"struct Service;
impl Service {
    #[doc = "ousia: ownerless-fn method"]
    pub fn call(&self) {}
}
trait Api {
    #[doc = "ousia: module-owner trait"]
    fn call(&self) {}
}
extern "C" {
    #[doc = "ousia: ownerless-fn foreign"]
    fn foreign();
}
"#
            ),
            [
                "rust-ownerless-fn-placement",
                "rust-module-owner-placement",
                "rust-ownerless-fn-placement",
            ],
        );
    }

    #[test]
    fn marker_placement_is_validated() {
        assert_eq!(
            codes(
                r#"#[doc = "ousia: ownerless-fn not a function"]
struct Marker;
#[doc = "ousia: module-owner wrong place"]
fn helper() {}
"#
            ),
            [
                "rust-ownerless-fn-placement",
                "rust-module-owner-placement",
                "rust-function-owner-missing",
            ],
        );
    }

    #[test]
    fn unknown_ousia_marker_is_rejected() {
        assert_eq!(
            codes(
                r#"#[doc = "ousia: unknown"]
fn helper() {}
"#
            ),
            ["rust-ousia-marker-unknown", "rust-function-owner-missing",],
        );
    }
}
