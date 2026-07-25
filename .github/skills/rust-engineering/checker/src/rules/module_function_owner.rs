#![doc = "ousia: module-owner rust-checker-module-function-owner-rule"]

use syn::{Attribute, ItemFn};

use crate::engine::context::{ModuleOwner, RuleContext};
use crate::markers::{self, MarkerKind};

pub(crate) fn module_owner(context: &mut RuleContext, attrs: &[Attribute]) -> Option<ModuleOwner> {
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
                owner = Some(ModuleOwner {
                    name: value,
                    location: marker.location,
                });
            }
        }
    }
    owner
}

pub(crate) fn check_function(
    context: &mut RuleContext,
    function: &ItemFn,
    inherited_owner: Option<&str>,
) -> bool {
    if inherited_owner.is_some() {
        return true;
    }
    if ownerless_fn_reason(context, &function.attrs) {
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

fn ownerless_fn_reason(context: &mut RuleContext, attrs: &[Attribute]) -> bool {
    let mut allowed = false;
    for marker in markers::DocMarker::parse_all(attrs) {
        if let MarkerKind::OwnerlessFn(reason) = marker.kind {
            if reason.trim().is_empty() {
                context.emit(
                    "rust-ownerless-fn-reason",
                    marker.location,
                    "ownerless function marker requires a non-empty reason",
                );
            } else {
                allowed = true;
            }
        }
    }
    allowed
}
