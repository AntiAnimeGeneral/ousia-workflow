#![doc = "ousia: module-owner rust-checker-impl-method-owner-rule"]

use syn::Attribute;

use crate::engine::context::RuleContext;
use crate::markers::{self, MarkerKind};
use crate::signature_analysis;

pub(crate) fn check(context: &mut RuleContext, function: &syn::ImplItemFn, self_type: &str) {
    if signature_analysis::method_signature_mentions_self_type(&function.sig, self_type) {
        return;
    }
    if ownerless_method_reason(context, &function.attrs) {
        return;
    }
    context.emit(
        "rust-impl-method-owner-missing",
        function.sig.fn_token.span.start(),
        format!(
            "impl method `{}` needs a signature containing `{self_type}` or an ownerless method reason",
            function.sig.ident,
        ),
    );
}

fn ownerless_method_reason(context: &mut RuleContext, attrs: &[Attribute]) -> bool {
    let mut allowed = false;
    for marker in markers::DocMarker::parse_all(attrs) {
        if let MarkerKind::OwnerlessMethod(reason) = marker.kind {
            if reason.trim().is_empty() {
                context.emit(
                    "rust-ownerless-method-reason",
                    marker.location,
                    "ownerless method marker requires a non-empty reason",
                );
            } else {
                allowed = true;
            }
        }
    }
    allowed
}
