#![doc = "ousia: module-owner rust-checker-marker-placement-rule"]

use syn::Attribute;

use crate::analysis::cfg::AttributeProjection;
use crate::markers::{self, MarkerKind, MarkerTarget};
use crate::rules::context::RuleContext;

pub(crate) fn check_attrs(context: &mut RuleContext, attrs: &[Attribute], target: MarkerTarget) {
    for marker in markers::DocMarker::parse_all(attrs) {
        if let Some(violation) = marker.kind.placement_violation(target) {
            context.emit(violation.code, marker.location, violation.message);
        } else if let MarkerKind::Unknown(value) = marker.kind {
            context.emit(
                "rust-ousia-marker-unknown",
                marker.location,
                format!("unknown Ousia Rust marker `{value}`"),
            );
        }
    }
}

pub(crate) fn check_projection(
    context: &mut RuleContext,
    projection: &AttributeProjection,
    target: MarkerTarget,
) {
    for marker in markers::DocMarker::parse_facts(projection.direct_attributes()) {
        if let Some(violation) = marker.kind.placement_violation(target) {
            context.emit(violation.code, marker.location, violation.message);
        } else if let MarkerKind::Unknown(value) = marker.kind {
            context.emit(
                "rust-ousia-marker-unknown",
                marker.location,
                format!("unknown Ousia Rust marker `{value}`"),
            );
        }
    }
}
