use std::path::Path;

use syn::{Attribute, Item};

use crate::analysis::{ProductionItemView, ProductionModuleView};
use crate::diagnostic::Diagnostic;
use crate::markers::MarkerTarget;
use crate::rules;
use crate::rules::context::RuleContext;
use crate::rules::module_owner::{FunctionOwner, ModuleOwner, ModuleProjection};

pub(crate) struct RuleEngine {
    context: RuleContext,
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

    pub(crate) fn check_module(
        mut self,
        module: &ProductionModuleView<'_>,
        effective_owner: Option<&str>,
    ) -> ModuleCheckResult {
        let local_owner = ModuleOwner::from_attributes(&mut self.context, module.module().attrs());
        rules::marker_placement::check_attrs(
            &mut self.context,
            module.module().attrs(),
            MarkerTarget::Module,
        );
        if let Some(owner) = &local_owner {
            owner.check_scope(&mut self.context, module.items().map(|item| item.syntax()));
        }
        let owner_used = self.check_projected_items(
            module,
            local_owner
                .as_ref()
                .map(|owner| owner.name.as_str())
                .or(effective_owner),
        );
        let local_owner_name = local_owner.as_ref().map(|owner| owner.name.clone());
        let pending_unused_owner = local_owner
            .as_ref()
            .and_then(|owner| (!owner_used).then(|| owner.unused_diagnostic(module.path())));
        ModuleCheckResult {
            diagnostics: self.context.into_diagnostics(),
            ownership: ModuleProjection {
                inherited_owner_used: local_owner.is_none()
                    && effective_owner.is_some()
                    && owner_used,
                local_owner: local_owner_name,
                pending_unused_owner,
            },
        }
    }

    fn check_projected_items(
        &mut self,
        module: &ProductionModuleView<'_>,
        inherited_owner: Option<&str>,
    ) -> bool {
        let mut inherited_owner_used = false;
        for projected in module.items() {
            match projected.syntax() {
                Item::Fn(function) => {
                    rules::marker_placement::check_projection(
                        &mut self.context,
                        projected.attributes(),
                        MarkerTarget::Function,
                    );
                    if FunctionOwner::new(inherited_owner).check(&mut self.context, function) {
                        inherited_owner_used = true;
                    }
                }
                Item::Mod(_) => {}
                Item::Impl(item) => self.check_impl(item, &projected),
                Item::Trait(item) => self.check_trait(item, &projected),
                Item::ForeignMod(item) => self.check_foreign_mod(item, &projected),
                Item::Use(item) => {
                    rules::marker_placement::check_projection(
                        &mut self.context,
                        projected.attributes(),
                        MarkerTarget::Other,
                    );
                    rules::use_alias::check_tree(&mut self.context, &item.tree);
                }
                _ => rules::marker_placement::check_projection(
                    &mut self.context,
                    projected.attributes(),
                    MarkerTarget::Other,
                ),
            }
        }
        inherited_owner_used
    }

    fn check_impl(&mut self, item: &syn::ItemImpl, projected: &ProductionItemView<'_>) {
        rules::marker_placement::check_attrs(&mut self.context, &item.attrs, MarkerTarget::Other);
        let self_type = rules::impl_method_owner::impl_self_type_name(item.self_ty.as_ref());
        let trait_impl = item.trait_.is_some();
        for (inner, _) in projected.production_members() {
            match inner {
                syn::ImplItem::Fn(function) => {
                    rules::marker_placement::check_attrs(
                        &mut self.context,
                        &function.attrs,
                        MarkerTarget::ImplMethod,
                    );
                    rules::impl_method_owner::check(
                        &mut self.context,
                        function,
                        self_type.as_deref(),
                        trait_impl,
                    );
                }
                _ => rules::marker_placement::check_attrs(
                    &mut self.context,
                    ImplItemAttrs { item: inner }.attrs(),
                    MarkerTarget::Other,
                ),
            }
        }
    }

    fn check_trait(&mut self, item: &syn::ItemTrait, projected: &ProductionItemView<'_>) {
        rules::marker_placement::check_attrs(&mut self.context, &item.attrs, MarkerTarget::Other);
        for inner in projected.production_trait_members() {
            rules::marker_placement::check_attrs(
                &mut self.context,
                TraitItemAttrs { item: inner }.attrs(),
                MarkerTarget::Other,
            );
        }
    }

    fn check_foreign_mod(
        &mut self,
        item: &syn::ItemForeignMod,
        projected: &ProductionItemView<'_>,
    ) {
        rules::marker_placement::check_attrs(&mut self.context, &item.attrs, MarkerTarget::Other);
        for inner in projected.production_foreign_members() {
            rules::marker_placement::check_attrs(
                &mut self.context,
                ForeignItemAttrs { item: inner }.attrs(),
                MarkerTarget::Other,
            );
        }
    }
}

pub(crate) struct ModuleCheckResult {
    pub(crate) diagnostics: Vec<Diagnostic>,
    pub(crate) ownership: ModuleProjection,
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
    use rstest::rstest;

    fn codes(source: &str) -> Vec<&'static str> {
        static NEXT_FIXTURE: std::sync::atomic::AtomicUsize =
            std::sync::atomic::AtomicUsize::new(0);
        let ordinal = NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "ousia-engine-projected-{}-{ordinal}",
            std::process::id()
        ));
        std::fs::create_dir_all(root.join("src")).expect("create engine fixture");
        std::fs::write(
            root.join("Cargo.toml"),
            format!(
                "[package]\nname = \"engine_fixture_{ordinal}\"\nversion = \"0.1.0\"\nedition = \"2024\"\n"
            ),
        )
        .expect("write engine manifest");
        std::fs::write(root.join("src/lib.rs"), source).expect("write engine source");
        let diagnostics = match crate::check_cargo_inputs(std::slice::from_ref(&root))
            .expect("check engine fixture")
        {
            crate::CheckOutcome::Passed => Vec::new(),
            crate::CheckOutcome::Invalid(diagnostics) => diagnostics,
        };
        std::fs::remove_dir_all(root).expect("remove engine fixture");
        diagnostics
            .into_iter()
            .map(|diagnostic| diagnostic.code)
            .collect()
    }

    /// Goal: accept module functions covered by an explicit module owner.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: public and private module functions emit no owner diagnostics when the module marker covers them.
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

    /// Goal: reject a module function that has no semantic owner.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: the checker emits only rust-function-owner-missing for the unowned function.
    #[test]
    fn missing_owner_rejects_module_function() {
        assert_eq!(
            codes("pub fn resolve() {}"),
            ["rust-function-owner-missing"]
        );
    }

    /// Goal: require a meaningful reason on an ownerless function marker.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: an empty reason does not satisfy ownership while a non-empty local-helper reason fully satisfies the owner contract.
    #[test]
    fn ownerless_function_requires_reason() {
        assert_eq!(
            codes(
                r#"#[doc = "ousia: ownerless-fn"]
fn helper() {}
"#
            ),
            ["rust-ownerless-fn-reason", "rust-function-owner-missing"],
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

    /// Goal: reject ownerless function markers that conflict with an enclosing module owner.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: a valid ownerless marker emits only rust-ownerless-fn-conflict while the function still counts as module-owner coverage.
    #[test]
    fn module_owned_function_rejects_ownerless_marker() {
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner routing"]
#[doc = "ousia: ownerless-fn local helper"]
fn helper() {}
"#
            ),
            ["rust-ownerless-fn-conflict"],
        );
    }

    /// Goal: let inline modules inherit the nearest enclosing module owner.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: a child function covered by its parent marker emits no missing-owner diagnostic.
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

    /// Goal: let an inline module declare its own function owner.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: a child-local module marker covers its child function without an enclosing owner.
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

    /// Goal: reject an inline module owner marker that covers no module function.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: an empty inline owner emits only rust-module-owner-unused.
    #[test]
    fn module_owner_requires_a_covered_function() {
        assert_eq!(
            codes(
                r#"#[doc = "ousia: module-owner empty"]
mod empty {}
"#,
            ),
            ["rust-module-owner-unused"],
        );
    }

    /// Goal: keep type and impl ownership outside a module function marker.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: the covered struct and impl each emit rust-module-owner-mixed-items.
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

    /// Goal: reject a module owner that covers only a mixed type scope and no function.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: the type emits mixed-items and the owner independently emits unused coverage evidence.
    #[test]
    fn mixed_only_module_owner_is_also_unused() {
        assert_eq!(
            codes(
                r#"#![doc = "ousia: module-owner types-only"]
struct Service;
"#,
            ),
            ["rust-module-owner-mixed-items", "rust-module-owner-unused"],
        );
    }

    /// Goal: allow function-supporting items inside a module function owner scope.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: use, const, static, macro, and extern support items coexist with a covered function without diagnostics.
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

    /// Goal: prevent re-exports from being hidden under a module function owner.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: the re-export emits rust-module-owner-mixed-items while the local function remains covered.
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

    /// Goal: reject every supported Rust use-alias shape at any inline module depth.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: each named alias shape emits exactly rust-use-alias-forbidden.
    #[rstest]
    #[case::leaf_rename(
        r#"#![doc = "ousia: module-owner paths"]
use crate::markers::DocMarker as Marker;

fn parse() {}
"#
    )]
    #[case::grouped_self_rename(
        r#"#![doc = "ousia: module-owner paths"]
use crate::markers::{self as marker_mod, DocMarker};

fn parse() {}
"#
    )]
    #[case::anonymous_underscore(
        r#"#![doc = "ousia: module-owner paths"]
use crate::markers::DocMarker as _;

fn parse() {}
"#
    )]
    #[case::nested_module_rename(
        r#"#![doc = "ousia: module-owner paths"]
mod nested {
    use crate::markers::DocMarker as Marker;

    fn parse() {}
}
"#
    )]
    fn use_aliases_are_rejected(#[case] source: &str) {
        assert_eq!(codes(source), ["rust-use-alias-forbidden"]);
    }

    /// Goal: recognize every supported signature shape that carries the impl self type.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: each named receiver, return, or wrapped-parameter shape needs no ownerless-method marker.
    #[rstest]
    #[case::receiver("pub fn call(&self) {}")]
    #[case::self_return("pub fn new() -> Self { Self }")]
    #[case::result_return("pub fn fallible() -> Result<Self, std::io::Error> { todo!() }")]
    #[case::option_parameter("pub fn optional(value: Option<Service>) {}")]
    #[case::slice_parameter("pub fn slice(value: &[Service]) {}")]
    #[case::tuple_parameter("pub fn tuple(value: (Service, String)) {}")]
    fn impl_methods_with_self_type_in_signature_are_allowed(#[case] method: &str) {
        let source = format!("struct Service;\nimpl Service {{\n{method}\n}}\n");
        assert!(codes(&source).is_empty());
    }

    /// Goal: require a meaningful ownerless marker for static impl helpers.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: an unmarked helper emits missing-owner while an empty marker emits reason and missing-owner diagnostics.
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

    /// Goal: reject ownerless method markers when an inherent signature or trait contract already owns the method.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: both Self-bearing inherent methods and trait implementation methods emit only rust-ownerless-method-unnecessary.
    #[rstest]
    #[case::self_bearing_inherent(
        r#"struct Service;
impl Service {
    #[doc = "ousia: ownerless-method constructor"]
    fn new() -> Self { Self }
}
"#
    )]
    #[case::trait_implementation(
        r#"struct Service;
trait Factory { fn create() -> Service; }
impl Factory for Service {
    #[doc = "ousia: ownerless-method factory implementation"]
    fn create() -> Service { Service }
}
"#
    )]
    fn owned_impl_methods_reject_ownerless_marker(#[case] source: &str) {
        assert_eq!(codes(source), ["rust-ownerless-method-unnecessary"]);
    }

    /// Goal: accept trait implementation methods as owned by their trait and implementing type.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: a trait associated function without an ownerless marker emits no inherent-method owner diagnostic.
    #[test]
    fn trait_impl_associated_function_has_trait_owner() {
        assert!(
            codes(
                r#"struct Service;
trait Factory { fn create() -> Service; }
impl Factory for Service {
    fn create() -> Service { Service }
}
"#
            )
            .is_empty()
        );
    }

    /// Goal: reject repeated ownerless declarations without duplicating missing-owner diagnostics.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: the second valid marker on a function or method emits exactly rust-owner-marker-duplicate.
    #[rstest]
    #[case::function(
        r#"#[doc = "ousia: ownerless-fn first reason"]
#[doc = "ousia: ownerless-fn second reason"]
fn helper() {}
"#
    )]
    #[case::method(
        r#"struct Service;
impl Service {
    #[doc = "ousia: ownerless-method first reason"]
    #[doc = "ousia: ownerless-method second reason"]
    fn helper(path: &str) {}
}
"#
    )]
    fn duplicate_ownerless_markers_are_rejected(#[case] source: &str) {
        assert_eq!(codes(source), ["rust-owner-marker-duplicate"]);
    }

    /// Goal: keep trait and extern items outside the first-version function-owner rules.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: trait declarations, defaults, and extern functions emit no module-function owner diagnostics.
    #[test]
    fn trait_and_extern_items_are_ignored() {
        assert!(
            codes(
                r#"trait Api {
    fn required(&self);
}
trait DefaultApi {
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

    /// Goal: reject module/function markers placed on impl, trait, or extern items.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: each invalid nested placement emits its stable marker-placement diagnostic.
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

    /// Goal: compose marker placement and function owner diagnostics deterministically.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: wrong struct/function placements emit their placement codes and the uncovered function also emits missing-owner.
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

    /// Goal: reject unknown Ousia doc markers without treating them as owner evidence.
    /// Scope: level=contract; boundary=check_cargo_inputs
    /// Semantics: the unknown marker and the resulting uncovered function emit both stable diagnostics.
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
