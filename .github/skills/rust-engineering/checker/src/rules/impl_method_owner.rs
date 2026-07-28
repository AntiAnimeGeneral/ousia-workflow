#![doc = "ousia: module-owner rust-checker-impl-method-owner-rule"]

mod signature;

use crate::markers::{self, MarkerKind};
use crate::rules::context::RuleContext;

pub(crate) fn impl_self_type_name(ty: &syn::Type) -> Option<String> {
    signature::impl_self_type_name(ty)
}

pub(crate) fn check(
    context: &mut RuleContext,
    function: &syn::ImplItemFn,
    self_type: Option<&str>,
    trait_impl: bool,
) {
    let self_type_participates = self_type.is_some_and(|self_type| {
        signature::method_signature_mentions_self_type(&function.sig, self_type)
    });
    let ownerless_markers = markers::DocMarker::parse_all(&function.attrs)
        .into_iter()
        .filter(|marker| matches!(marker.kind, MarkerKind::OwnerlessMethod(_)))
        .collect::<Vec<_>>();
    let mut valid_marker_location = None;
    for marker in &ownerless_markers {
        let MarkerKind::OwnerlessMethod(reason) = &marker.kind else {
            unreachable!("ownerless marker collection is filtered by kind");
        };
        if reason.trim().is_empty() {
            context.emit(
                "rust-ownerless-method-reason",
                marker.location,
                "ownerless method marker requires a non-empty reason",
            );
            continue;
        }
        valid_marker_location.get_or_insert(marker.location);
    }
    if let Some(marker) = ownerless_markers.get(1) {
        emit_duplicate(context, marker.location);
    }
    if (trait_impl || self_type_participates)
        && let Some(location) = valid_marker_location
    {
        context.emit(
            "rust-ownerless-method-unnecessary",
            location,
            "ownerless method marker is unnecessary because the method already has a type owner",
        );
    }

    if trait_impl || self_type_participates || valid_marker_location.is_some() {
        return;
    }
    let Some(self_type) = self_type else {
        return;
    };
    context.emit(
        "rust-impl-method-owner-missing",
        function.sig.fn_token.span.start(),
        format!(
            "impl method `{}` needs a signature containing `{self_type}` or an ownerless method reason",
            function.sig.ident,
        ),
    );
}

fn emit_duplicate(context: &mut RuleContext, location: proc_macro2::LineColumn) {
    context.emit(
        "rust-owner-marker-duplicate",
        location,
        "ownerless method marker is declared more than once",
    );
}
